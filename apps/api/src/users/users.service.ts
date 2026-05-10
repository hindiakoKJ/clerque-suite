import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_APP_ACCESS, hasPermission, hasBlockingViolation, detectViolations } from '@repo/shared-types';
import { CreateUserDto, StaffRole } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export { CreateUserDto, UpdateUserDto, StaffRole };

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit:  AuditService,
  ) {}

  // ─── List users in a tenant ───────────────────────────────────────────────

  async findAll(tenantId: string, branchId?: string, callerRole?: string) {
    const canViewSalary = hasPermission(callerRole, 'payroll:view_salary');

    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
        // SUPER_ADMIN is a platform role, not a tenant role — hide it from
        // tenant Staff lists. The platform admin can still log in normally;
        // they're just not listed as "staff" of any individual tenant.
        role: { not: 'SUPER_ADMIN' },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        branchId: true,
        isActive: true,
        createdAt: true,
        // Sprint 19 — kioskPin is plaintext (low-stakes 4–8 digit clock-in
        // credential). Only owners + managers can read this list, and the
        // existing SOD permission filters apply at the controller level.
        kioskPin:  true,
        kioskOnly: true,
        // Sprint 13 — pharmacist credentials. Drives the Settings → Pharmacy
        // roster + the receipt's "Dispensed by RPh ..." line. Returned to
        // every caller of /users; PRC numbers are not sensitive (they're on
        // the dispensing pharmacist's own receipts).
        prcLicense:          true,
        prcLicenseExpiresAt: true,
        // SOD Salary Privacy Wall — only OWNER + PAYROLL_MASTER see these fields
        salaryType: canViewSalary,
        salaryRate: canViewSalary,
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });

    return users;
  }

  // ─── Get one user ─────────────────────────────────────────────────────────

  async findOne(tenantId: string, id: string, callerRole?: string) {
    const canViewSalary = hasPermission(callerRole, 'payroll:view_salary');

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
        // PIN hash itself is never returned — we expose a boolean elsewhere if needed
        // SOD Salary Privacy Wall
        salaryType: canViewSalary,
        salaryRate: canViewSalary,
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

    // Sprint 19 — Kiosk PIN must be unique within the tenant. The DB has a
    // partial unique index (users_tenant_kiosk_pin_unique) as the final
    // race guard, but we check + return a friendly error here so the
    // owner sees "PIN 1234 is already used by Maria" instead of a P2002.
    if (dto.kioskPin) {
      const pinTaken = await this.prisma.user.findFirst({
        where:  { tenantId, kioskPin: dto.kioskPin, isActive: true },
        select: { name: true },
      });
      if (pinTaken) {
        throw new ConflictException({
          code:    'DUPLICATE_KIOSK_PIN',
          message: `PIN already used by ${pinTaken.name}. Choose a different PIN.`,
        });
      }
    }

    // Sprint 19 — Kiosk-only accounts skip the password requirement: they
    // can never log into Sync via password (auth.service blocks them with
    // KIOSK_ONLY_ACCOUNT). They authenticate ONLY via kioskPin at the
    // shared tablet. We still set a strong random hash so the column stays
    // NOT NULL and the row never accidentally accepts a blank password.
    if (dto.kioskOnly) {
      if (!dto.kioskPin) {
        throw new BadRequestException('Kiosk-only accounts require a PIN.');
      }
    } else if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    // ── Plan-tier seat-quota check (modular pricing, 2026-05-08) ──────────
    // Reject when adding this user would push the tenant past its plan
    // ceiling. Excludes SUPER_ADMIN + EXTERNAL_AUDITOR (audit visitors don't
    // count) and KIOSK_DISPLAY (machine-account, also out of headcount).
    if (!['SUPER_ADMIN', 'EXTERNAL_AUDITOR', 'KIOSK_DISPLAY'].includes(dto.role)) {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { planCode: true, staffSeatQuota: true, staffSeatAddons: true },
      });
      if (tenant) {
        // Lazy-import to avoid pulling shared-types into the hot path of every test.
        const { PLAN_CAPS, effectiveSeatCeiling } = await import('@repo/shared-types');
        const planCode = (tenant.planCode || 'SUITE_T2') as keyof typeof PLAN_CAPS;
        const ceiling  = effectiveSeatCeiling(planCode, tenant.staffSeatAddons || 0);

        const currentHeadcount = await this.prisma.user.count({
          where: {
            tenantId,
            isActive: true,
            role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR', 'KIOSK_DISPLAY'] },
          },
        });
        if (currentHeadcount >= ceiling) {
          throw new ForbiddenException({
            code:           'PLAN_CEILING_REACHED',
            message:        `You've reached your plan's staff cap (${ceiling}). Upgrade your plan or buy additional seats to add more staff.`,
            currentPlan:    planCode,
            currentSeats:   currentHeadcount,
            ceiling,
          });
        }
      }
    }

    // For kiosk-only accounts, store an unguessable random hash so the
    // user can never authenticate via /auth/login (also gated explicitly
    // there with code KIOSK_ONLY_ACCOUNT). For normal accounts, hash the
    // owner-supplied password.
    const passwordHash = dto.kioskOnly
      ? await bcrypt.hash(`kiosk-only-${Math.random()}-${Date.now()}`, 12)
      : await bcrypt.hash(dto.password, 12);

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
        kioskOnly: dto.kioskOnly ?? false,
        // Sprint 19 — kioskPin is stored as plaintext (4–8 digits, low-stakes
        // clock-in credential). Hashing was tried but broke kiosk lookups
        // (raw vs hash compare) AND defeated the uniqueness constraint
        // (every bcrypt hash is salted). Threat model: worst case for a
        // leaked PIN is one staff member punching another's clock — already
        // audit-logged on the TimeEntry row.
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

  async update(tenantId: string, id: string, dto: UpdateUserDto, callerRole?: string, callerId?: string) {
    await this.findOne(tenantId, id, callerRole);

    // Sprint 19 — friendly duplicate-PIN error before the DB constraint fires.
    // dto.kioskPin === null clears it; a non-null value must be unique within
    // the tenant (excluding the user being edited so re-saving the same PIN
    // is a no-op).
    if (dto.kioskPin !== undefined && dto.kioskPin !== null) {
      const pinTaken = await this.prisma.user.findFirst({
        where:  {
          tenantId,
          kioskPin: dto.kioskPin,
          isActive: true,
          NOT:      { id },
        },
        select: { name: true },
      });
      if (pinTaken) {
        throw new ConflictException({
          code:    'DUPLICATE_KIOSK_PIN',
          message: `PIN already used by ${pinTaken.name}. Choose a different PIN.`,
        });
      }
    }

    // SOD pre-check: if customPermissions are being changed (or role is changing),
    // evaluate the FINAL intended permission set against SOD_RULES. A BLOCK
    // violation refuses the write outright; a WARN passes through but is logged
    // when the caller provides sodOverrides (the staff editor handles that flow).
    if (dto.customPermissions !== undefined || dto.role !== undefined) {
      const target = await this.prisma.user.findFirst({
        where:  { id, tenantId },
        select: { role: true, customPermissions: true },
      });
      if (target) {
        // Cast through unknown — frontend role enum and shared-types UserRole
        // diverge slightly (extra MDM, EXTERNAL_AUDITOR variants on the
        // shared-types side); detectViolations validates against its own list.
        const finalRole   = (dto.role ?? target.role) as unknown as Parameters<typeof hasBlockingViolation>[0];
        const finalCustom = (dto.customPermissions ?? target.customPermissions) as Parameters<typeof hasBlockingViolation>[1];
        if (hasBlockingViolation(finalRole, finalCustom)) {
          const violations = detectViolations(finalRole, finalCustom).filter((v) => v.rule.severity === 'BLOCK');
          throw new BadRequestException({
            code: 'SOD_BLOCK',
            message: `Permission change rejected — Segregation of Duties violation: ${violations.map((v) => v.rule.key).join(', ')}`,
            violations,
          });
        }
      }
    }

    // HIGH-1 TOCTOU fix: updateMany with compound { id, tenantId } is atomic.
    // The prior findOne validates existence; updateMany adds the tenantId guard to
    // the write itself so no window exists where a different tenant's record could
    // be modified even if the id happened to match.
    const result = await this.prisma.user.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.name     !== undefined ? { name:     dto.name }     : {}),
        ...(dto.role     !== undefined ? { role:     dto.role }     : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.isActive  !== undefined ? { isActive:  dto.isActive }  : {}),
        ...(dto.kioskOnly !== undefined ? { kioskOnly: dto.kioskOnly } : {}),
        // null clears the PIN; otherwise store the plaintext PIN. (Was
        // bcrypt-hashed previously — see migration 20260528000000 for why
        // we switched to plaintext. Uniqueness is enforced both here and
        // by the partial unique index users_tenant_kiosk_pin_unique.)
        ...(dto.kioskPin !== undefined ? { kioskPin: dto.kioskPin } : {}),
        ...(dto.personaKey        !== undefined ? { personaKey:        dto.personaKey }                       : {}),
        ...(dto.customPermissions !== undefined ? { customPermissions: dto.customPermissions }                : {}),
        ...(dto.sodOverrides      !== undefined ? { sodOverrides:      dto.sodOverrides as Prisma.InputJsonValue } : {}),
      },
    });
    if (result.count === 0) throw new NotFoundException('User not found');

    // Audit-log the permissions change so SOD log + governance reports have
    // a record. We log even when only role / persona changed — those affect
    // the user's effective permission set too.
    if (dto.role !== undefined || dto.personaKey !== undefined || dto.customPermissions !== undefined || dto.sodOverrides !== undefined) {
      await this.audit.log({
        tenantId,
        action:      'PERMISSIONS_UPDATED' as const,
        entityType:  'User',
        entityId:    id,
        after:       {
          role:              dto.role,
          personaKey:        dto.personaKey,
          customPermissions: dto.customPermissions,
        },
        description: 'Staff permissions / persona / role updated',
        performedBy: callerId,
      });
    }

    // Re-fetch with full select for the response (updateMany does not return rows)
    const updated = await this.prisma.user.findFirst({
      where: { id, tenantId },
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
    if (!updated) throw new NotFoundException('User not found');

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

    // ── Session invalidation on privilege changes ───────────────────────────
    // Privilege-affecting fields must take effect immediately — existing JWTs
    // carry the OLD role / persona / customPermissions and remain valid until
    // their access-token expiry otherwise. Deleting sessions forces re-login
    // and a fresh token reflecting the new privileges.
    //
    // Triggers:
    //   - role change (escalation OR de-escalation)
    //   - account deactivation
    //   - persona change (RBAC bundle swap)
    //   - customPermissions change (granular permission grant or revoke)
    //
    // Without invalidation on persona/customPermissions, an owner could grant
    // ledger:journal_entry to a CASHIER and the cashier's cached JWT would not
    // reflect the change for 15 min — also the reverse: a revoke would not take
    // effect until the next refresh.
    const privilegeChanged =
      dto.role               !== undefined ||
      dto.isActive           === false      ||
      dto.personaKey         !== undefined ||
      dto.customPermissions  !== undefined;
    if (privilegeChanged) {
      // Tenant-scoped session invalidation — only kill sessions belonging to
      // a user inside the caller's tenant. The outer findOne(tenantId, id)
      // already proves `id` belongs to tenantId, but keep the join in the
      // delete query as defense-in-depth.
      await this.prisma.userSession.deleteMany({
        where: { userId: id, user: { tenantId } },
      });
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

    // HIGH-1 TOCTOU fix: updateMany with compound { id, tenantId } for atomic tenant scope.
    await this.prisma.user.updateMany({
      where: { id, tenantId },
      data: { passwordHash },
    });

    // Revoke all sessions — tenant-scoped via the user join so a future
    // refactor can't accidentally revoke sessions for a same-cuid user in
    // another tenant.
    await this.prisma.userSession.updateMany({
      where: { userId: id, user: { tenantId } },
      data:  { status: 'REVOKED' },
    });
    return { message: 'Password reset. All active sessions revoked.' };
  }

  // ─── Toggle MDM role (BUSINESS_OWNER only) ───────────────────────────────

  /**
   * Toggles the MDM (Master Data Manager) role for a staff member.
   *
   * Rules (mirrors SAP role-assignment governance):
   *   - Only BUSINESS_OWNER can call this endpoint.
   *   - BUSINESS_OWNER and SUPER_ADMIN rows are immutable — cannot be promoted/demoted.
   *   - If the target is already MDM → demote to GENERAL_EMPLOYEE.
   *   - Otherwise → promote to MDM.
   *   - All existing sessions for the target are invalidated immediately (prevents privilege
   *     escalation/de-escalation from taking 7 days to propagate via JWT expiry).
   *   - Change is recorded in the immutable AuditLog.
   */
  async assignMdmRole(
    tenantId:     string,
    targetUserId: string,
    requestingUserId: string,
    ipAddress?:   string,
  ) {
    // Verify the requesting user is a BUSINESS_OWNER in this tenant
    const requestor = await this.prisma.user.findFirst({
      where:  { id: requestingUserId, tenantId },
      select: { role: true },
    });
    if (!requestor || requestor.role !== 'BUSINESS_OWNER') {
      throw new ForbiddenException('Only the Business Owner can assign or revoke the MDM role.');
    }

    // Load target
    const target = await this.prisma.user.findFirst({
      where:  { id: targetUserId, tenantId },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!target) throw new NotFoundException('User not found');

    // Protect privileged accounts
    if (target.role === 'BUSINESS_OWNER' || target.role === 'SUPER_ADMIN') {
      throw new BadRequestException('Cannot change the role of a Business Owner or Super Admin.');
    }

    const previousRole = target.role;
    const newRole: StaffRole = previousRole === 'MDM' ? 'GENERAL_EMPLOYEE' : 'MDM';

    // Update role + re-seed app access atomically
    const defaultAccess = DEFAULT_APP_ACCESS[newRole] ?? [];
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data:  { role: newRole },
      }),
      ...defaultAccess.map((a) =>
        this.prisma.userAppAccess.upsert({
          where:  { userId_appCode: { userId: targetUserId, appCode: a.app } },
          create: { userId: targetUserId, appCode: a.app, level: a.level },
          update: { level: a.level },
        }),
      ),
    ]);

    // Invalidate all existing sessions — role change must take effect immediately
    await this.prisma.userSession.updateMany({
      where: { userId: targetUserId },
      data:  { status: 'REVOKED' },
    });

    // Immutable audit record
    void this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'User',
      entityId:    targetUserId,
      before:      { role: previousRole },
      after:       { role: newRole },
      description: newRole === 'MDM'
        ? `MDM role granted to "${target.name}" (${target.email})`
        : `MDM role revoked from "${target.name}" (${target.email}); demoted to GENERAL_EMPLOYEE`,
      performedBy: requestingUserId,
      ipAddress,
    });

    return {
      id:      targetUserId,
      name:    target.name,
      email:   target.email,
      role:    newRole,
      message: newRole === 'MDM'
        ? `${target.name} is now a Master Data Manager. Their session has been reset.`
        : `MDM access has been revoked from ${target.name}. Their session has been reset.`,
    };
  }

  // ─── List branches for tenant ─────────────────────────────────────────────

  async getBranches(tenantId: string) {
    return this.prisma.branch.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }
}
