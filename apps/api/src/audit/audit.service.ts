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
  /** SecAudit 2026-05 A4 — request `user-agent` header for forensics. */
  userAgent?:   string;
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
        userAgent:   params.userAgent,
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

  /**
   * Audit D4-05 — Historical Segregation-of-Duties conflict detection.
   *
   * Walks AuditLog rows with action='PERMISSIONS_UPDATED' or
   * action='USER_DEPROVISIONED', reconstructs each user's role history,
   * and flags any user whose history crosses one of the SOD-conflict pairs.
   *
   * The "same person controlled both sides" risk is real even when the
   * roles never overlapped in time — e.g. an AP_ACCOUNTANT who fabricated
   * bills last quarter then moved to PAYROLL_MASTER could now pay
   * themselves through the bills they wrote. This report surfaces those
   * lifetime conflicts so auditors can sample-check the suspect periods.
   */
  async findSodViolations(
    tenantId: string,
    opts: { fromDate?: string; toDate?: string } = {},
  ) {
    const { fromDate, toDate } = opts;
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (fromDate) createdAt.gte = new Date(fromDate);
    if (toDate)   createdAt.lte = new Date(toDate);

    // Role-change history. We don't have a dedicated event yet — but
    // PERMISSIONS_UPDATED writes are emitted by users.service.update when
    // role changes, and store before/after.role on the row.
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        action: 'PERMISSIONS_UPDATED',
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, entityId: true, before: true, after: true, createdAt: true,
      },
    });

    // SOD-conflict matrix. Bidirectional — order in pair does not matter
    // for the lifetime check. CASHIER↔BRANCH_MANAGER is time-sensitive
    // (same person voiding what they sold within 24h is the real signal).
    const PAIRS: { a: string; b: string; label: string; windowMs?: number }[] = [
      { a: 'AP_ACCOUNTANT', b: 'PAYROLL_MASTER', label: 'AP_ACCOUNTANT↔PAYROLL_MASTER (create bills + pay self)' },
      { a: 'AR_ACCOUNTANT', b: 'ACCOUNTANT',     label: 'AR_ACCOUNTANT↔ACCOUNTANT (issue invoice + post payment)' },
      { a: 'BOOKKEEPER',    b: 'ACCOUNTANT',     label: 'BOOKKEEPER↔ACCOUNTANT (record + approve)' },
      { a: 'CASHIER',       b: 'BRANCH_MANAGER', label: 'CASHIER↔BRANCH_MANAGER (sell + supervise voids)', windowMs: 24 * 60 * 60 * 1000 },
    ];

    // Group history per user (entityId of a PERMISSIONS_UPDATED row IS the user id).
    type Hop = { role: string; at: Date; fromRole: string | null };
    const byUser = new Map<string, Hop[]>();
    for (const r of rows) {
      const before = (r.before ?? {}) as { role?: string };
      const after  = (r.after  ?? {}) as { role?: string };
      const next   = after.role;
      if (!next) continue;
      if (!byUser.has(r.entityId)) byUser.set(r.entityId, []);
      byUser.get(r.entityId)!.push({ role: next, at: r.createdAt, fromRole: before.role ?? null });
    }

    // Resolve user names + current role in one round-trip.
    const userIds = [...byUser.keys()];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where:  { id: { in: userIds }, tenantId },
          select: { id: true, name: true, role: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const out: Array<{
      userId:       string;
      userName:     string;
      currentRole:  string | null;
      history:      Array<{ role: string; fromDate: string; toDate: string | null }>;
      conflicts:    string[];
    }> = [];

    for (const [userId, hops] of byUser) {
      // Build "tenure intervals" — each hop is the start of a new role.
      const intervals: { role: string; fromDate: Date; toDate: Date | null }[] = [];
      for (let i = 0; i < hops.length; i++) {
        const h    = hops[i];
        const next = hops[i + 1];
        intervals.push({ role: h.role, fromDate: h.at, toDate: next?.at ?? null });
      }

      const rolesSeen = new Set(intervals.map((it) => it.role));
      const conflicts: string[] = [];

      for (const p of PAIRS) {
        if (!(rolesSeen.has(p.a) && rolesSeen.has(p.b))) continue;
        // Find the two intervals + check windowMs constraint (if set).
        const aInt = intervals.find((it) => it.role === p.a)!;
        const bInt = intervals.find((it) => it.role === p.b)!;
        if (p.windowMs !== undefined) {
          const gap = Math.abs(aInt.fromDate.getTime() - bInt.fromDate.getTime());
          if (gap > p.windowMs) continue;
        }
        const flagDate = (aInt.fromDate > bInt.fromDate ? aInt.fromDate : bInt.fromDate)
          .toISOString().slice(0, 10);
        conflicts.push(`${p.label} (${flagDate})`);
      }

      if (conflicts.length === 0) continue;

      const u = userById.get(userId);
      out.push({
        userId,
        userName:    u?.name ?? 'Unknown (removed)',
        currentRole: u?.role ?? null,
        history:     intervals.map((it) => ({
          role:     it.role,
          fromDate: it.fromDate.toISOString(),
          toDate:   it.toDate?.toISOString() ?? null,
        })),
        conflicts,
      });
    }

    return out;
  }

  /**
   * Sprint 19 — Recent login history (success + failure) for the tenant.
   * Used by /ledger/audit's Login History panel. Last N days, capped at
   * 500 rows to keep the UI snappy.
   */
  async recentLogins(tenantId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.loginLog.findMany({
      where: {
        tenantId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    // Aggregate failure counts per email so the UI can highlight bursts.
    const failedByEmail = new Map<string, number>();
    for (const r of rows) {
      if (!r.success) failedByEmail.set(r.email, (failedByEmail.get(r.email) ?? 0) + 1);
    }

    return {
      windowDays: days,
      total: rows.length,
      successCount: rows.filter((r) => r.success).length,
      failedCount:  rows.filter((r) => !r.success).length,
      // Email addresses with 5+ failures in the window — credential-stuffing
      // / brute-force candidates. UI badges these red.
      failureBursts: Array.from(failedByEmail.entries())
        .filter(([, n]) => n >= 5)
        .map(([email, count]) => ({ email, count }))
        .sort((a, b) => b.count - a.count),
      entries: rows.map((r) => ({
        id:         r.id,
        email:      r.email,
        success:    r.success,
        reason:     r.reason,
        ipAddress:  r.ipAddress,
        deviceInfo: r.deviceInfo,
        createdAt:  r.createdAt.toISOString(),
        userName:   r.user?.name ?? null,
        userRole:   r.user?.role ?? null,
      })),
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
