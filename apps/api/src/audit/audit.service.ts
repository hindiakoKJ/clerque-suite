/**
 * AuditLogService — immutable audit trail for BIR compliance.
 *
 * Audit logs are INSERT-only. Records are never updated or deleted.
 * This ensures a tamper-evident trail that satisfies BIR CAS accreditation
 * requirements for tax setting changes and price adjustments.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

/**
 * Normalised audit entry returned by AuditService.findAll().
 * Merges tenant-side AuditLog rows with platform-side ConsoleLog rows that
 * affected this tenant — both rendered via one frontend code path.
 */
export interface NormalisedAuditEntry {
  id:           string;
  action:       string;
  entityType:   string;
  entityId:     string;
  before:       unknown;
  after:        unknown;
  description:  string | null;
  performedBy:  string | null;
  ipAddress:    string | null;
  createdAt:    Date;
  /** Distinguishes tenant-staff actions ('TENANT') from platform-side actions ('PLATFORM'). */
  source:       'TENANT' | 'PLATFORM';
}

export interface LogParams {
  tenantId:     string;
  action:       AuditAction;
  entityType:   string;
  entityId:     string;
  before?:      object | null;
  after?:       object | null;
  description?: string;
  performedBy?: string;
  ipAddress?:   string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Write an immutable audit record. Fire-and-forget — callers should not
   * await this unless they need confirmation the log was written.
   */
  async log(params: LogParams): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId:    params.tenantId,
        action:      params.action,
        entityType:  params.entityType,
        entityId:    params.entityId,
        before:      params.before ?? undefined,
        after:       params.after  ?? undefined,
        description: params.description,
        performedBy: params.performedBy,
        ipAddress:   params.ipAddress,
      },
    });
  }

  /** Convenience: log a tax-status change on a Tenant. */
  async logTaxStatusChange(
    tenantId:    string,
    before:      object,
    after:       object,
    performedBy: string,
    ipAddress?:  string,
  ): Promise<void> {
    return this.log({
      tenantId,
      action:      AuditAction.TAX_STATUS_CHANGED,
      entityType:  'Tenant',
      entityId:    tenantId,
      before,
      after,
      description: 'Tax status / registration flags changed',
      performedBy,
      ipAddress,
    });
  }

  /** Convenience: log a TIN number update. */
  async logTinUpdate(
    tenantId:    string,
    oldTin:      string | null,
    newTin:      string,
    performedBy: string,
    ipAddress?:  string,
  ): Promise<void> {
    return this.log({
      tenantId,
      action:      AuditAction.TIN_UPDATED,
      entityType:  'Tenant',
      entityId:    tenantId,
      before:      { tinNumber: oldTin },
      after:       { tinNumber: newTin },
      description: 'BIR TIN number updated',
      performedBy,
      ipAddress,
    });
  }

  /** Convenience: log a void/cancellation of an order. */
  async logVoid(
    tenantId:    string,
    orderId:     string,
    orderNumber: string,
    reason:      string,
    performedBy: string,
    ipAddress?:  string,
  ): Promise<void> {
    return this.log({
      tenantId,
      action:      AuditAction.VOID_PROCESSED,
      entityType:  'Order',
      entityId:    orderId,
      after:       { orderNumber, status: 'VOIDED', reason },
      description: `Order ${orderNumber} voided: ${reason}`,
      performedBy,
      ipAddress,
    });
  }

  /**
   * Log an SOD warning override — owner explicitly accepted a yellow warning
   * when assigning permissions that violate Segregation of Duties.
   * The full set of overrides is also stored on User.sodOverrides for the
   * staff-edit screen to render; this AuditLog row is the immutable copy.
   */
  async logSodOverride(
    tenantId:     string,
    targetUserId: string,
    ruleId:       string,
    reason:       string,
    permissions:  string[],
    performedBy:  string,
    ipAddress?:   string,
  ): Promise<void> {
    return this.log({
      tenantId,
      action:      AuditAction.SOD_OVERRIDE_GRANTED,
      entityType:  'User',
      entityId:    targetUserId,
      after:       { ruleId, reason, permissions },
      description: `SOD override accepted for rule ${ruleId}: ${reason}`,
      performedBy,
      ipAddress,
    });
  }

  /**
   * Retrieve audit log for a tenant, paginated. Merges:
   *   - AuditLog entries (tenant-side actions by their own staff)
   *   - ConsoleLog entries (Platform Admin actions affecting this tenant)
   *
   * Privacy & transparency: Platform Admin actions ARE shown to the tenant —
   * they have a right to know when the platform operator touched their data.
   * The specific super-admin email is masked to "Platform Admin" so tenants
   * can't enumerate / phish individual HNS staff. For legal forensics, the
   * raw email is preserved in the underlying ConsoleLog record (only super-
   * admins can see it via the Console).
   */
  async findAll(tenantId: string, opts: { page?: number; action?: AuditAction; entityType?: string }) {
    const { page = 1, action, entityType } = opts;
    const take = 50;
    const skip = (page - 1) * take;

    // Tenant-side audit entries (same query as before)
    const tenantWhere = {
      tenantId,
      ...(action     ? { action }     : {}),
      ...(entityType ? { entityType } : {}),
    };

    // Platform-side audit entries (ConsoleLog) — only when not filtering by
    // a tenant-only action / entityType, since ConsoleLog has different
    // action enum values.
    const includePlatform = !action && !entityType;

    const [tenantRecords, platformRecords] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: tenantWhere,
        orderBy: { createdAt: 'desc' },
        // Pull a generous batch then merge + paginate; we don't know yet
        // how many ConsoleLog entries to interleave.
        take: take * 3,
      }),
      includePlatform
        ? this.prisma.consoleLog.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: take * 3,
          })
        : Promise.resolve([] as Array<unknown>),
    ]);

    const normalised: NormalisedAuditEntry[] = [
      ...tenantRecords.map((r): NormalisedAuditEntry => ({
        id:          r.id,
        action:      r.action,
        entityType:  r.entityType,
        entityId:    r.entityId,
        before:      r.before,
        after:       r.after,
        description: r.description,
        performedBy: r.performedBy,
        ipAddress:   r.ipAddress,
        createdAt:   r.createdAt,
        source:      'TENANT',
      })),
      ...((platformRecords as Array<{
        id: string;
        superAdminEmail: string;
        action: string;
        userId: string | null;
        userEmail: string | null;
        detail: unknown;
        createdAt: Date;
      }>).map((r): NormalisedAuditEntry => ({
        id:          r.id,
        action:      r.action,
        // Map ConsoleAction to a synthetic entityType for display
        entityType:  r.userId ? 'User' : 'Tenant',
        entityId:    r.userId ?? tenantId,
        before:      null,
        after:       r.detail,
        description: humanizeConsoleAction(r.action, r.userEmail ?? undefined),
        // Mask the actual super-admin email — tenants see "Platform Admin"
        // (so they can't enumerate / phish HNS staff). The raw email is
        // still in ConsoleLog for legal forensics, accessible only via the
        // Console by other super-admins.
        performedBy: 'Platform Admin',
        ipAddress:   null,
        createdAt:   r.createdAt,
        source:      'PLATFORM',
      }))),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = normalised.length;
    const paginated = normalised.slice(skip, skip + take);

    return {
      data:  paginated,
      total,
      page,
      pages: Math.ceil(total / take),
    };
  }
}

