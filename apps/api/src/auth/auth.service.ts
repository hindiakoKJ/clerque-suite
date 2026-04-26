import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, AuthTokens, AppAccessEntry, DEFAULT_APP_ACCESS, taxStatusFlags } from '@repo/shared-types';
import type { TaxStatus } from '@repo/shared-types';

const ACCESS_EXPIRY = '15m';
const REFRESH_EXPIRY = '7d';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async validateUser(email: string, password: string, companyCode?: string) {
    // If company code supplied, resolve tenant first
    let tenantId: string | undefined;
    if (companyCode) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: companyCode.toLowerCase().trim() },
        select: { id: true, status: true },
      });
      // Return null (not 404) so we don't reveal whether the tenant exists
      if (!tenant) return null;
      if (tenant.status === 'SUSPENDED') {
        throw new ForbiddenException('This account has been suspended. Please contact support.');
      }
      tenantId = tenant.id;
    }

    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        role: true,
        name: true,
        passwordHash: true,
        isActive: true,
        appAccess: { select: { appCode: true, level: true } },
      },
    });
    if (!user) return null;

    // ── Account lockout check ──────────────────────────────────────────────
    const windowStart = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
    const recentFailures = await this.prisma.loginLog.count({
      where: {
        userId: user.id,
        success: false,
        createdAt: { gte: windowStart },
      },
    });
    if (recentFailures >= MAX_FAILED_ATTEMPTS) {
      throw new ForbiddenException(
        `Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
      );
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      // Log failed attempt
      await this.prisma.loginLog.create({
        data: {
          userId: user.id,
          tenantId: user.tenantId,
          email,
          success: false,
        },
      });
      return null;
    }

    return user;
  }

  /** Load app access rows, falling back to role defaults if none seeded yet */
  private async loadAppAccess(userId: string, role: string): Promise<AppAccessEntry[]> {
    const rows = await this.prisma.userAppAccess.findMany({
      where: { userId },
      select: { appCode: true, level: true },
    });
    if (rows.length > 0) {
      return rows.map((r) => ({ app: r.appCode as AppAccessEntry['app'], level: r.level as AppAccessEntry['level'] }));
    }
    // Fall back to role defaults (row not yet seeded — e.g. migrated user)
    return DEFAULT_APP_ACCESS[role as keyof typeof DEFAULT_APP_ACCESS] ?? [];
  }

  async login(
    userId: string,
    tenantId: string,
    branchId: string | null,
    role: string,
    name = '',
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<AuthTokens> {
    // Revoke all existing sessions (single active session policy)
    await this.prisma.userSession.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });

    const appAccess = await this.loadAppAccess(userId, role);

    // Fetch tenant registration flags to embed in JWT
    const tenant = tenantId
      ? await this.prisma.tenant.findUnique({
          where:  { id: tenantId },
          select: { taxStatus: true, isVatRegistered: true, isBirRegistered: true, tinNumber: true, businessName: true, registeredAddress: true, isPtuHolder: true, ptuNumber: true, minNumber: true },
        })
      : null;

    const taxStatus = (tenant?.taxStatus ?? 'UNREGISTERED') as TaxStatus;
    const flags     = taxStatusFlags(taxStatus);

    const payload: JwtPayload = {
      sub:             userId,
      name,
      tenantId,
      branchId,
      role:            role as JwtPayload['role'],
      isSuperAdmin:    false,
      appAccess,
      taxStatus,
      isVatRegistered: flags.isVatRegistered,
      isBirRegistered: flags.isBirRegistered,
      tinNumber:         tenant?.tinNumber ?? null,
      businessName:      tenant?.businessName ?? null,
      registeredAddress: tenant?.registeredAddress ?? null,
      isPtuHolder:       tenant?.isPtuHolder ?? false,
      ptuNumber:         tenant?.ptuNumber ?? null,
      minNumber:         tenant?.minNumber ?? null,
    };

    const accessToken = this.jwt.sign(payload, { expiresIn: ACCESS_EXPIRY });
    const refreshToken = this.jwt.sign(
      { sub: userId, type: 'refresh' },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: REFRESH_EXPIRY,
      },
    );

    const refreshHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash: refreshHash,
        deviceInfo,
        ipAddress,
        status: 'ACTIVE',
        expiresAt,
      },
    });

    await this.prisma.loginLog.create({
      data: {
        userId,
        tenantId,
        email: '',
        success: true,
        ipAddress,
        deviceInfo,
      },
    });

    return { accessToken, refreshToken };
  }

  async refresh(userId: string, rawRefreshToken: string): Promise<AuthTokens> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, status: 'ACTIVE' },
    });

    let matchedSession: (typeof sessions)[0] | null = null;
    for (const session of sessions) {
      const match = await bcrypt.compare(rawRefreshToken, session.refreshTokenHash);
      if (match) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) throw new UnauthorizedException('Invalid refresh token');
    if (matchedSession.expiresAt < new Date()) {
      await this.prisma.userSession.update({
        where: { id: matchedSession.id },
        data: { status: 'EXPIRED' },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, branchId: true, role: true, name: true },
    });
    if (!user) throw new UnauthorizedException();

    // Rotate: revoke old session, issue new tokens
    await this.prisma.userSession.update({
      where: { id: matchedSession.id },
      data: { status: 'REVOKED' },
    });

    return this.login(user.id, user.tenantId, user.branchId, user.role, user.name);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, status: 'ACTIVE' },
    });

    for (const session of sessions) {
      const match = await bcrypt.compare(refreshToken, session.refreshTokenHash);
      if (match) {
        await this.prisma.userSession.update({
          where: { id: session.id },
          data: { status: 'REVOKED' },
        });
        return;
      }
    }
  }

  async logoutAllDevices(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
  }

  /** Verify refresh token signature and return the subject (userId). Throws 401 on invalid/expired token. */
  extractRefreshSub(token: string): string {
    try {
      const payload = this.jwt.verify(token) as { sub: string };
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  issueTokensForSuperAdmin(adminId: string): AuthTokens {
    const payload: JwtPayload = {
      sub:             adminId,
      name:            'Super Admin',
      tenantId:        null,
      branchId:        null,
      role:            'SUPER_ADMIN',
      isSuperAdmin:    true,
      appAccess:       DEFAULT_APP_ACCESS['SUPER_ADMIN'],
      taxStatus:         'UNREGISTERED', // Super Admin operates outside any specific tenant
      isVatRegistered:   false,
      isBirRegistered:   false,
      tinNumber:         null,
      businessName:      null,
      registeredAddress: null,
      isPtuHolder:       false,
      ptuNumber:         null,
      minNumber:         null,
    };
    const accessToken = this.jwt.sign(payload, { expiresIn: '2h' });
    const refreshToken = this.jwt.sign(
      { sub: adminId, type: 'refresh', isSuperAdmin: true },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '1d' },
    );
    return { accessToken, refreshToken };
  }
}
