import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_APP_ACCESS } from '@repo/shared-types';

export type StaffRole =
  | 'BUSINESS_OWNER'
  | 'BRANCH_MANAGER'
  | 'ACCOUNTANT'
  | 'CASHIER'
  | 'GENERAL_EMPLOYEE';

export interface CreateUserDto {
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  branchId?: string;
  kioskPin?: string;
}

export interface UpdateUserDto {
  name?: string;
  role?: StaffRole;
  branchId?: string | null;
  isActive?: boolean;
  kioskPin?: string | null;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // ─── List users in a tenant ───────────────────────────────────────────────

  async findAll(tenantId: string, branchId?: string) {
    return this.prisma.user.findMany({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  // ─── Get one user ─────────────────────────────────────────────────────────

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        kioskPin: true,
        branch: { select: { id: true, name: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ─── Create staff user ────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateUserDto) {
    // Check email uniqueness within tenant
    const existing = await this.prisma.user.findFirst({
      where: { tenantId, email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use within this business.');

    if (dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Seed default app access rows from role defaults
    const defaultAccess = DEFAULT_APP_ACCESS[dto.role] ?? [];

    const created = await this.prisma.user.create({
      data: {
        tenantId,
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role,
        branchId: dto.branchId ?? null,
        kioskPin: dto.kioskPin ?? null,
        appAccess: {
          create: defaultAccess.map((a) => ({
            appCode: a.app,
            level:   a.level,
          })),
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
      },
    });

    return created;
  }

  // ─── Update user ──────────────────────────────────────────────────────────

  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    await this.findOne(tenantId, id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name    !== undefined ? { name:     dto.name }    : {}),
        ...(dto.role    !== undefined ? { role:     dto.role }    : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.kioskPin !== undefined ? { kioskPin: dto.kioskPin } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
      },
    });

    // If role changed, re-seed default app access
    if (dto.role) {
      const defaultAccess = DEFAULT_APP_ACCESS[dto.role] ?? [];
      await this.prisma.$transaction(
        defaultAccess.map((a) =>
          this.prisma.userAppAccess.upsert({
            where:  { userId_appCode: { userId: id, appCode: a.app } },
            create: { userId: id, appCode: a.app, level: a.level },
            update: { level: a.level },
          }),
        ),
      );
    }

    return updated;
  }

  // ─── Reset password ───────────────────────────────────────────────────────

  async resetPassword(tenantId: string, id: string, newPassword: string) {
    await this.findOne(tenantId, id);
    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    // Revoke all sessions for security
    await this.prisma.userSession.updateMany({
      where: { userId: id },
      data: { status: 'REVOKED' },
    });
    return { message: 'Password reset. All active sessions revoked.' };
  }

  // ─── List branches for tenant ─────────────────────────────────────────────

  async getBranches(tenantId: string) {
    return this.prisma.branch.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }
}