/** Plain-language description for ConsoleAction values shown to tenants. */
function humanizeConsoleAction(action: string, targetUserEmail?: string): string {
  const target = targetUserEmail ? ` (${targetUserEmail})` : '';
  switch (action) {
    case 'TENANT_CREATED':    return 'Tenant account created by Platform Admin';
    case 'USER_CREATED':      return `New user added to your tenant by Platform Admin${target}`;
    case 'PASSWORD_RESET':    return `Password reset by Platform Admin${target}`;
    case 'ACCOUNT_UNLOCKED':  return `Locked account unlocked by Platform Admin${target}`;
    case 'FORCE_LOGOUT':      return `User force-logged-out by Platform Admin${target}`;
    case 'USER_DEACTIVATED':  return `User deactivated by Platform Admin${target}`;
    case 'USER_REACTIVATED':  return `User reactivated by Platform Admin${target}`;
    case 'TIER_CHANGED':      return 'Subscription tier changed by Platform Admin';
    case 'STATUS_CHANGED':    return 'Account status changed by Platform Admin';
    case 'AI_OVERRIDE_SET':   return 'AI quota override set by Platform Admin';
    case 'PROFILE_UPDATED':   return 'Tenant profile updated by Platform Admin';
    case 'DEMO_RESET':        return 'Demo data reset by Platform Admin';
    default:                  return `Platform Admin action: ${action}`;
  }
}
