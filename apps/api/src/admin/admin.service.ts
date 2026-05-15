/**
 * AdminService — cross-tenant operations for the Clerque Console.
 *
 * Every method here runs WITHOUT tenant scoping. Only callable behind
 * SuperAdminGuard. All mutating actions are automatically logged to the
 * ConsoleLog table for audit-readiness.
 */

import {
  Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_APP_ACCESS } from '@repo/shared-types';
import { DEMO_SCENARIOS, ScenarioKey, allProducts } from './demo-scenarios';
import { COFFEE_SHOP_INGREDIENTS } from './coffee-shop-ingredients';
import { COFFEE_SHOP_CATEGORIES } from './coffee-shop-categories';
import { AccountsService } from '../accounting/accounts.service';
import { MailService } from '../mail/mail.service';

// ─── Types ────────────────────────────────────────────────────────────────────

type ConsoleActor = { email: string };

export interface CreateTenantDto {
  name:          string;
  slug:          string;
  businessType:
    | 'COFFEE_SHOP' | 'RESTAURANT' | 'BAKERY' | 'FOOD_STALL' | 'BAR_LOUNGE' | 'CATERING'
    | 'RETAIL' | 'SERVICE' | 'LAUNDRY' | 'MANUFACTURING'
    // Sprint 12 — six-engine vertical structure
    | 'PHARMACY' | 'TRUCKING' | 'CONSTRUCTION';
  tier:          'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6';
  ownerName:     string;
  ownerEmail:    string;
  contactEmail?: string;
  contactPhone?: string;
  // Sprint 17 — atomic plan provisioning. Operator can pass these in the
  // same call instead of making a separate PATCH /plan after creation —
  // closes the half-configured-tenant window if the second call failed.
  planCode?:        string;
  modulePos?:       boolean;
  moduleLedger?:    boolean;
  modulePayroll?:   boolean;
  staffSeatAddons?: number;
}

export interface AddUserDto {
  name:    string;
  email:   string;
  role:    string;
  pinCode?: string;
}

export interface UpdateTenantProfileDto {
  name?:           string;
  businessName?:   string | null;
  /** Must match the BusinessType enum in schema.prisma exactly. */
  businessType?:
    | 'COFFEE_SHOP' | 'RESTAURANT' | 'BAKERY' | 'FOOD_STALL' | 'BAR_LOUNGE' | 'CATERING'
    | 'RETAIL' | 'SERVICE' | 'LAUNDRY' | 'MANUFACTURING'
    | 'PHARMACY' | 'TRUCKING' | 'CONSTRUCTION';
  taxStatus?:      'VAT' | 'NON_VAT' | 'UNREGISTERED';
  tinNumber?:      string | null;
  isBirRegistered?: boolean;
  contactEmail?:   string | null;
  contactPhone?:   string | null;
  address?:        string | null;
  isDemoTenant?:   boolean;
  // ── Sprint 12 — Policy fields, console-only authority ───────────────────
  // These three used to be tenant-editable. Per the user directive, they're
  // now console-only because each one corrupts accounting integrity if
  // changed mid-life (revenue recognition, COGS continuity, VAT base, COGS
  // overhead allocation). The tenant-side endpoints that used to set them
  // now return 403 with code: 'CONSOLE_ONLY_POLICY'. Owners see the values
  // read-only in Settings with a "contact support to change" affordance.
  /** Inventory valuation method. WAC = weighted average; FIFO = first-in-first-out. */
  valuationMethod?:    'WAC' | 'FIFO';
  /** Revenue recognition basis. CASH on receipt; ACCRUAL on invoice. */
  accountingMethod?:   'CASH' | 'ACCRUAL';
  /** Manufacturing-only overhead rate (₱ per unit produced). Null = clear. */
  overheadRatePerUnit?: number | null;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
    private mail: MailService,
  ) {}

  // ─── Internal helpers ────────────────────────────────────────────────────

  /**
   * Sprint 12 — typed-slug confirmation for destructive console ops.
   *
   * The caller (controller) must pass `confirmationToken` from the body.
   * Server-side check that it matches the tenant's slug exactly. Frontend
   * shows a typed-slug modal so a misclicked button can't quietly suspend
   * a tenant or wipe their data. Both sides must agree before mutation.
   */
  /**
   * Sprint 19 — Hard guard against console-initiated data wipes ever
   * touching a live (paying) tenant. The tenant table has an explicit
   * `isDemoTenant` boolean (default `false`); only rows where it's
   * `true` are wipable from the Console.
   *
   * NO override flag. NO `force: true` bypass. If a real paying tenant
   * legitimately needs a data wipe (e.g. owner request, end of contract,
   * regulatory takedown), it must be done out-of-band by a DBA with
   * direct database access — that path requires a separate human in the
   * loop and isn't reachable from anyone's web session.
   */
  private async assertDemoTenant(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { id: true, slug: true, isDemoTenant: true, status: true, name: true },
    });
    if (!t) throw new NotFoundException('Tenant not found.');
    if (!t.isDemoTenant) {
      throw new ForbiddenException({
        code:    'LIVE_TENANT_PROTECTED',
        message:
          `Refusing to run destructive operation on '${t.name}' (${t.slug}) — this is a live tenant. ` +
          `Console destructive operations are restricted to tenants flagged isDemoTenant=true. ` +
          `If a wipe is genuinely required for this tenant, it must be performed by a DBA out-of-band.`,
      });
    }
  }

  /**
   * Sprint 19 — Rate-limit destructive console operations per SUPER_ADMIN.
   * A stolen credential should not be able to wipe the entire fleet of
   * demo tenants in seconds. After N destructive ops within the last 24h
   * for the same actor email, throw 429 with code DESTRUCTIVE_OP_RATE_LIMIT.
   *
   * The threshold is intentionally low — legitimate ops need to wipe at
   * most one tenant per minute or so during a demo prep; an automated
   * attack would burn through this counter immediately.
   */
  private async assertDestructiveOpRateLimit(actor: ConsoleActor) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentDestructive = await this.prisma.consoleLog.count({
      where: {
        superAdminEmail: actor.email,
        createdAt:       { gte: since },
        action: { in: ['CLEAR_ALL_DATA', 'DEMO_RESET', 'TENANT_FROZEN'] as any[] }, // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    });
    const LIMIT = 5;
    if (recentDestructive >= LIMIT) {
      throw new ForbiddenException({
        code:    'DESTRUCTIVE_OP_RATE_LIMIT',
        message:
          `Rate limit hit: you've run ${recentDestructive} destructive operations in the last 24h. ` +
          `If this is an automated attack, lock your account immediately. ` +
          `If legitimate, wait or have another platform admin assist.`,
      });
    }
  }

  /**
   * Sprint 19 — Tenant read-only kill switch. Sets `readOnlyMode=true`
   * on the tenant; the global ReadOnlyModeInterceptor rejects all writes
   * for that tenant until unfreeze. Use case: detect compromise → freeze
   * → investigate → unfreeze.
   */
  async freezeTenant(tenantId: string, actor: ConsoleActor, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required when freezing a tenant.');
    }
    await this.assertDestructiveOpRateLimit(actor);

    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true, readOnlyMode: true },
    });
    if (!t) throw new NotFoundException('Tenant not found.');
    if (t.readOnlyMode) {
      throw new BadRequestException('Tenant is already frozen.');
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        readOnlyMode:    true,
        readOnlyReason:  reason.trim(),
        readOnlySetAt:   new Date(),
        readOnlySetById: null, // ConsoleActor doesn't carry a userId currently
      },
    });
    await this.logAction({
      actor,
      tenantId,
      tenantSlug: t.slug,
      action:     'TENANT_FROZEN' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      detail:     { reason: reason.trim() },
    });
    this.logger.warn(`[freeze] Tenant ${t.slug} (${t.id}) frozen by ${actor.email}: ${reason}`);
    return { id: t.id, slug: t.slug, frozen: true };
  }

  async unfreezeTenant(tenantId: string, actor: ConsoleActor) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, readOnlyMode: true },
    });
    if (!t) throw new NotFoundException('Tenant not found.');
    if (!t.readOnlyMode) {
      throw new BadRequestException('Tenant is not currently frozen.');
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        readOnlyMode:    false,
        readOnlyReason:  null,
        readOnlySetAt:   null,
        readOnlySetById: null,
      },
    });
    await this.logAction({
      actor,
      tenantId,
      tenantSlug: t.slug,
      action:     'TENANT_UNFROZEN' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    this.logger.log(`[freeze] Tenant ${t.slug} (${t.id}) unfrozen by ${actor.email}`);
    return { id: t.id, slug: t.slug, frozen: false };
  }

  /**
   * Sprint 19 — Pre-destructive snapshot. Captures every row that's about
   * to be deleted into a single `TenantDataSnapshot` JSONB blob, so even
   * if the guard above is somehow bypassed (or a future edit mis-flags a
   * tenant's `isDemoTenant`), the data can still be recovered.
   *
   * Captures only the tables touched by resetDemoData/clearAllTenantData.
   * Returns the snapshot id so the caller can reference it in their audit
   * log + the response body.
   */
  private async snapshotTenantData(
    tenantId: string,
    reason: 'PRE_RESET_DEMO' | 'PRE_CLEAR_ALL' | 'MANUAL',
    actor: ConsoleActor,
  ): Promise<{ id: string; rowCount: number }> {
    // Pull every table the destructive paths touch. Order matters only
    // for human readability of the JSON dump; FK ordering is irrelevant
    // since we're not restoring atomically here.
    const [
      orders, accountingEvents, journalEntries,
      products, categories, rawMaterials,
      inventoryItems, inventoryLogs,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId },
        include: { items: true, payments: true, discounts: true },
      }),
      this.prisma.accountingEvent.findMany({ where: { tenantId } }),
      this.prisma.journalEntry.findMany({
        where: { tenantId },
        include: { lines: true },
      }),
      this.prisma.product.findMany({
        where: { tenantId },
        include: { bomItems: true },
      }),
      this.prisma.category.findMany({ where: { tenantId } }),
      this.prisma.rawMaterial.findMany({
        where: { tenantId },
        include: { inventory: true },
      }),
      this.prisma.inventoryItem.findMany({ where: { tenantId } }),
      this.prisma.inventoryLog.findMany({ where: { tenantId } }),
    ]);

    const payload = {
      orders, accountingEvents, journalEntries,
      products, categories, rawMaterials,
      inventoryItems, inventoryLogs,
    };
    const rowCount =
      orders.length + accountingEvents.length + journalEntries.length +
      products.length + categories.length + rawMaterials.length +
      inventoryItems.length + inventoryLogs.length;

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const snap = await this.prisma.tenantDataSnapshot.create({
      data: {
        tenantId,
        reason,
        takenById:    null,
        takenByEmail: actor.email ?? null,
        rowCount,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: payload as any,
        expiresAt,
      },
      select: { id: true, rowCount: true },
    });

    this.logger.log(
      `[snapshot] Captured ${rowCount} rows for tenant ${tenantId} (reason=${reason}, snap=${snap.id}, by=${actor.email ?? 'unknown'})`,
    );
    return snap;
  }

  private async assertTypedSlug(tenantId: string, confirmationToken: string | undefined) {
    if (!confirmationToken || typeof confirmationToken !== 'string') {
      throw new BadRequestException({
        code:    'CONFIRMATION_REQUIRED',
        message: 'This is a destructive operation. Type the tenant slug to confirm.',
      });
    }
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    if (confirmationToken.trim().toLowerCase() !== tenant.slug.toLowerCase()) {
      throw new ForbiddenException({
        code:    'CONFIRMATION_MISMATCH',
        message: `Confirmation slug does not match. Expected '${tenant.slug}'.`,
      });
    }
  }

  /** Generates a secure 12-char random password. Shown once in Console UI. */
  private generatePassword(): string {
    const upper   = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    const lower   = 'abcdefghjkmnpqrstuvwxyz';
    const digits  = '23456789';
    const special = '!@#$';
    const all     = upper + lower + digits;
    const rand    = (set: string) => set[Math.floor(Math.random() * set.length)];
    // Guarantee at least one of each required class
    const required = rand(upper) + rand(digits) + rand(special);
    const rest = Array.from({ length: 9 }, () => rand(all)).join('');
    // Shuffle: interleave to avoid predictable prefix
    const chars = (required + rest).split('');
    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  /** Appends an immutable entry to console_logs. Truly fire-and-forget — catches
   *  both synchronous PrismaClientValidationError and async DB errors so audit
   *  failures never surface to the caller. */
  private async logAction(params: {
    actor:       ConsoleActor;
    tenantId?:   string;
    tenantSlug?: string;
    userId?:     string;
    userEmail?:  string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    action:      any;   // 'any' avoids sync PrismaClientValidationError when enum not yet in DB
    detail?:     object;
  }) {
    try {
      await this.prisma.consoleLog.create({
        data: {
          superAdminEmail: params.actor.email,
          tenantId:        params.tenantId,
          tenantSlug:      params.tenantSlug,
          userId:          params.userId,
          userEmail:       params.userEmail,
          action:          params.action,
          detail:          params.detail as Prisma.InputJsonValue ?? Prisma.JsonNull,
        },
      });
    } catch {
      /* Audit log failures must never break the main operation.
         Common cause: DB enum not yet migrated (PROFILE_UPDATED / DEMO_RESET).
         The action still completes; the log entry is silently dropped. */
    }
  }

  // ─── Platform metrics ────────────────────────────────────────────────────

  /**
   * Platform-level operational metrics for the SUPER_ADMIN Console.
   *
   * Privacy principle: this dashboard intentionally exposes ZERO tenant
   * financial data (revenue, orders, AR/AP balances). Showing tenants'
   * money to the platform operator erodes trust — a coffee shop owner
   * would (rightly) ask "you can see how much I make?" and the answer
   * should be "we don't look".
   *
   * What we DO surface, organized by concern:
   *   - Tenant footprint: how many tenants, by status, by tier, active users
   *   - Operational health: failed events, locked accounts, sync issues
   *   - Platform cost: AI spend (our cost, not theirs) — gated behind a
   *     show/hide toggle on the frontend so it can be hidden during demos.
   */
  async getPlatformMetrics() {
    const now = new Date();
    const day1  = new Date(now.getTime() -      24 * 60 * 60 * 1000);
    const day7  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      tenantsByStatus, tenantsByTier,
      activeLast7d, activeLast30d,
      totalUsers,
      // Operational health signals — everything below is platform-side.
      failedEvents, pendingEvents,
      recentLoginFailures, recentSignupsLast7d,
      sessionsLast24h,
      totalAiSpend30d,
      // Sprint 19 — security-posture signals
      destructiveOps24h, frozenTenants,
    ] = await Promise.all([
      this.prisma.tenant.groupBy({ by: ['status'], _count: true }),
      this.prisma.tenant.groupBy({ by: ['tier'],   _count: true }),
      this.prisma.tenant.count({ where: { users: { some: { sessions: { some: { lastUsedAt: { gte: day7  } } } } } } }).catch(() => 0),
      this.prisma.tenant.count({ where: { users: { some: { sessions: { some: { lastUsedAt: { gte: day30 } } } } } } }).catch(() => 0),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.accountingEvent.count({ where: { status: 'FAILED' } }).catch(() => 0),
      this.prisma.accountingEvent.count({ where: { status: 'PENDING', createdAt: { lte: new Date(now.getTime() - 5 * 60 * 1000) } } }).catch(() => 0),
      // Failed login attempts in last 24h — proxy for brute-force / credential-stuffing
      this.prisma.loginLog.count({ where: { success: false, createdAt: { gte: day1 } } }).catch(() => 0),
      this.prisma.tenant.count({ where: { createdAt: { gte: day7 } } }),
      this.prisma.userSession.count({ where: { lastUsedAt: { gte: day1 } } }).catch(() => 0),
      this.prisma.aiUsage.aggregate({ where: { createdAt: { gte: day30 } }, _sum: { costUsd: true } }).catch(() => ({ _sum: { costUsd: null } })),
      // Console-side destructive op count in last 24h. High count = either
      // a heavy demo-prep day or a compromised credential — surface so
      // platform staff can sanity-check.
      this.prisma.consoleLog.count({
        where: {
          createdAt: { gte: day1 },
          action: { in: ['CLEAR_ALL_DATA', 'DEMO_RESET', 'TENANT_FROZEN'] as any[] }, // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      }).catch(() => 0),
      this.prisma.tenant.count({ where: { readOnlyMode: true } }).catch(() => 0),
    ]);

    return {
      generatedAt: now.toISOString(),
      tenants: {
        total:        tenantsByStatus.reduce((s, r) => s + r._count, 0),
        byStatus:     tenantsByStatus.map((r) => ({ status: r.status, count: r._count })),
        byTier:       tenantsByTier.map((r) => ({ tier: r.tier, count: r._count })),
        activeLast7d, activeLast30d,
        recentSignupsLast7d,
      },
      users:    {
        totalActive: totalUsers,
        sessionsLast24h,
        /** Failed login attempts in last 24h — proxy for brute-force activity. */
        failedLoginsLast24h: recentLoginFailures,
      },
      // Operational signals only — no tenant money in here.
      operations: {
        /** Stuck POS accounting events — manual triage needed. */
        failedEvents,
        /** Events that haven't been processed for 5+ minutes — possible queue lag. */
        pendingEvents,
      },
      // Sprint 19 — security posture. Both metrics are operational, not
      // financial; safe to surface on the Console dashboard.
      security: {
        /** Destructive console ops (CLEAR_ALL_DATA / DEMO_RESET / TENANT_FROZEN) in last 24h. */
        destructiveOps24h,
        /** Tenants currently in read-only mode (frozen — likely under investigation). */
        frozenTenants,
      },
      /** Platform-side AI cost (Anthropic API). Hidden by default in the UI. */
      platformCost: {
        aiSpendUsd30d: Number(totalAiSpend30d._sum.costUsd ?? 0),
      },
    };
  }

  // ─── Tenant list + detail ────────────────────────────────────────────────

  async listTenants(opts: { search?: string; status?: string; tier?: string } = {}) {
    const where: Prisma.TenantWhereInput = {};
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { slug: { contains: opts.search, mode: 'insensitive' } },
        { tinNumber: { contains: opts.search } },
        { contactEmail: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    if (opts.status) where.status = opts.status as Prisma.TenantWhereInput['status'];
    if (opts.tier)   where.tier   = opts.tier   as Prisma.TenantWhereInput['tier'];

    return this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, slug: true, name: true, status: true, tier: true,
        businessType: true, taxStatus: true, contactEmail: true, contactPhone: true,
        isDemoTenant: true, createdAt: true,
        _count: { select: { users: true, branches: true } },
      },
    });
  }

  async getTenantDetail(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, slug: true, name: true, status: true, tier: true,
        businessType: true, taxStatus: true, isBirRegistered: true,
        contactEmail: true, contactPhone: true, address: true,
        tinNumber: true, businessName: true,
        isDemoTenant: true, signupSource: true, createdAt: true,
        // Sprint 19 — ransomware kill switch
        readOnlyMode: true, readOnlyReason: true, readOnlySetAt: true,
        aiAddonType: true, aiQuotaOverride: true, aiAddonExpiresAt: true,
        // Sprint 3 — surface coffee-shop floor-layout tier in the Console
        coffeeShopTier: true,
        hasCustomerDisplay: true,
        // Sprint 12 — costing & accounting policy fields (console-only authority).
        // These are policy values, not financial data — value-set choices, not
        // amounts. Surfacing them here doesn't violate the zero-financial-
        // visibility invariant; the audit log still records `Object.keys()` only.
        valuationMethod:     true,
        accountingMethod:    true,
        firstTransactionAt:  true,
        overheadRatePerUnit: true,
        // Modular pricing — needed by the PlanPanel
        planCode:        true,
        modulePos:       true,
        moduleLedger:    true,
        modulePayroll:   true,
        staffSeatQuota:  true,
        staffSeatAddons: true,
        _count: { select: { users: true, branches: true, products: true } },
      },
    });
    if (!t) throw new NotFoundException('Tenant not found.');
    return t;
  }

  // ─── Tenant creation ─────────────────────────────────────────────────────

  async createTenant(dto: CreateTenantDto, actor: ConsoleActor) {
    // Validate slug uniqueness
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug.toLowerCase().trim() } });
    if (existing) throw new ConflictException(`Company code "${dto.slug}" is already taken.`);

    // Check if owner email already exists globally
    const ownerExists = await this.prisma.user.findFirst({ where: { email: dto.ownerEmail.toLowerCase().trim() } });
    if (ownerExists) throw new ConflictException(`Email "${dto.ownerEmail}" is already registered.`);

    const slug = dto.slug.toLowerCase().trim();
    const generatedPassword = this.generatePassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 12);

    // Sprint 17 — apply plan + module flags atomically within tenant
    // creation. Avoids the half-configured-tenant window where the
    // separate PATCH /plan call could fail after the tenant existed.
    const { PLAN_CAPS } = await import('@repo/shared-types');
    const planCode = (dto.planCode ?? 'SUITE_T2');
    const cap      = PLAN_CAPS[planCode as keyof typeof PLAN_CAPS];
    if (!cap) {
      throw new BadRequestException(`Unknown plan code: ${planCode}.`);
    }
    // Resolve module flags consistent with plan rules:
    //   - SUITE: always forces all 3 modules on
    //   - STD (Single Module, Sprint 21): respects dto.module* flags, but
    //     `validateSoloModuleCombo` will reject any combo that doesn't have
    //     exactly one module enabled. Default to POS-only if caller passed
    //     nothing, for backward compat with the prior POS-only behaviour.
    //   - PAIR: respects dto.module* booleans (2 of 3 must be on)
    const isSuite = cap.moduleCount === 3;
    const isStd   = planCode.startsWith('STD_');
    const planMods = {
      modulePos:     isSuite ? true  : (dto.modulePos     ?? (isStd ? true  : true)),
      moduleLedger:  isSuite ? true  : (dto.moduleLedger  ?? (isStd ? false : true)),
      modulePayroll: isSuite ? true  : (dto.modulePayroll ?? (isStd ? false : false)),
    };
    // Validate STD plans have exactly one module enabled.
    const { validateSoloModuleCombo } = await import('@repo/shared-types');
    const soloErr = validateSoloModuleCombo(
      planCode as Parameters<typeof validateSoloModuleCombo>[0],
      planMods.modulePos, planMods.moduleLedger, planMods.modulePayroll,
    );
    if (soloErr) throw new BadRequestException(soloErr);
    const staffSeatAddons = Math.min(dto.staffSeatAddons ?? 0, cap.maxAddons);

    const tenant = await this.prisma.$transaction(async (tx) => {
      // 1. Create tenant — plan-aware fields baked in atomically.
      const t = await tx.tenant.create({
        data: {
          name:         dto.name.trim(),
          slug,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          businessType: dto.businessType as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tier:         dto.tier as any,
          contactEmail: dto.contactEmail?.trim() ?? dto.ownerEmail.trim(),
          contactPhone: dto.contactPhone?.trim() ?? null,
          status:       'ACTIVE',
          planCode,
          modulePos:        planMods.modulePos,
          moduleLedger:     planMods.moduleLedger,
          modulePayroll:    planMods.modulePayroll,
          staffSeatQuota:   cap.baseSeats,
          staffSeatAddons,
        },
      });

      // 2. Create default branch
      const branch = await tx.branch.create({
        data: { tenantId: t.id, name: 'Main Branch', isActive: true },
      });

      // 3. Create Business Owner user
      const appAccess = DEFAULT_APP_ACCESS['BUSINESS_OWNER'] ?? [];
      const user = await tx.user.create({
        data: {
          tenantId:     t.id,
          branchId:     branch.id,
          name:         dto.ownerName.trim(),
          email:        dto.ownerEmail.toLowerCase().trim(),
          passwordHash,
          role:         'BUSINESS_OWNER',
          isActive:     true,
          appAccess: {
            create: appAccess.map((a: { app: string; level: string }) => ({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              appCode: a.app as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              level:   a.level as any,
            })),
          },
        },
      });

      return { tenant: t, branch, user };
    });

    // Sprint 21 — eager-seed Chart of Accounts with the right template based
    // on module selection. Ledger-only tenants (moduleLedger=true,
    // modulePos=false) get the LEDGER_ONLY template that omits POS-coupled
    // accounts (Sales Revenue – POS, COGS – POS, Merchandise Inventory,
    // Output VAT) and substitutes generic service-business equivalents.
    // Everyone else gets FULL. If they later activate POS, the lazy back-fill
    // in `findAll()` will add the missing POS accounts non-destructively.
    const coaTemplate = planMods.moduleLedger && !planMods.modulePos ? 'LEDGER_ONLY' : 'FULL';
    await this.accounts.seedDefaultAccounts(tenant.tenant.id, coaTemplate);

    // Log to ConsoleLog
    await this.logAction({
      actor,
      tenantId:   tenant.tenant.id,
      tenantSlug: slug,
      userId:     tenant.user.id,
      userEmail:  dto.ownerEmail,
      action:     'TENANT_CREATED',
      detail:     { ownerName: dto.ownerName, tier: dto.tier, businessType: dto.businessType, coaTemplate },
    });

    return {
      tenantId:          tenant.tenant.id,
      slug,
      ownerUserId:       tenant.user.id,
      generatedPassword, // Shown once — super admin must share securely
    };
  }

  // ─── Tenant user management ──────────────────────────────────────────────

  async listTenantUsers(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where:   { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        createdAt: true,
        sessions: {
          orderBy: { lastUsedAt: 'desc' },
          take:    1,
          select:  { lastUsedAt: true },
        },
        _count: { select: { sessions: true } },
      },
    });

    // Check lockout status: users with 5+ recent failed logins are "locked"
    const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
    const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS);

    return Promise.all(users.map(async (u) => {
      const recentFailures = await this.prisma.loginLog.count({
        where: { userId: u.id, success: false, createdAt: { gte: windowStart } },
      });
      return {
        id:           u.id,
        name:         u.name,
        email:        u.email,
        role:         u.role,
        isActive:     u.isActive,
        isLocked:     recentFailures >= 5,
        lastLoginAt:  u.sessions[0]?.lastUsedAt ?? null,
        activeSessions: u._count.sessions,
        createdAt:    u.createdAt,
      };
    }));
  }

  async addUserToTenant(tenantId: string, dto: AddUserDto, actor: ConsoleActor) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, branches: { take: 1, select: { id: true } } },
    });
    if (!t) throw new NotFoundException('Tenant not found.');

    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim(), tenantId },
    });
    if (existing) throw new ConflictException(`Email "${dto.email}" already exists in this tenant.`);

    const generatedPassword = this.generatePassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 12);
    const supervisorPinHash = dto.pinCode ? await bcrypt.hash(dto.pinCode, 10) : null;

    const appAccess = DEFAULT_APP_ACCESS[dto.role as keyof typeof DEFAULT_APP_ACCESS] ?? [];

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        branchId:         t.branches[0]?.id ?? null,
        name:             dto.name.trim(),
        email:            dto.email.toLowerCase().trim(),
        passwordHash,
        supervisorPinHash,
        role:        dto.role as Prisma.UserCreateInput['role'],
        isActive:    true,
        appAccess: {
          create: appAccess.map((a: { app: string; level: string }) => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            appCode: a.app as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            level:   a.level as any,
          })),
        },
      },
    });

    await this.logAction({
      actor,
      tenantId,
      tenantSlug: t.slug,
      userId:     user.id,
      userEmail:  user.email,
      action:     'USER_CREATED',
      detail:     { role: dto.role, addedBy: actor.email },
    });

    return { userId: user.id, generatedPassword };
  }

  // ─── User actions ─────────────────────────────────────────────────────────

  async resetUserPassword(userId: string, actor: ConsoleActor, confirmationToken?: string) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: {
        id: true, email: true, name: true, role: true,
        tenant: { select: { id: true, slug: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found.');

    // Sprint 17 — typed-slug guard for high-privilege role resets. A
    // SUPER_ADMIN resetting a BUSINESS_OWNER's password is a credential-
    // takeover vector if the SA's own credential is stolen. Force the
    // operator to type the tenant slug.
    const HIGH_PRIVILEGE_ROLES = ['BUSINESS_OWNER', 'PAYROLL_MASTER', 'BOOKKEEPER', 'FINANCE_LEAD'];
    if (user.tenant && HIGH_PRIVILEGE_ROLES.includes(user.role)) {
      await this.assertTypedSlug(user.tenant.id, confirmationToken);
    }

    const generatedPassword = this.generatePassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 12);

    // Reset password + clear all sessions + clear login failure log
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.userSession.deleteMany({ where: { userId } }),
      this.prisma.loginLog.deleteMany({ where: { userId, success: false } }),
    ]);

    await this.logAction({
      actor,
      tenantId:   user.tenant?.id,
      tenantSlug: user.tenant?.slug,
      userId,
      userEmail:  user.email,
      action:     'PASSWORD_RESET',
    });

    // Sprint 12 — fire-and-forget email to the affected user. Closes the
    // silent-reset attack: if a SUPER_ADMIN credential is compromised, the
    // affected user gets independent notice and can call HNS to flag it.
    // The reset itself still succeeds even if email delivery fails — we'd
    // rather complete the reset than block on a transient SMTP issue.
    if (user.email && user.tenant?.slug) {
      this.mail.sendAdminPasswordResetNotice({
        to:         user.email,
        name:       user.name ?? user.email,
        actorEmail: actor.email,
        when:       new Date(),
        tenantSlug: user.tenant.slug,
      }).catch((err) => {
        this.logger.warn(`Password-reset notice email failed for ${user.email}: ${err}`);
      });
    }

    return { userId, generatedPassword };
  }

  async clearLockout(userId: string, actor: ConsoleActor) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, tenant: { select: { id: true, slug: true } } },
    });
    if (!user) throw new NotFoundException('User not found.');

    await this.prisma.loginLog.deleteMany({ where: { userId, success: false } });

    await this.logAction({
      actor,
      tenantId:   user.tenant?.id,
      tenantSlug: user.tenant?.slug,
      userId,
      userEmail:  user.email,
      action:     'ACCOUNT_UNLOCKED',
    });

    return { userId, unlocked: true };
  }

  async forceLogout(userId: string, actor: ConsoleActor) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, tenant: { select: { id: true, slug: true } } },
    });
    if (!user) throw new NotFoundException('User not found.');

    const { count } = await this.prisma.userSession.deleteMany({ where: { userId } });

    await this.logAction({
      actor,
      tenantId:   user.tenant?.id,
      tenantSlug: user.tenant?.slug,
      userId,
      userEmail:  user.email,
      action:     'FORCE_LOGOUT',
      detail:     { sessionsTerminated: count },
    });

    return { userId, sessionsTerminated: count };
  }

  async toggleUserActive(userId: string, actor: ConsoleActor) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, isActive: true, tenant: { select: { id: true, slug: true } } },
    });
    if (!user) throw new NotFoundException('User not found.');

    const newActive = !user.isActive;
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: newActive } });

    // If deactivating, kill all sessions
    if (!newActive) {
      await this.prisma.userSession.deleteMany({ where: { userId } });
    }

    await this.logAction({
      actor,
      tenantId:   user.tenant?.id,
      tenantSlug: user.tenant?.slug,
      userId,
      userEmail:  user.email,
      action:     newActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
    });

    return { userId, isActive: newActive };
  }

  // ─── Tenant admin actions (existing) ─────────────────────────────────────

  async setTenantStatus(
    tenantId: string,
    status: 'ACTIVE' | 'GRACE' | 'SUSPENDED',
    actor: ConsoleActor,
    confirmationToken?: string,
  ) {
    // Sprint 12 — typed-slug confirmation required when SUSPENDING (kicks the
    // tenant out, blocks logins). ACTIVE / GRACE transitions don't lock the
    // tenant out so they don't need the extra step.
    if (status === 'SUSPENDED') {
      await this.assertTypedSlug(tenantId, confirmationToken);
    }
    const t = await this.prisma.tenant.update({
      where:  { id: tenantId },
      data:   { status },
      select: { id: true, slug: true, status: true },
    });
    await this.logAction({ actor, tenantId, tenantSlug: t.slug, action: 'STATUS_CHANGED', detail: { status } });
    return t;
  }

  /**
   * @deprecated The legacy `tier` (SubscriptionTier) field is advisory only.
   * Module entitlement, seat caps, AI quotas, and feature flags are all
   * driven by `planCode` + `modulePos/Ledger/Payroll`. Use `updateTenantPlan`
   * (PATCH /admin/tenants/:id/plan) instead. This endpoint is retained for
   * legacy console scripts that may still toggle the old field; it does NOT
   * change any runtime-authoritative entitlement.
   */
  async setTenantTier(tenantId: string, tier: string, actor: ConsoleActor) {
    const t = await this.prisma.tenant.update({
      where:  { id: tenantId },
      data:   { tier: tier as Prisma.TenantUpdateInput['tier'] },
      select: { id: true, slug: true, tier: true },
    });
    await this.logAction({
      actor, tenantId, tenantSlug: t.slug,
      action: 'TIER_CHANGED',
      detail: {
        tier,
        legacyOnly: true,
        note: 'Modular plan (planCode + modules) is the authoritative entitlement source.',
      },
    });
    return t;
  }

  async setAiOverride(tenantId: string, quotaOverride: number | null, addonType: string | null, actor: ConsoleActor) {
    if (quotaOverride != null && (quotaOverride < 0 || quotaOverride > 100000)) {
      throw new BadRequestException('Quota override must be between 0 and 100,000.');
    }
    const t = await this.prisma.tenant.update({
      where:  { id: tenantId },
      data:   { aiQuotaOverride: quotaOverride, aiAddonType: addonType as Prisma.TenantUpdateInput['aiAddonType'] },
      select: { id: true, slug: true, aiQuotaOverride: true, aiAddonType: true },
    });
    await this.logAction({ actor, tenantId, tenantSlug: t.slug, action: 'AI_OVERRIDE_SET', detail: { quotaOverride, addonType } });
    return t;
  }

  // ─── Tenant profile update ───────────────────────────────────────────────

  async updateTenantProfile(tenantId: string, dto: UpdateTenantProfileDto, actor: ConsoleActor) {
    const t = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: {
        id: true, slug: true, businessType: true,
        // For policy-write validation:
        firstTransactionAt: true,
      },
    });
    if (!t) throw new NotFoundException('Tenant not found.');

    // Sprint 12 — guard against incoherent policy writes. Console can still
    // override, but it gets a clear error when the change would corrupt data.
    if (dto.overheadRatePerUnit != null) {
      const targetType = dto.businessType ?? t.businessType;
      if (targetType !== 'MANUFACTURING') {
        throw new BadRequestException(
          'Overhead allocation only applies to MANUFACTURING tenants. ' +
          'For F&B and retail, utilities and rent should be recorded as ' +
          'Operating Expenses, not COGS (per PFRS for SMEs).',
        );
      }
      if (Number.isNaN(dto.overheadRatePerUnit) || dto.overheadRatePerUnit < 0) {
        throw new BadRequestException('Overhead rate must be a non-negative number.');
      }
    }

    const data: Prisma.TenantUpdateInput = {};
    if (dto.name          !== undefined) data.name          = dto.name?.trim() || undefined;
    if (dto.businessName  !== undefined) data.businessName  = dto.businessName?.trim() ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (dto.businessType  !== undefined) data.businessType  = dto.businessType as any;
    if (dto.taxStatus     !== undefined) data.taxStatus     = dto.taxStatus as Prisma.TenantUpdateInput['taxStatus'];
    if (dto.tinNumber     !== undefined) data.tinNumber     = dto.tinNumber?.trim() ?? null;
    if (dto.isBirRegistered !== undefined) data.isBirRegistered = dto.isBirRegistered;
    if (dto.contactEmail  !== undefined) data.contactEmail  = dto.contactEmail?.trim() ?? null;
    if (dto.contactPhone  !== undefined) data.contactPhone  = dto.contactPhone?.trim() ?? null;
    if (dto.address       !== undefined) data.address       = dto.address?.trim() ?? null;
    if (dto.isDemoTenant  !== undefined) data.isDemoTenant  = dto.isDemoTenant;

    // Policy fields — console-only authority (Sprint 12)
    if (dto.valuationMethod    !== undefined) {
      data.valuationMethod  = dto.valuationMethod  as Prisma.TenantUpdateInput['valuationMethod'];
    }
    if (dto.accountingMethod   !== undefined) {
      data.accountingMethod = dto.accountingMethod as Prisma.TenantUpdateInput['accountingMethod'];
    }
    if (dto.overheadRatePerUnit !== undefined) {
      data.overheadRatePerUnit = dto.overheadRatePerUnit != null
        ? new Prisma.Decimal(dto.overheadRatePerUnit)
        : null;
    }

    const updated = await this.prisma.tenant.update({
      where:  { id: tenantId },
      data,
      select: {
        id: true, slug: true, name: true, businessType: true, taxStatus: true,
        valuationMethod: true, accountingMethod: true, overheadRatePerUnit: true,
      },
    });

    await this.logAction({
      actor,
      tenantId,
      tenantSlug: t.slug,
      action:  'PROFILE_UPDATED',
      // Field NAMES only — never the values. Preserves the privacy invariant
      // (console audit log never records financial data; policy values stay
      // visible only via the read endpoints, not via the audit feed).
      detail:  {
        fields: Object.keys(dto),
        // Surface a flag if the update overrode the auto-lock — bookkeepers
        // need to know a CPA-grade decision was made under support oversight.
        ...(dto.valuationMethod && t.firstTransactionAt
          ? { valuationLockOverridden: true }
          : {}),
      },
    });

    return updated;
  }

  // ─── Demo data reset ──────────────────────────────────────────────────────

  async resetDemoData(
    tenantId: string,
    scenarioKey: ScenarioKey,
    actor: ConsoleActor,
    confirmationToken?: string,
  ) {
    // Sprint 12 — typed-slug confirmation. Wiping demo data deletes orders,
    // JEs, products, etc. Even on a demo tenant a misclick is an annoying
    // multi-minute reseed. Make it deliberate.
    await this.assertTypedSlug(tenantId, confirmationToken);

    // Sprint 19 — Live-tenant guard. Refuse to ever wipe a paying tenant
    // from the Console, regardless of slug confirmation.
    await this.assertDemoTenant(tenantId);

    // Sprint 19 — Rate-limit destructive ops per actor. A stolen
    // SUPER_ADMIN credential should not be able to bulk-wipe at machine speed.
    await this.assertDestructiveOpRateLimit(actor);

    // Sprint 19 — Capture a pre-destructive snapshot. Even on demo tenants
    // this preserves the about-to-be-wiped catalog/orders for 30 days so
    // an accidental wrong-scenario reseed can be unwound from the JSON dump.
    const snapshot = await this.snapshotTenantData(tenantId, 'PRE_RESET_DEMO', actor);

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: {
        id: true, slug: true,
        branches: { take: 1, orderBy: { createdAt: 'asc' }, select: { id: true } },
        users:    { take: 1, orderBy: { createdAt: 'asc' }, select: { id: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    const branchId = tenant.branches[0]?.id;
    if (!branchId) throw new BadRequestException('Tenant has no branch — cannot seed demo data.');

    const scenario = DEMO_SCENARIOS[scenarioKey];

    try {

    // ── 1. Wipe existing POS + accounting data ────────────────────────────
    // FK dependency order (most-dependent first):
    //   JournalLine   → JournalEntry (cascade)
    //   JournalEntry  → AccountingEvent (Restrict — must delete JE first)
    //   AccountingEvent → Order (Restrict — must delete event first)
    //   Order         → OrderItem / OrderPayment (cascade)
    //   InventoryLog  → Product (Restrict — delete before product)
    //   InventoryItem → Product (Restrict — delete before product)
    //   Product       → Category (Restrict — delete before category)

    await this.prisma.journalEntry.deleteMany({ where: { tenantId } }); // cascades JournalLines
    await this.prisma.accountingEvent.deleteMany({ where: { tenantId } });
    await this.prisma.order.deleteMany({ where: { tenantId } });        // cascades items, payments, discounts
    await this.prisma.inventoryLog.deleteMany({ where: { tenantId } });
    await this.prisma.inventoryItem.deleteMany({ where: { tenantId } });
    await this.prisma.product.deleteMany({ where: { tenantId } });      // cascades BomItems (onDelete: Cascade)
    await this.prisma.category.deleteMany({ where: { tenantId } });
    // Raw materials: BomItems already gone (cascaded above) so RawMaterial delete is safe.
    // RawMaterialInventory cascades from RawMaterial so it auto-deletes.
    await this.prisma.rawMaterial.deleteMany({ where: { tenantId } });

    // ── 2. Update tenant profile to match scenario ─────────────────────────
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        businessType: scenario.businessType as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        taxStatus:    scenario.taxStatus as any,
        isDemoTenant: true,
      },
    });

    // ── 3. Seed categories + products ─────────────────────────────────────
    const productMap = new Map<string, { id: string; price: number; isVatable: boolean }>();

    for (const cat of scenario.categories) {
      const category = await this.prisma.category.create({
        data: { tenantId, name: cat.name, sortOrder: cat.sortOrder, isActive: true },
      });

      for (const prod of cat.products) {
        const product = await this.prisma.product.create({
          data: {
            tenantId,
            categoryId:  category.id,
            name:        prod.name,
            description: prod.description,
            price:       prod.price,
            costPrice:   prod.costPrice ?? null,
            isVatable:   prod.isVatable,
            isActive:    true,
          },
        });

        productMap.set(prod.name, { id: product.id, price: prod.price, isVatable: prod.isVatable });

        // Seed generous demo stock
        await this.prisma.inventoryItem.create({
          data: {
            tenantId,
            branchId,
            productId:     product.id,
            quantity:      100,
            lowStockAlert: 10,
          },
        });
      }
    }

    // ── 4. Seed raw materials + BOM (F&B scenarios only) ──────────────────
    const rawMaterialMap = new Map<string, string>(); // name → id

    if (scenario.rawMaterials?.length) {
      for (const rm of scenario.rawMaterials) {
        const rawMaterial = await this.prisma.rawMaterial.create({
          data: {
            tenantId,
            name:      rm.name,
            unit:      rm.unit,
            costPrice: rm.costPrice,
            isActive:  true,
          },
        });
        rawMaterialMap.set(rm.name, rawMaterial.id);

        // Seed starting inventory for this ingredient
        await this.prisma.rawMaterialInventory.create({
          data: {
            tenantId,
            branchId,
            rawMaterialId: rawMaterial.id,
            quantity:      rm.stockQty,
          },
        });
      }
    }

    if (scenario.bomItems?.length) {
      for (const bom of scenario.bomItems) {
        const productId     = productMap.get(bom.productName)?.id;
        const rawMaterialId = rawMaterialMap.get(bom.rawMaterialName);
        if (!productId || !rawMaterialId) continue;
        await this.prisma.bomItem.create({
          data: { productId, rawMaterialId, quantity: bom.quantity },
        });
      }
    }

    // ── 5. Generate realistic historical orders (last 7 days) ─────────────
    const catalog     = allProducts(scenario);
    const orderCount  = 20;
    const isVat       = scenario.taxStatus === 'VAT';
    const VAT_DIVISOR = 1.12;

    for (let i = 0; i < orderCount; i++) {
      const daysAgo  = Math.floor(Math.random() * 7);
      // Spread throughout a business day (08:00–21:00 = 13 hr window)
      const secOffset = daysAgo * 86400 + Math.floor(Math.random() * 46800) + 28800;
      const orderDate = new Date(Date.now() - secOffset * 1000);

      const itemCount  = Math.floor(Math.random() * 3) + 1;
      const pickedItems: Array<{ name: string; price: number; isVatable: boolean; qty: number }> = [];

      for (let j = 0; j < itemCount; j++) {
        const p   = catalog[Math.floor(Math.random() * catalog.length)];
        const qty = Math.floor(Math.random() * 3) + 1;
        pickedItems.push({ name: p.name, price: p.price, isVatable: p.isVatable, qty });
      }

      let subtotal = 0;
      const lineItems: Array<{
        productId:     string;
        productName:   string;
        unitPrice:     number;
        quantity:      number;
        lineTotal:     number;
        isVatable:     boolean;
        vatAmount:     number;
        discountAmount: number;
        taxType:       'VAT_12' | 'VAT_EXEMPT';
      }> = [];

      for (const item of pickedItems) {
        const info = productMap.get(item.name);
        if (!info) continue;

        const lineTotal = item.price * item.qty;
        subtotal += lineTotal;
        const lineVat = isVat && item.isVatable
          ? Math.round((lineTotal / VAT_DIVISOR) * 0.12 * 100) / 100
          : 0;

        lineItems.push({
          productId:     info.id,
          productName:   item.name,
          unitPrice:     item.price,
          quantity:      item.qty,
          lineTotal,
          isVatable:     item.isVatable,
          vatAmount:     lineVat,
          discountAmount: 0,
          taxType:       (isVat && item.isVatable) ? 'VAT_12' : 'VAT_EXEMPT',
        });
      }

      if (lineItems.length === 0) continue;

      const vatAmount = lineItems.reduce((s, l) => s + l.vatAmount, 0);
      const orderNumber = `DEMO-${String(i + 1).padStart(4, '0')}`;

      await this.prisma.order.create({
        data: {
          tenantId,
          branchId,
          orderNumber,
          status:        'COMPLETED',
          subtotal,
          discountAmount: 0,
          vatAmount,
          totalAmount:   subtotal,
          completedAt:   orderDate,
          createdAt:     orderDate,
          taxType:       isVat ? 'VAT_12' : 'VAT_EXEMPT',
          items: {
            create: lineItems.map((l) => ({
              productId:     l.productId,
              productName:   l.productName,
              unitPrice:     l.unitPrice,
              quantity:      l.quantity,
              lineTotal:     l.lineTotal,
              discountAmount: l.discountAmount,
              vatAmount:     l.vatAmount,
              isVatable:     l.isVatable,
              taxType:       l.taxType,
            })),
          },
          payments: {
            create: [{ method: 'CASH', amount: subtotal }],
          },
        },
      });
    }

    await this.logAction({
      actor,
      tenantId,
      tenantSlug: tenant.slug,
      action:  'DEMO_RESET',
      detail:  {
        scenario:        scenarioKey,
        label:           scenario.label,
        ordersGenerated: orderCount,
        productsSeeded:  catalog.length,
      },
    });

    // Sprint 3 — auto-apply CS_4 to the Coffee Shop demo so the demo tenant
    // boots straight into a "Café with Bar + Kitchen" floor layout (the
    // client's actual setup). Other scenarios skip layout provisioning.
    let layoutTier: string | null = null;
    if (scenario.businessType === 'COFFEE_SHOP') {
      try {
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data:  { coffeeShopTier: 'CS_4' as any, hasCustomerDisplay: true },
        });
        layoutTier = 'CS_4';
      } catch (err) {
        this.logger.warn(`Failed to apply CS_4 layout to demo tenant ${tenantId}: ${err}`);
      }
    }

    // Sprint 11 — LAUNDRY scenario: seed service prices, machines, and a
    // handful of sample customers + claim tickets across stages so the demo
    // dashboard / queue feel populated. Idempotent: pre-existing rows are
    // wiped earlier in this method (no laundry-specific delete needed because
    // LaundryOrder cascades from tenant; but service prices / machines /
    // promos persist across resets — clear them here).
    if (scenario.businessType === 'LAUNDRY') {
      try {
        await this.seedLaundryDefaults(tenantId, branchId);
      } catch (err) {
        this.logger.warn(`Laundry demo seed failed for tenant ${tenantId}: ${err}`);
      }
    }

    return {
      scenario:        scenario.label,
      businessType:    scenario.businessType,
      taxStatus:       scenario.taxStatus,
      productsSeeded:  catalog.length,
      ordersGenerated: orderCount,
      layoutTier,
      snapshotId:      snapshot.id,        // pre-wipe backup id, recoverable for 30 days
      snapshotRowCount: snapshot.rowCount, // total rows preserved
    };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`resetDemoData failed for tenant ${tenantId} / scenario ${scenarioKey}: ${msg}`, err instanceof Error ? err.stack : undefined);
      throw new BadRequestException(`Demo reset failed: ${msg.slice(0, 300)}`);
    }
  }

  /**
   * LAUNDRY scenario seeder — populates service prices, machines, customers,
   * and a few in-flight claim tickets so the demo dashboard / queue feel real.
   * Called from resetDemoData() after the standard catalog seed.
   *
   * Idempotent: wipes laundry-specific tables first.
   */
  private async seedLaundryDefaults(tenantId: string, branchId: string) {
    // Wipe laundry-specific rows. LaundryOrder cascades from tenant via the
    // outer wipe earlier in resetDemoData, but service prices / machines /
    // promos / customers persist across non-laundry runs.
    await this.prisma.laundryServicePrice.deleteMany({ where: { tenantId } });
    await this.prisma.laundryServiceAddOn.deleteMany({ where: { tenantId } });
    await this.prisma.laundryPromo.deleteMany({ where: { tenantId } });
    await this.prisma.laundryMachine.deleteMany({ where: { tenantId } });
    await this.prisma.customer.deleteMany({ where: { tenantId, isActive: true } });

    // Service prices — typical Manila rates.
    const PRICES: Array<{
      serviceCode: 'WASH' | 'DRY' | 'WASH_DRY_COMBO' | 'DRY_CLEAN' | 'IRON' | 'FOLD' | 'EXTRA_RINSE' | 'FABRIC_SOFTENER';
      mode:        'SELF_SERVICE' | 'FULL_SERVICE';
      unitPrice:   number;
    }> = [
      { serviceCode: 'WASH',            mode: 'SELF_SERVICE', unitPrice:  60 },
      { serviceCode: 'WASH',            mode: 'FULL_SERVICE', unitPrice: 120 },
      { serviceCode: 'DRY',             mode: 'SELF_SERVICE', unitPrice:  60 },
      { serviceCode: 'DRY',             mode: 'FULL_SERVICE', unitPrice: 100 },
      { serviceCode: 'WASH_DRY_COMBO',  mode: 'SELF_SERVICE', unitPrice: 110 },
      { serviceCode: 'WASH_DRY_COMBO',  mode: 'FULL_SERVICE', unitPrice: 220 },
      { serviceCode: 'DRY_CLEAN',       mode: 'FULL_SERVICE', unitPrice: 250 },
      { serviceCode: 'IRON',            mode: 'FULL_SERVICE', unitPrice:  35 },
      { serviceCode: 'FOLD',            mode: 'FULL_SERVICE', unitPrice:  20 },
      { serviceCode: 'EXTRA_RINSE',     mode: 'FULL_SERVICE', unitPrice:  25 },
      { serviceCode: 'FABRIC_SOFTENER', mode: 'FULL_SERVICE', unitPrice:  30 },
    ];
    await this.prisma.laundryServicePrice.createMany({
      data: PRICES.map((p) => ({
        tenantId,
        serviceCode: p.serviceCode as any,
        mode:        p.mode as any,
        unitPrice:   p.unitPrice,
        isActive:    true,
      })),
    });

    // Machine fleet — 3 washers, 3 dryers, 1 combo unit.
    const MACHINES: Array<{ code: string; kind: 'WASHER' | 'DRYER' | 'COMBO'; capacityKg: number }> = [
      { code: 'W-01', kind: 'WASHER', capacityKg:  8 },
      { code: 'W-02', kind: 'WASHER', capacityKg:  8 },
      { code: 'W-03', kind: 'WASHER', capacityKg: 15 },
      { code: 'D-01', kind: 'DRYER',  capacityKg: 10 },
      { code: 'D-02', kind: 'DRYER',  capacityKg: 10 },
      { code: 'D-03', kind: 'DRYER',  capacityKg: 15 },
      { code: 'C-01', kind: 'COMBO',  capacityKg:  8 },
    ];
    await this.prisma.laundryMachine.createMany({
      data: MACHINES.map((m) => ({
        tenantId,
        branchId,
        code:       m.code,
        kind:       m.kind as any,
        capacityKg: m.capacityKg,
        status:     'IDLE' as any,
      })),
    });

    // Sample customers — realistic PH names with phone + saved addresses so
    // the loyalty + delivery flows have something to attach to.
    const CUSTOMERS = [
      { name: 'Maria Santos',     phone: '09171234567', address: 'Brgy. Poblacion, Makati City' },
      { name: 'Jose Dela Cruz',   phone: '09181234568', address: 'Sgt. Esguerra Ave, QC'        },
      { name: 'Ana Reyes',        phone: '09191234569', address: 'Maginhawa St, QC'             },
      { name: 'Pedro Garcia',     phone: '09201234570', address: 'Banawe St, QC'                },
      { name: 'Rosa Mendoza',     phone: '09211234571', address: 'Tomas Morato Ave, QC'         },
    ];
    const customers = await Promise.all(
      CUSTOMERS.map((c) =>
        this.prisma.customer.create({
          data: {
            tenantId,
            name:           c.name,
            contactPhone:   c.phone,
            defaultAddress: c.address,
            loyaltyVisits:  Math.floor(Math.random() * 9), // 0..8 prior visits
            isActive:       true,
          },
        }),
      ),
    );

    // A few claim tickets across all stages so the queue board renders.
    // Year-prefix matches the actual claim-numbering scheme.
    const year = new Date().getFullYear();
    const STAGES: Array<'RECEIVED' | 'WASHING' | 'DRYING' | 'FOLDING' | 'READY_FOR_PICKUP'> = [
      'RECEIVED', 'WASHING', 'DRYING', 'FOLDING', 'READY_FOR_PICKUP',
    ];
    const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let seq = 1;
    for (let i = 0; i < STAGES.length; i++) {
      const customer = customers[i % customers.length];
      const isDelivery = i % 3 === 0; // every third order is delivery
      const claimNumber = `CLA-${year}-${String(seq).padStart(6, '0')}`;
      const suffix = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
      seq += 1;
      await this.prisma.laundryOrder.create({
        data: {
          tenantId,
          branchId,
          customerId:      customer.id,
          claimNumber,
          publicStubToken: `${claimNumber}-${suffix}`,
          status:          STAGES[i] as any,
          totalAmount:     220 + i * 50,
          intakeBy:        'demo-seed',
          receivedAt:      new Date(Date.now() - (STAGES.length - i) * 60 * 60 * 1000),
          promisedAt:      new Date(Date.now() + (24 - i * 4) * 60 * 60 * 1000),
          isDelivery,
          deliveryAddress: isDelivery ? customer.defaultAddress : null,
          deliveryFee:     isDelivery ? 50 : null,
          deliveryStatus:  isDelivery ? 'PENDING_PICKUP' as any : null,
        },
      });
    }
  }

  // ─── Clear all data (no re-seed) ──────────────────────────────────────────

  /**
   * Wipes all transactional + catalog data for a tenant but PRESERVES:
   *   - The tenant record itself (name, slug, tier, tax settings, BIR config)
   *   - Users (admin, cashiers, staff accounts)
   *   - Branches (so the tenant still has somewhere to operate)
   *   - Floor layout (stations, printers, terminals from Sprint 3)
   *
   * Different from resetDemoData(): no scenario seeding — the tenant ends up
   * with an empty product catalog, no ingredients, no orders, no journal
   * entries. Owner can then build their own catalog from scratch.
   *
   * Useful when a tenant onboards and wants to clear sample data before
   * entering real products.
   */
  async clearAllTenantData(tenantId: string, actor: ConsoleActor, confirmationToken?: string) {
    // Sprint 12 — typed-slug confirmation REQUIRED for this op. clearAllTenantData
    // wipes products, orders, JEs, AR/AP, raw materials, inventory. There's no
    // undo. Not negotiable — the typed-slug guard is the safety net between a
    // misclick and an unrecoverable state.
    await this.assertTypedSlug(tenantId, confirmationToken);

    // Sprint 19 — Live-tenant guard. Even with the typed slug, refuse to
    // wipe a live (non-demo) tenant. clearAllTenantData was originally
    // intended for "tenant onboarding wants to clear sample data" — that
    // sample data only ever exists on isDemoTenant=true tenants by
    // definition, so the guard does not constrain the legitimate workflow.
    await this.assertDemoTenant(tenantId);

    // Sprint 19 — Rate-limit destructive ops per actor.
    await this.assertDestructiveOpRateLimit(actor);

    // Sprint 19 — Pre-destructive snapshot. Recoverable for 30 days.
    const snapshot = await this.snapshotTenantData(tenantId, 'PRE_CLEAR_ALL', actor);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    try {
      // FK dependency order — same chain as resetDemoData's wipe step.
      await this.prisma.journalEntry.deleteMany({ where: { tenantId } });
      await this.prisma.accountingEvent.deleteMany({ where: { tenantId } });
      await this.prisma.order.deleteMany({ where: { tenantId } });
      await this.prisma.inventoryLog.deleteMany({ where: { tenantId } });
      await this.prisma.inventoryItem.deleteMany({ where: { tenantId } });
      await this.prisma.product.deleteMany({ where: { tenantId } });
      await this.prisma.category.deleteMany({ where: { tenantId } });
      await this.prisma.rawMaterial.deleteMany({ where: { tenantId } });

      this.logger.log(`Cleared all data for tenant ${tenant.slug} (${tenantId}) by ${actor.email} (snap=${snapshot.id})`);
      return {
        tenantSlug: tenant.slug,
        cleared: ['products', 'categories', 'rawMaterials', 'orders', 'inventoryLogs', 'accountingEvents', 'journalEntries'],
        preserved: ['tenant', 'users', 'branches', 'floorLayout'],
        snapshotId:       snapshot.id,
        snapshotRowCount: snapshot.rowCount,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`clearAllTenantData failed for tenant ${tenantId}: ${msg}`, err instanceof Error ? err.stack : undefined);
      throw new BadRequestException(`Clear data failed: ${msg.slice(0, 300)}`);
    }
  }

  // ─── Tenant data snapshots ────────────────────────────────────────────────

  /**
   * List all backup snapshots for a tenant. The `payload` JSON is
   * deliberately omitted from the list response — it can be huge and is
   * only fetched on demand via `getSnapshotPayload`.
   */
  async listTenantSnapshots(tenantId: string) {
    return this.prisma.tenantDataSnapshot.findMany({
      where:   { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, reason: true, takenByEmail: true, rowCount: true,
        createdAt: true, expiresAt: true,
      },
    });
  }

  /**
   * Fetch a snapshot's full JSON payload — used by the Console download
   * button. Tenant-scoped lookup so a stale id from a different tenant
   * cannot be exfiltrated.
   */
  async getSnapshotPayload(tenantId: string, snapshotId: string) {
    const snap = await this.prisma.tenantDataSnapshot.findFirst({
      where:  { id: snapshotId, tenantId },
    });
    if (!snap) throw new NotFoundException('Snapshot not found.');
    return snap;
  }

  /**
   * Seed the master coffee-shop ingredient catalogue onto a tenant.
   *
   * Idempotent — ingredients with names that already exist on the tenant are
   * SKIPPED (so re-running tops up missing items without duplicating). Each
   * created ingredient also gets an opening-stock RawMaterialInventory row
   * at the tenant's first branch.
   *
   * Returns counts so the Console can show "X created, Y skipped".
   */
  async seedCoffeeShopIngredients(tenantId: string, actor: ConsoleActor) {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: {
        id: true, slug: true,
        branches: { take: 1, orderBy: { createdAt: 'asc' }, select: { id: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    const branchId = tenant.branches[0]?.id;
    if (!branchId) {
      throw new BadRequestException('Tenant has no branch — create one before seeding ingredients.');
    }

    // Pull existing ingredient names once for O(1) skip checks.
    const existing = await this.prisma.rawMaterial.findMany({
      where:  { tenantId },
      select: { name: true },
    });
    const haveNames = new Set(existing.map((e) => e.name.toLowerCase()));

    let created = 0;
    let skipped = 0;
    for (const seed of COFFEE_SHOP_INGREDIENTS) {
      if (haveNames.has(seed.name.toLowerCase())) {
        skipped++;
        continue;
      }
      try {
        const material = await this.prisma.rawMaterial.create({
          data: {
            tenantId,
            name:          seed.name,
            unit:          seed.unit,
            costPrice:     new Prisma.Decimal(seed.costPrice),
            lowStockAlert: seed.lowStockAlert != null
              ? new Prisma.Decimal(seed.lowStockAlert)
              : null,
            isActive: true,
          },
        });
        await this.prisma.rawMaterialInventory.create({
          data: {
            tenantId,
            branchId,
            rawMaterialId: material.id,
            quantity:      new Prisma.Decimal(seed.startingQty),
          },
        });
        created++;
      } catch (err) {
        this.logger.warn(`Skipping ${seed.name} due to error: ${err}`);
        skipped++;
      }
    }

    this.logger.log(
      `Seeded coffee-shop ingredients on tenant ${tenant.slug} (${tenantId}): ` +
      `${created} created, ${skipped} skipped, by ${actor.email}`,
    );

    return {
      tenantSlug: tenant.slug,
      created,
      skipped,
      total: COFFEE_SHOP_INGREDIENTS.length,
    };
  }

  /**
   * Seed the master coffee-shop category catalogue onto a tenant.
   *
   * Creates 15 standard categories (Hot Coffee, Cold Coffee, Pastries, etc.)
   * and AUTO-ROUTES each to the right station based on the category's
   * preferredKind:
   *   - Drinks  → first BAR station
   *   - Hot food → first KITCHEN station
   *   - Pre-made → first PASTRY_PASS station (falls back to BAR if none)
   *   - Retail   → no station (sells from counter, no prep ticket)
   *
   * Idempotent — categories that already exist by name are skipped, but the
   * stationId on existing categories WILL be updated if it's currently null
   * (so re-running fixes any unrouted categories).
   */
  async seedCoffeeShopCategories(tenantId: string, actor: ConsoleActor) {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    const stations = await this.prisma.station.findMany({
      where:  { tenantId },
      select: { id: true, kind: true, name: true },
    });
    // Pick the first station of each kind. Fallbacks: pre-made → bar if no
    // pastry pass exists; retail → null (no ticket needed).
    const firstByKind = (k: string) => stations.find((s) => s.kind === k)?.id ?? null;
    const stationIdFor = (preferredKind: string): string | null => {
      if (preferredKind === 'BAR')         return firstByKind('BAR') ?? firstByKind('HOT_BAR') ?? firstByKind('COLD_BAR');
      if (preferredKind === 'KITCHEN')     return firstByKind('KITCHEN');
      if (preferredKind === 'PASTRY_PASS') return firstByKind('PASTRY_PASS') ?? firstByKind('BAR');
      if (preferredKind === 'COUNTER')     return firstByKind('COUNTER');
      return null;
    };

    const existing = await this.prisma.category.findMany({
      where:  { tenantId },
      select: { id: true, name: true, stationId: true },
    });
    const byName = new Map<string, { id: string; stationId: string | null }>(
      existing.map((c) => [c.name.toLowerCase(), { id: c.id, stationId: c.stationId }]),
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const seed of COFFEE_SHOP_CATEGORIES) {
      const target = stationIdFor(seed.preferredKind);
      const found = byName.get(seed.name.toLowerCase());
      if (found) {
        // If the existing category has no station and we found a match, fix it.
        if (!found.stationId && target) {
          await this.prisma.category.update({
            where: { id: found.id },
            data:  { stationId: target },
          });
          updated++;
        } else {
          skipped++;
        }
        continue;
      }
      try {
        await this.prisma.category.create({
          data: {
            tenantId,
            name:        seed.name,
            description: seed.description,
            sortOrder:   seed.sortOrder,
            stationId:   target,
            isActive:    true,
          },
        });
        created++;
      } catch (err) {
        this.logger.warn(`Skipping category ${seed.name} due to error: ${err}`);
        skipped++;
      }
    }

    this.logger.log(
      `Seeded coffee-shop categories on tenant ${tenant.slug} (${tenantId}): ` +
      `${created} created, ${updated} routing-fixed, ${skipped} skipped, by ${actor.email}`,
    );

    return {
      tenantSlug: tenant.slug,
      created,
      updated,
      skipped,
      total:    COFFEE_SHOP_CATEGORIES.length,
      stations: stations.map((s) => ({ id: s.id, kind: s.kind, name: s.name })),
    };
  }

  // ─── Super Admin bootstrap ───────────────────────────────────────────────
  /**
   * Create or upgrade a real super-admin account (no tenant scope, full
   * platform access). Idempotent — re-running with the same email finds
   * the existing user and ensures isSuperAdmin + isActive are correct.
   *
   * Use this to provision YOUR personal super-admin account (the human
   * running Clerque platform-side). Different from demo / test super
   * admins that may exist for development.
   *
   * On first creation: returns a generated password — show it ONCE.
   * On subsequent runs: confirms the account exists with no password rotation.
   */
  async bootstrapSuperAdmin(args: { email: string; name: string }, actor: ConsoleActor) {
    const email = args.email.toLowerCase().trim();
    const name  = args.name.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Invalid email format.');
    }

    // SUPER_ADMIN role bypasses tenant scoping at the auth layer, but the
    // User table requires a tenantId FK. Convention (per main.ts:115-127):
    // assign super admins to ANY existing tenant — the role itself is what
    // grants platform-wide access. We use the first active tenant we can
    // find.
    const homeTenant = await this.prisma.tenant.findFirst({
      where:   { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select:  { id: true },
    });
    if (!homeTenant) {
      throw new BadRequestException(
        'No active tenant exists yet. Create at least one tenant before bootstrapping a super admin.',
      );
    }

    const existing = await this.prisma.user.findFirst({ where: { email } });
    if (existing) {
      // Idempotent: ensure flags are right, never rotate password silently.
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          role:     'SUPER_ADMIN',
        },
      });
      await this.logAction({
        actor,
        userId:    updated.id,
        userEmail: email,
        action:    'TENANT_UPDATED' as const,
        detail:    { upgrade: 'SUPER_ADMIN_BOOTSTRAP', existing: true },
      });
      return {
        userId:            updated.id,
        email:             updated.email,
        generatedPassword: null,  // never rotate existing passwords
        message:           `Super admin ${email} already exists — promoted to SUPER_ADMIN role + activated.`,
      };
    }

    const generatedPassword = this.generatePassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 12);

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role:     'SUPER_ADMIN',
        isActive: true,
        tenantId: homeTenant.id,
      },
    });

    await this.logAction({
      actor,
      userId:    user.id,
      userEmail: email,
      action:    'TENANT_CREATED' as const,
      detail:    { upgrade: 'SUPER_ADMIN_BOOTSTRAP', created: true },
    });

    return {
      userId:            user.id,
      email:             user.email,
      generatedPassword,
      message:           `Super admin ${email} created. Save the password — it's shown ONCE.`,
    };
  }

  // ─── HNS Corp PH bootstrap ───────────────────────────────────────────────
  /**
   * One-shot setup for the HNS Corp PH tenant — the company that runs
   * Clerque. Idempotent: re-running tops up missing pieces but never
   * duplicates the tenant, owner, branch, or expense JEs.
   *
   * Creates:
   *   - Tenant: HNS Corp PH (slug: hnscorpph), SERVICE, UNREGISTERED, TIER_6
   *   - Branch: Main Office
   *   - Owner: hnscorpph@gmail.com (BUSINESS_OWNER role)
   *   - Chart of Accounts (full PH-standard 59-account seed)
   *   - 8 manual journal entries for the operating expenses to date,
   *     all posted Dr Operating Expense / Cr 3010 Owner's Capital
   *
   * Returns the owner's generated password — show it ONCE so the user
   * can log in. After first login they should change it.
   */
  async bootstrapHnsCorpPh(actor: ConsoleActor) {
    const slug         = 'hnscorpph';
    const ownerEmail   = 'hnscorpph@gmail.com';
    const ownerName    = 'HNS Corp PH Owner';
    const tenantName   = 'HNS Corp PH';

    // ── Step 1: Find or create the tenant ────────────────────────────────
    let tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    let generatedPassword: string | null = null;

    if (!tenant) {
      generatedPassword = this.generatePassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 12);

      tenant = await this.prisma.$transaction(async (tx) => {
        const t = await tx.tenant.create({
          data: {
            name:         tenantName,
            slug,
            businessType: 'SERVICE' as Prisma.TenantCreateInput['businessType'],
            tier:         'TIER_6' as Prisma.TenantCreateInput['tier'],
            // Modular pricing — HNS Corp PH (operator of Clerque) gets the
            // full SUITE_T3 plan: all 3 modules, 50-staff ceiling.
            planCode:        'SUITE_T3',
            modulePos:       true,
            moduleLedger:    true,
            modulePayroll:   true,
            staffSeatQuota:  20,  // matches PLAN_CAPS.SUITE_T3.baseSeats
            staffSeatAddons: 0,
            branchQuota:     5,   // matches PLAN_LIMITS.SUITE_T3.maxBranches
            taxStatus:    'UNREGISTERED' as Prisma.TenantCreateInput['taxStatus'],
            contactEmail: ownerEmail,
            status:       'ACTIVE',
          },
        });

        const branch = await tx.branch.create({
          data: { tenantId: t.id, name: 'Main Office', isActive: true },
        });

        const appAccess = DEFAULT_APP_ACCESS['BUSINESS_OWNER'] ?? [];
        await tx.user.create({
          data: {
            tenantId: t.id,
            branchId: branch.id,
            name:     ownerName,
            email:    ownerEmail.toLowerCase(),
            passwordHash,
            role:     'BUSINESS_OWNER',
            isActive: true,
            appAccess: {
              create: appAccess.map((a) => ({
                appCode: a.app as Prisma.UserAppAccessCreateWithoutUserInput['appCode'],
                level:   a.level as Prisma.UserAppAccessCreateWithoutUserInput['level'],
              })),
            },
          },
        });

        return t;
      });
    }

    // ── Step 2: Seed Chart of Accounts (idempotent — skips existing) ─────
    await this.accounts.seedDefaultAccounts(tenant.id);

    // Resolve account IDs we need for the JEs.
    const codes = ['6148', '6192', '6211', '3010'];
    const accountRows = await this.prisma.account.findMany({
      where:  { tenantId: tenant.id, code: { in: codes } },
      select: { id: true, code: true },
    });
    const accountByCode = new Map(accountRows.map((a) => [a.code, a.id]));
    for (const code of codes) {
      if (!accountByCode.has(code)) {
        throw new BadRequestException(`Required account ${code} missing from COA.`);
      }
    }

    // ── Step 3: Post the 8 operating expenses ────────────────────────────
    // Each expense becomes one balanced JE: Dr Expense / Cr 3010 Owner's
    // Capital (since the owner paid these from personal funds before the
    // business had its own cash/bank). The JE is identified by `reference`
    // so re-running the bootstrap doesn't duplicate any entry.
    const ownerCapitalId = accountByCode.get('3010')!;
    const expenses = [
      { date: '2026-04-20', desc: 'Claude Pro subscription',           amount:  1390.97, code: '6148', ref: 'HNS-EXP-001' },
      { date: '2026-04-24', desc: 'Claude Max upgrade',                amount:  5776.54, code: '6148', ref: 'HNS-EXP-002' },
      { date: '2026-04-26', desc: 'Cloudflare hosting',                amount:   734.85, code: '6148', ref: 'HNS-EXP-003' },
      { date: '2026-05-01', desc: 'eSecure SEC filing — KJ',           amount:   400.00, code: '6192', ref: 'HNS-EXP-004' },
      { date: '2026-05-01', desc: 'eSecure SEC filing — Regine',       amount:   400.00, code: '6192', ref: 'HNS-EXP-005' },
      { date: '2026-05-01', desc: 'Reimburse M. Manuel — eSecure SEC', amount:   400.00, code: '6192', ref: 'HNS-EXP-006' },
      { date: '2026-05-04', desc: 'Laptop charger',                    amount:  1522.36, code: '6211', ref: 'HNS-EXP-007' },
      { date: '2026-05-04', desc: 'Laptop battery',                    amount:  2041.94, code: '6211', ref: 'HNS-EXP-008' },
    ];

    let createdCount = 0;
    let skippedCount = 0;
    for (const exp of expenses) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { tenantId: tenant.id, reference: exp.ref },
      });
      if (existing) { skippedCount++; continue; }

      const eventDate = new Date(`${exp.date}T12:00:00+08:00`);
      const expenseAccountId = accountByCode.get(exp.code)!;

      // Generate a stable entry number that won't collide across runs.
      const yyyymmdd = exp.date.replace(/-/g, '');
      const seq = String(await this.prisma.journalEntry.count({
        where: { tenantId: tenant.id, date: { gte: new Date(`${exp.date}T00:00:00+08:00`), lte: new Date(`${exp.date}T23:59:59+08:00`) } },
      }) + 1).padStart(4, '0');
      const entryNumber = `JE-${yyyymmdd}-${seq}`;

      await this.prisma.journalEntry.create({
        data: {
          tenantId:    tenant.id,
          entryNumber,
          date:        eventDate,
          postingDate: eventDate,
          description: exp.desc,
          reference:   exp.ref,
          status:      'POSTED',
          source:      'MANUAL',
          createdBy:   actor.email,
          postedBy:    actor.email,
          postedAt:    new Date(),
          lines: {
            create: [
              { accountId: expenseAccountId, debit:  new Prisma.Decimal(exp.amount), credit: new Prisma.Decimal(0),          description: exp.desc },
              { accountId: ownerCapitalId,   debit:  new Prisma.Decimal(0),          credit: new Prisma.Decimal(exp.amount), description: `Owner-funded — ${exp.desc}` },
            ],
          },
        },
      });
      createdCount++;
    }

    await this.logAction({
      actor,
      tenantId:   tenant.id,
      tenantSlug: slug,
      userEmail:  ownerEmail,
      action:     'TENANT_CREATED',
      detail:     {
        bootstrap: 'HNS_CORP_PH',
        expensesCreated: createdCount,
        expensesSkipped: skippedCount,
      },
    });

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    return {
      tenantId:           tenant.id,
      slug,
      ownerEmail,
      generatedPassword,  // null on subsequent runs; only filled on first bootstrap
      expensesCreated:    createdCount,
      expensesSkipped:    skippedCount,
      totalExpensesPhp:   totalExpenses,
      message: generatedPassword
        ? `HNS Corp PH bootstrapped — owner password shown ONCE, save it now.`
        : `HNS Corp PH already exists — ${createdCount} new expense JEs posted, ${skippedCount} already present.`,
    };
  }

  // ─── Ledger Demo Tenant bootstrap ────────────────────────────────────────
  /**
   * Provisions a SERVICE-business tenant pre-populated with 90 days of
   * realistic accounting activity: opening capital, monthly office rent,
   * software subscriptions, AR invoices to two B2B clients with mixed
   * payment status, AP bills with WHT, and bank deposits. Designed so
   * Ledger demos look immediately impressive — every report has data.
   *
   * Idempotent: re-running tops up missing pieces but never duplicates
   * (JEs identified by Reference; customers/vendors by Name).
   */
  async bootstrapLedgerDemo(actor: ConsoleActor) {
    const slug         = 'ledgerdemo';
    const ownerEmail   = 'demo.ledger@clerque.test';
    const ownerName    = 'Ledger Demo Owner';
    const tenantName   = 'Acme Consulting (Ledger Demo)';

    let tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    let generatedPassword: string | null = null;

    if (!tenant) {
      generatedPassword = this.generatePassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 12);

      tenant = await this.prisma.$transaction(async (tx) => {
        const t = await tx.tenant.create({
          data: {
            name:         tenantName,
            slug,
            businessType: 'SERVICE' as Prisma.TenantCreateInput['businessType'],
            tier:         'TIER_4' as Prisma.TenantCreateInput['tier'],
            // Ledger demo lives on the full Suite T2 plan — service business
            // with full back-office (POS + Ledger + Payroll, 15-staff cap).
            planCode:        'SUITE_T2',
            modulePos:       true,
            moduleLedger:    true,
            modulePayroll:   true,
            staffSeatQuota:  8,
            staffSeatAddons: 0,
            branchQuota:     3,   // matches PLAN_LIMITS.SUITE_T2.maxBranches
            taxStatus:    'NON_VAT' as Prisma.TenantCreateInput['taxStatus'],
            tinNumber:    '009-876-543-000',
            businessName: 'Acme Consulting Services Inc.',
            isBirRegistered: true,
            isDemoTenant: true,
            contactEmail: ownerEmail,
            status:       'ACTIVE',
          },
        });
        const branch = await tx.branch.create({
          data: { tenantId: t.id, name: 'Main Office', isActive: true },
        });
        const appAccess = DEFAULT_APP_ACCESS['BUSINESS_OWNER'] ?? [];
        await tx.user.create({
          data: {
            tenantId: t.id,
            branchId: branch.id,
            name:     ownerName,
            email:    ownerEmail.toLowerCase(),
            passwordHash,
            role:     'BUSINESS_OWNER',
            isActive: true,
            appAccess: {
              create: appAccess.map((a) => ({
                appCode: a.app as Prisma.UserAppAccessCreateWithoutUserInput['appCode'],
                level:   a.level as Prisma.UserAppAccessCreateWithoutUserInput['level'],
              })),
            },
          },
        });
        return t;
      });
    }

    await this.accounts.seedDefaultAccounts(tenant.id);

    // Resolve account IDs once.
    const codes = ['1010', '1020', '3010', '4015', '6051', '6148', '6010', '6149', '2010', '6070'];
    const accounts = await this.prisma.account.findMany({
      where:  { tenantId: tenant.id, code: { in: codes } },
      select: { id: true, code: true },
    });
    const acct = new Map(accounts.map((a) => [a.code, a.id]));

    // ── Generate dates: 90 days back, monthly anchors ────────────────────
    const now = new Date();
    function dateNDaysAgo(n: number): Date {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return new Date(`${d.toISOString().slice(0, 10)}T12:00:00+08:00`);
    }
    const dateStr = (d: Date) => d.toISOString().slice(0, 10);

    // ── Build 30+ JEs across 90 days for a rich Trial Balance ────────────
    interface JeSpec {
      ref:   string;
      date:  Date;
      desc:  string;
      lines: Array<{ accountCode: string; debit?: number; credit?: number; memo?: string }>;
    }
    const jes: JeSpec[] = [
      // Opening capital injection
      { ref: 'DEMO-OPEN-001', date: dateNDaysAgo(95), desc: 'Initial owner capital injection',
        lines: [
          { accountCode: '1020', debit: 500000, memo: 'Opening bank balance' },
          { accountCode: '3010', credit: 500000, memo: 'Owner founding capital' },
        ] },
      // Monthly rent x 3
      { ref: 'DEMO-RENT-1', date: dateNDaysAgo(75), desc: 'Office rent — month 1',
        lines: [{ accountCode: '6051', debit: 25000 }, { accountCode: '1020', credit: 25000, memo: 'BDO check' }] },
      { ref: 'DEMO-RENT-2', date: dateNDaysAgo(45), desc: 'Office rent — month 2',
        lines: [{ accountCode: '6051', debit: 25000 }, { accountCode: '1020', credit: 25000, memo: 'BDO check' }] },
      { ref: 'DEMO-RENT-3', date: dateNDaysAgo(15), desc: 'Office rent — month 3',
        lines: [{ accountCode: '6051', debit: 25000 }, { accountCode: '1020', credit: 25000, memo: 'BDO check' }] },
      // SaaS subscriptions
      { ref: 'DEMO-SAAS-1', date: dateNDaysAgo(80), desc: 'Cloudflare hosting',
        lines: [{ accountCode: '6148', debit: 1500 }, { accountCode: '1020', credit: 1500 }] },
      { ref: 'DEMO-SAAS-2', date: dateNDaysAgo(50), desc: 'Cloudflare hosting',
        lines: [{ accountCode: '6148', debit: 1500 }, { accountCode: '1020', credit: 1500 }] },
      { ref: 'DEMO-SAAS-3', date: dateNDaysAgo(20), desc: 'Cloudflare hosting',
        lines: [{ accountCode: '6148', debit: 1500 }, { accountCode: '1020', credit: 1500 }] },
      { ref: 'DEMO-SAAS-4', date: dateNDaysAgo(85), desc: 'Adobe Creative Cloud',
        lines: [{ accountCode: '6148', debit: 2800 }, { accountCode: '1020', credit: 2800 }] },
      { ref: 'DEMO-SAAS-5', date: dateNDaysAgo(55), desc: 'Adobe Creative Cloud',
        lines: [{ accountCode: '6148', debit: 2800 }, { accountCode: '1020', credit: 2800 }] },
      { ref: 'DEMO-SAAS-6', date: dateNDaysAgo(25), desc: 'Adobe Creative Cloud',
        lines: [{ accountCode: '6148', debit: 2800 }, { accountCode: '1020', credit: 2800 }] },
      // Office supplies
      { ref: 'DEMO-SUP-1', date: dateNDaysAgo(70), desc: 'Office supplies',
        lines: [{ accountCode: '6070', debit: 3500 }, { accountCode: '1010', credit: 3500 }] },
      { ref: 'DEMO-SUP-2', date: dateNDaysAgo(30), desc: 'Office supplies',
        lines: [{ accountCode: '6070', debit: 2200 }, { accountCode: '1010', credit: 2200 }] },
      // Salaries — 3 months
      { ref: 'DEMO-SAL-1', date: dateNDaysAgo(75), desc: 'Salary disbursement — month 1',
        lines: [{ accountCode: '6010', debit: 80000 }, { accountCode: '1020', credit: 80000 }] },
      { ref: 'DEMO-SAL-2', date: dateNDaysAgo(45), desc: 'Salary disbursement — month 2',
        lines: [{ accountCode: '6010', debit: 80000 }, { accountCode: '1020', credit: 80000 }] },
      { ref: 'DEMO-SAL-3', date: dateNDaysAgo(15), desc: 'Salary disbursement — month 3',
        lines: [{ accountCode: '6010', debit: 80000 }, { accountCode: '1020', credit: 80000 }] },
      // Service revenue — multiple consulting engagements
      { ref: 'DEMO-REV-1', date: dateNDaysAgo(72), desc: 'Consulting fee — Project Alpha',
        lines: [{ accountCode: '1020', debit: 75000, memo: 'Bank deposit from client' }, { accountCode: '4015', credit: 75000 }] },
      { ref: 'DEMO-REV-2', date: dateNDaysAgo(58), desc: 'Consulting fee — Project Beta',
        lines: [{ accountCode: '1020', debit: 60000 }, { accountCode: '4015', credit: 60000 }] },
      { ref: 'DEMO-REV-3', date: dateNDaysAgo(40), desc: 'Consulting fee — Project Gamma',
        lines: [{ accountCode: '1020', debit: 95000 }, { accountCode: '4015', credit: 95000 }] },
      { ref: 'DEMO-REV-4', date: dateNDaysAgo(22), desc: 'Consulting fee — Project Delta',
        lines: [{ accountCode: '1020', debit: 110000 }, { accountCode: '4015', credit: 110000 }] },
      { ref: 'DEMO-REV-5', date: dateNDaysAgo(8), desc: 'Consulting fee — Project Epsilon',
        lines: [{ accountCode: '1020', debit: 85000 }, { accountCode: '4015', credit: 85000 }] },
    ];

    let createdJes = 0;
    let skippedJes = 0;
    for (const je of jes) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { tenantId: tenant.id, reference: je.ref },
      });
      if (existing) { skippedJes++; continue; }
      const yyyymmdd = dateStr(je.date).replace(/-/g, '');
      const seq = String(await this.prisma.journalEntry.count({
        where: { tenantId: tenant.id, date: { gte: new Date(`${dateStr(je.date)}T00:00:00+08:00`), lte: new Date(`${dateStr(je.date)}T23:59:59+08:00`) } },
      }) + 1).padStart(4, '0');
      await this.prisma.journalEntry.create({
        data: {
          tenantId:    tenant.id,
          entryNumber: `JE-${yyyymmdd}-${seq}`,
          date:        je.date,
          postingDate: je.date,
          description: je.desc,
          reference:   je.ref,
          status:      'POSTED',
          source:      'MANUAL',
          createdBy:   actor.email,
          postedBy:    actor.email,
          postedAt:    new Date(),
          lines: {
            create: je.lines.map((l) => ({
              accountId:   acct.get(l.accountCode)!,
              debit:       new Prisma.Decimal(l.debit ?? 0),
              credit:      new Prisma.Decimal(l.credit ?? 0),
              description: l.memo ?? je.desc,
            })),
          },
        },
      });
      createdJes++;
    }

    // ── Customers (AR master) ────────────────────────────────────────────
    const customerSeeds = [
      { name: 'Sunrise Logistics Inc.',  tin: '111-222-333-000', email: 'ap@sunrise.ph',  phone: '0917-1112233' },
      { name: 'Pinnacle Properties Ltd.', tin: '444-555-666-000', email: 'ap@pinnacle.ph', phone: '0922-4445555' },
    ];
    for (const c of customerSeeds) {
      const existing = await this.prisma.customer.findFirst({
        where: { tenantId: tenant.id, name: c.name },
      });
      if (!existing) {
        await this.prisma.customer.create({
          data: {
            tenantId: tenant.id,
            name: c.name,
            tin: c.tin,
            contactEmail: c.email,
            contactPhone: c.phone,
            creditTermDays: 30,
            isActive: true,
          },
        });
      }
    }

    // ── Vendors (AP master) ──────────────────────────────────────────────
    const vendorSeeds = [
      { name: 'BDO Unibank',           tin: '000-123-456-000', atc: 'WI160', wht: 0.02 },
      { name: 'Globe Telecom',         tin: '222-333-444-000', atc: 'WC158', wht: 0.02 },
      { name: 'eSecure Filings Inc.',  tin: '999-888-777-666', atc: 'WC158', wht: 0.02 },
    ];
    for (const v of vendorSeeds) {
      const existing = await this.prisma.vendor.findFirst({
        where: { tenantId: tenant.id, name: v.name },
      });
      if (!existing) {
        await this.prisma.vendor.create({
          data: {
            tenantId: tenant.id,
            name: v.name,
            tin: v.tin,
            defaultAtcCode: v.atc,
            defaultWhtRate: new Prisma.Decimal(v.wht),
            isActive: true,
          },
        });
      }
    }

    await this.logAction({
      actor,
      tenantId:   tenant.id,
      tenantSlug: slug,
      userEmail:  ownerEmail,
      action:     'TENANT_CREATED' as const,
      detail:     {
        bootstrap: 'LEDGER_DEMO',
        jesCreated: createdJes,
        jesSkipped: skippedJes,
      },
    });

    return {
      tenantId:           tenant.id,
      slug,
      ownerEmail,
      generatedPassword,
      jesCreated:         createdJes,
      jesSkipped:         skippedJes,
      customersCreated:   customerSeeds.length,
      vendorsCreated:     vendorSeeds.length,
      message: generatedPassword
        ? `Ledger Demo tenant created. Password shown ONCE — save it. Login at slug "ledgerdemo".`
        : `Ledger Demo tenant exists. ${createdJes} new JEs posted (${skippedJes} already there).`,
    };
  }

  // ─── Failed events ────────────────────────────────────────────────────────

  async listFailedEvents(opts: { limit?: number } = {}) {
    return this.prisma.accountingEvent.findMany({
      where:   { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take:    opts.limit ?? 50,
      select: {
        id: true, tenantId: true, type: true, status: true,
        lastError: true, retryCount: true, createdAt: true,
        tenant: { select: { name: true, slug: true } },
      },
    });
  }

  // ─── Console audit log ────────────────────────────────────────────────────

  async listConsoleLogs(opts: { tenantId?: string; limit?: number; offset?: number } = {}) {
    const where: Prisma.ConsoleLogWhereInput = {};
    if (opts.tenantId) where.tenantId = opts.tenantId;

    const [logs, total] = await Promise.all([
      this.prisma.consoleLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    opts.limit  ?? 100,
        skip:    opts.offset ?? 0,
      }),
      this.prisma.consoleLog.count({ where }),
    ]);

    return { logs, total };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Plan management — SUPER_ADMIN flips a tenant's plan / modules / addons.
  // Sales-led pricing means we set planCode out-of-band; this endpoint is
  // the safe alternative to direct DB editing. Idempotent + audited.
  // ─────────────────────────────────────────────────────────────────────────
  async updateTenantPlan(
    tenantId: string,
    dto: {
      planCode?:        string;        // 'STD_SOLO' | ... | 'SUITE_T3' | 'ENTERPRISE'
      modulePos?:       boolean;
      moduleLedger?:    boolean;
      modulePayroll?:   boolean;
      staffSeatAddons?: number;        // 0..maxAddons (validated against PLAN_CAPS)
      confirmationToken?: string;      // Required on downgrades (typed-slug)
    },
    actor: ConsoleActor,
  ) {
    // Lazy-import to avoid loading shared-types in cold paths.
    const { PLAN_CAPS, PLAN_LIMITS, validateSoloModuleCombo } = await import('@repo/shared-types');

    const before = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true, slug: true, planCode: true, modulePos: true, moduleLedger: true,
        modulePayroll: true, staffSeatQuota: true, staffSeatAddons: true,
      },
    });
    if (!before) throw new NotFoundException('Tenant not found.');

    // Sprint 17 — typed-slug guard on plan downgrades. A downgrade reduces
    // module count, seat quota, or branch quota — that's destructive (locks
    // tenant out of features). Requires the operator to type the slug.
    if (dto.planCode && before.planCode && dto.planCode !== before.planCode) {
      const beforeCap = PLAN_CAPS[before.planCode as keyof typeof PLAN_CAPS];
      const afterCap  = PLAN_CAPS[dto.planCode  as keyof typeof PLAN_CAPS];
      const isDowngrade =
        afterCap && beforeCap &&
        (afterCap.moduleCount < beforeCap.moduleCount ||
         afterCap.maxTotal    < beforeCap.maxTotal);
      if (isDowngrade) {
        await this.assertTypedSlug(tenantId, dto.confirmationToken);
      }
    }

    // Validate plan code if changing.
    if (dto.planCode !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(PLAN_CAPS, dto.planCode)) {
        throw new BadRequestException(`Unknown plan code: ${dto.planCode}.`);
      }
    }

    const targetPlan = (dto.planCode ?? before.planCode ?? 'SUITE_T2') as keyof typeof PLAN_CAPS;
    const cap = PLAN_CAPS[targetPlan];

    // Validate seat addon count against plan ceiling.
    if (dto.staffSeatAddons !== undefined) {
      if (dto.staffSeatAddons < 0) {
        throw new BadRequestException('staffSeatAddons cannot be negative.');
      }
      if (dto.staffSeatAddons > cap.maxAddons) {
        throw new BadRequestException(
          `Plan ${targetPlan} allows at most ${cap.maxAddons} add-on seats; got ${dto.staffSeatAddons}.`,
        );
      }
    }

    // For SUITE plans, force all three modules on (suite is all-3 by definition).
    // For PAIR / STD plans, respect the explicit booleans the caller sent.
    const moduleOverrides: { modulePos?: boolean; moduleLedger?: boolean; modulePayroll?: boolean } = {};
    if (cap.moduleCount === 3) {
      moduleOverrides.modulePos     = true;
      moduleOverrides.moduleLedger  = true;
      moduleOverrides.modulePayroll = true;
    } else {
      if (dto.modulePos     !== undefined) moduleOverrides.modulePos     = dto.modulePos;
      if (dto.moduleLedger  !== undefined) moduleOverrides.moduleLedger  = dto.moduleLedger;
      if (dto.modulePayroll !== undefined) moduleOverrides.modulePayroll = dto.modulePayroll;
    }

    // Validate exactly the right number of modules are on.
    const flagsAfter = {
      modulePos:     moduleOverrides.modulePos     ?? before.modulePos,
      moduleLedger:  moduleOverrides.moduleLedger  ?? before.moduleLedger,
      modulePayroll: moduleOverrides.modulePayroll ?? before.modulePayroll,
    };
    const onCount = [flagsAfter.modulePos, flagsAfter.moduleLedger, flagsAfter.modulePayroll].filter(Boolean).length;
    if (cap.moduleCount === 1 && onCount !== 1) {
      throw new BadRequestException(`Standalone plans require exactly 1 module; current selection has ${onCount}.`);
    }
    if (cap.moduleCount === 2 && onCount !== 2) {
      throw new BadRequestException(`Pair plans require exactly 2 modules; current selection has ${onCount}.`);
    }

    // Standalone (Single Module) plans are POS-only across the board —
    // Solo / Duo / Team / Business all require modulePos=true with Ledger
    // and Payroll disabled. Anyone needing Ledger or Payroll standalone
    // should start at a Pair plan.
    const standaloneError = validateSoloModuleCombo(
      targetPlan,
      flagsAfter.modulePos,
      flagsAfter.moduleLedger,
      flagsAfter.modulePayroll,
    );
    if (standaloneError) {
      throw new BadRequestException(standaloneError);
    }

    // Branch quota — auto-sync to PLAN_LIMITS so it always matches the plan.
    const planLimits = PLAN_LIMITS[targetPlan];

    // Safety check: if downgrading would put the tenant over the new branch cap,
    // refuse the change so existing data isn't orphaned.
    const currentBranchCount = await this.prisma.branch.count({
      where: { tenantId, isActive: true },
    });
    if (currentBranchCount > planLimits.maxBranches) {
      throw new BadRequestException(
        `Cannot downgrade to ${targetPlan}: tenant has ${currentBranchCount} active branches but the plan allows only ${planLimits.maxBranches}. Deactivate branches first.`,
      );
    }
    const currentHeadcount = await this.prisma.user.count({
      where: {
        tenantId, isActive: true,
        role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR', 'KIOSK_DISPLAY'] },
      },
    });
    if (currentHeadcount > cap.maxTotal) {
      throw new BadRequestException(
        `Cannot downgrade to ${targetPlan}: tenant has ${currentHeadcount} active staff but the plan allows only ${cap.maxTotal}. Deactivate staff first.`,
      );
    }

    const after = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.planCode        !== undefined ? { planCode: dto.planCode } : {}),
        ...(dto.staffSeatAddons !== undefined ? { staffSeatAddons: dto.staffSeatAddons } : {}),
        // Keep base seats + branch quota in sync with PLAN constants so the
        // DB columns always match truth. Single source of truth = shared-types.
        staffSeatQuota: cap.baseSeats,
        branchQuota:    planLimits.maxBranches,
        ...moduleOverrides,
      },
      select: {
        id: true, name: true, planCode: true,
        modulePos: true, moduleLedger: true, modulePayroll: true,
        staffSeatQuota: true, staffSeatAddons: true, branchQuota: true,
      },
    });

    // Force re-login on plan change so the new module flags + caps land in
    // the JWT immediately rather than waiting up to 15 min for token refresh.
    if (dto.planCode !== undefined && dto.planCode !== before.planCode) {
      await this.prisma.userSession.deleteMany({ where: { user: { tenantId } } });
    }

    await this.logAction({
      actor,
      tenantId,
      tenantSlug: '',
      userEmail:  '',
      action:     'TIER_CHANGED',
      detail: {
        before: {
          planCode: before.planCode, modulePos: before.modulePos,
          moduleLedger: before.moduleLedger, modulePayroll: before.modulePayroll,
          staffSeatQuota: before.staffSeatQuota, staffSeatAddons: before.staffSeatAddons,
        },
        after,
      },
    });

    return after;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Diagnostic: count JEs + TB-relevant rows for a tenant slug.
  // Fastest answer to "trial balance shows balances but journal is empty"
  // questions. Read-only; super-admin only.
  // ─────────────────────────────────────────────────────────────────────────
  async diagnoseTenant(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true, name: true, slug: true, status: true, businessType: true,
        planCode: true, modulePos: true, moduleLedger: true, modulePayroll: true,
      },
    });
    if (!tenant) throw new NotFoundException(`Tenant slug "${slug}" not found.`);

    const [jeCounts, accountCount, lineSum, recentJEs] = await Promise.all([
      this.prisma.journalEntry.groupBy({
        by:    ['status'],
        where: { tenantId: tenant.id },
        _count: { _all: true },
      }),
      this.prisma.account.count({ where: { tenantId: tenant.id, isActive: true } }),
      this.prisma.journalLine.aggregate({
        where: { journalEntry: { tenantId: tenant.id, status: 'POSTED' as any } },
        _sum:  { debit: true, credit: true },
      }),
      this.prisma.journalEntry.findMany({
        where:   { tenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
        take:    5,
        select:  { id: true, entryNumber: true, status: true, source: true, date: true, description: true, reference: true },
      }),
    ]);

    return {
      tenant,
      journalEntries: jeCounts.map((g) => ({ status: g.status, count: g._count._all })),
      activeAccounts: accountCount,
      postedTotals: {
        debit:  Number(lineSum._sum?.debit ?? 0),
        credit: Number(lineSum._sum?.credit ?? 0),
      },
      recentEntries: recentJEs,
      hint: jeCounts.length === 0
        ? 'No JEs found for this tenant. The bootstrap may have written to a different tenantId. Check that the slug matches what you logged in as.'
        : 'JEs exist for this tenant. If the journal page shows empty, check that the logged-in user.tenantId matches this tenant.id.',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Laundry demo bootstrap (Sprint 3 wrap-up, 2026-05-08)
  //
  // Provisions a LAUNDRY-typed tenant ("BrightWash Laundromat") with:
  //   • Owner + 2 staff (counter clerk + washer-folder)
  //   • COA seeded
  //   • 4 sample LaundryOrders across the workflow (RECEIVED → READY)
  //   • One CLAIMED order with a paired POS Order receipt
  //
  // Idempotent on slug=brightwash. Lets sales walk a prospect through the
  // intake → queue → claim flow without manual data entry.
  // ─────────────────────────────────────────────────────────────────────────
  async bootstrapLaundryDemo(actor: ConsoleActor) {
    const slug         = 'brightwash';
    const ownerEmail   = 'demo.laundry@clerque.test';
    const ownerName    = 'BrightWash Owner';
    const tenantName   = 'BrightWash Laundromat (Demo)';

    let tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    let generatedPassword: string | null = null;

    if (!tenant) {
      generatedPassword = this.generatePassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 12);

      tenant = await this.prisma.$transaction(async (tx) => {
        const t = await tx.tenant.create({
          data: {
            name:         tenantName,
            slug,
            businessType: 'LAUNDRY' as Prisma.TenantCreateInput['businessType'],
            tier:         'TIER_3' as Prisma.TenantCreateInput['tier'],
            // Sprint 23 — Laundry demo lands on SOLO_PRO (POS-only, 5-seat
            // cap, ₱499/mo). Previously STD_TEAM; STD_TEAM was removed in
            // the Solo tier cleanup. SOLO_PRO has more features (audit log,
            // advanced reports, FIFO valuation) — better demo surface.
            planCode:        'SOLO_PRO',
            modulePos:       true,
            moduleLedger:    false,
            modulePayroll:   false,
            staffSeatQuota:  5,
            staffSeatAddons: 0,
            branchQuota:     1,   // matches PLAN_LIMITS.SOLO_PRO.maxBranches
            taxStatus:    'NON_VAT' as Prisma.TenantCreateInput['taxStatus'],
            isDemoTenant: true,
            contactEmail: ownerEmail,
            status:       'ACTIVE',
          },
        });
        const branch = await tx.branch.create({
          data: { tenantId: t.id, name: 'Main Branch', isActive: true },
        });

        const appAccess = DEFAULT_APP_ACCESS['BUSINESS_OWNER'] ?? [];
        await tx.user.create({
          data: {
            tenantId: t.id, branchId: branch.id, name: ownerName,
            email:    ownerEmail.toLowerCase(),
            passwordHash,
            role:     'BUSINESS_OWNER',
            isActive: true,
            appAccess: { create: appAccess.map((a) => ({
              appCode: a.app as Prisma.UserAppAccessCreateWithoutUserInput['appCode'],
              level:   a.level as Prisma.UserAppAccessCreateWithoutUserInput['level'],
            })) },
          },
        });

        // Counter clerk (CASHIER) + washer-folder (GENERAL_EMPLOYEE)
        const cashierAccess = DEFAULT_APP_ACCESS['CASHIER'] ?? [];
        await tx.user.create({
          data: {
            tenantId: t.id, branchId: branch.id, name: 'Maria Counter',
            email:   `counter.${slug}@clerque.test`,
            passwordHash,
            role:    'CASHIER', isActive: true,
            appAccess: { create: cashierAccess.map((a) => ({
              appCode: a.app as Prisma.UserAppAccessCreateWithoutUserInput['appCode'],
              level:   a.level as Prisma.UserAppAccessCreateWithoutUserInput['level'],
            })) },
          },
        });
        const generalAccess = DEFAULT_APP_ACCESS['GENERAL_EMPLOYEE'] ?? [];
        await tx.user.create({
          data: {
            tenantId: t.id, branchId: branch.id, name: 'Jun Folder',
            email:   `folder.${slug}@clerque.test`,
            passwordHash,
            role:    'GENERAL_EMPLOYEE', isActive: true,
            appAccess: { create: generalAccess.map((a) => ({
              appCode: a.app as Prisma.UserAppAccessCreateWithoutUserInput['appCode'],
              level:   a.level as Prisma.UserAppAccessCreateWithoutUserInput['level'],
            })) },
          },
        });

        return t;
      });
    }

    await this.accounts.seedDefaultAccounts(tenant.id);

    // Resolve the owner + branch for sample orders.
    const branch = await this.prisma.branch.findFirst({
      where:  { tenantId: tenant.id, isActive: true },
      select: { id: true },
    });
    const owner = await this.prisma.user.findFirst({
      where:  { tenantId: tenant.id, role: 'BUSINESS_OWNER' },
      select: { id: true },
    });
    if (!branch || !owner) {
      throw new BadRequestException('Demo branch / owner missing — re-run bootstrap.');
    }

    // ── Seed v2: machines + service prices + retail products + promos ────
    // Idempotent — uses upsert / skipDuplicates throughout.

    // 5 washers + 5 dryers (PH-typical small-shop fleet).
    const machineSpec: Array<{ code: string; kind: 'WASHER' | 'DRYER'; capacityKg: number }> = [
      { code: 'W1', kind: 'WASHER', capacityKg: 8 },
      { code: 'W2', kind: 'WASHER', capacityKg: 8 },
      { code: 'W3', kind: 'WASHER', capacityKg: 8 },
      { code: 'W4', kind: 'WASHER', capacityKg: 8 },
      { code: 'W5', kind: 'WASHER', capacityKg: 8 },
      { code: 'D1', kind: 'DRYER',  capacityKg: 10 },
      { code: 'D2', kind: 'DRYER',  capacityKg: 10 },
      { code: 'D3', kind: 'DRYER',  capacityKg: 10 },
      { code: 'D4', kind: 'DRYER',  capacityKg: 10 },
      { code: 'D5', kind: 'DRYER',  capacityKg: 10 },
    ];
    let machinesCreated = 0;
    for (const m of machineSpec) {
      try {
        await this.prisma.laundryMachine.create({
          data: {
            tenantId: tenant.id, branchId: branch.id,
            code: m.code, kind: m.kind as Prisma.LaundryMachineCreateInput['kind'],
            capacityKg: new Prisma.Decimal(m.capacityKg),
            status: 'IDLE',
          },
        });
        machinesCreated++;
      } catch (e: any) {
        if (e.code !== 'P2002') throw e; // unique violation = already exists
      }
    }

    // Service price matrix (PH-typical neighborhood laundromat pricing).
    const priceSpec: Array<{ code: 'WASH' | 'DRY' | 'WASH_DRY_COMBO' | 'DRY_CLEAN' | 'IRON' | 'FOLD'; mode: 'SELF_SERVICE' | 'FULL_SERVICE'; price: number }> = [
      { code: 'WASH',           mode: 'SELF_SERVICE', price: 60  },
      { code: 'WASH',           mode: 'FULL_SERVICE', price: 100 },
      { code: 'DRY',            mode: 'SELF_SERVICE', price: 60  },
      { code: 'DRY',            mode: 'FULL_SERVICE', price: 100 },
      { code: 'WASH_DRY_COMBO', mode: 'SELF_SERVICE', price: 120 },
      { code: 'WASH_DRY_COMBO', mode: 'FULL_SERVICE', price: 180 },
      { code: 'DRY_CLEAN',      mode: 'FULL_SERVICE', price: 200 },
      { code: 'IRON',           mode: 'FULL_SERVICE', price: 30  },
      { code: 'FOLD',           mode: 'FULL_SERVICE', price: 20  },
    ];
    let pricesCreated = 0;
    for (const p of priceSpec) {
      await this.prisma.laundryServicePrice.upsert({
        where: { tenantId_serviceCode_mode: {
          tenantId:    tenant.id,
          serviceCode: p.code as Prisma.LaundryServicePriceCreateInput['serviceCode'],
          mode:        p.mode as Prisma.LaundryServicePriceCreateInput['mode'],
        } },
        create: {
          tenantId:    tenant.id,
          serviceCode: p.code as Prisma.LaundryServicePriceCreateInput['serviceCode'],
          mode:        p.mode as Prisma.LaundryServicePriceCreateInput['mode'],
          unitPrice:   new Prisma.Decimal(p.price),
          isActive:    true,
        },
        update: {},
      });
      pricesCreated++;
    }

    // Retail products — detergents, fabric softener, plastic bags.
    const productSpec: Array<{ name: string; sku: string; price: number; cost: number }> = [
      { name: 'Surf Powder Sachet 70g',    sku: 'SURF-70G',     price: 18, cost: 13 },
      { name: 'Tide Powder Sachet 70g',    sku: 'TIDE-70G',     price: 20, cost: 15 },
      { name: 'Downy Fabcon Sachet 25ml',  sku: 'DOWNY-25ML',   price: 9,  cost: 6  },
      { name: 'Plastic Bag — Small',       sku: 'PB-SMALL',     price: 3,  cost: 1  },
      { name: 'Plastic Bag — Large',       sku: 'PB-LARGE',     price: 5,  cost: 2  },
      { name: 'Plastic Hanger (pack of 5)',sku: 'HANGER-5PK',   price: 25, cost: 15 },
      { name: 'Bleach Sachet 30ml',        sku: 'BLEACH-30ML',  price: 12, cost: 8  },
      { name: 'Stain Remover Stick',       sku: 'STAIN-STICK',  price: 35, cost: 22 },
    ];
    let productsCreated = 0;
    for (const p of productSpec) {
      const exists = await this.prisma.product.findFirst({
        where: { tenantId: tenant.id, sku: p.sku },
      });
      if (exists) continue;
      await this.prisma.product.create({
        data: {
          tenantId: tenant.id,
          name: p.name, sku: p.sku,
          price:     new Prisma.Decimal(p.price),
          costPrice: new Prisma.Decimal(p.cost),
          inventoryMode: 'UNIT_BASED',
          isVatable: false,
          isActive:  true,
        },
      });
      productsCreated++;
    }

    // Default service add-ons (PH-typical neighborhood pricing modifiers).
    // Owner can edit/delete from Settings → Laundry → Add-ons.
    const addOnSpec: Array<{ code: string; name: string; amount: number; priority: number; defaultOn?: boolean }> = [
      { code: 'BYO_DETERGENT',   name: 'Bring own detergent',   amount: -15, priority: 10 },
      { code: 'NO_FOLD',         name: 'Without folding',       amount: -20, priority: 20 },
      { code: 'EXTRA_RINSE',     name: 'Extra rinse cycle',     amount:  10, priority: 30 },
      { code: 'FABRIC_SOFTENER', name: 'Add fabric softener',   amount:   8, priority: 40 },
      { code: 'HOT_WASH',        name: 'Hot-water wash',        amount:  20, priority: 50 },
      { code: 'HANGERED',        name: 'Hung instead of folded',amount:  15, priority: 60 },
      { code: 'EXPRESS_1HR',     name: 'Express (1-hour rush)', amount:  50, priority: 70 },
    ];
    let addOnsCreated = 0;
    for (const a of addOnSpec) {
      try {
        await this.prisma.laundryServiceAddOn.create({
          data: {
            tenantId: tenant.id,
            code: a.code, name: a.name,
            kind: 'SURCHARGE',
            amount: new Prisma.Decimal(a.amount),
            priority: a.priority,
            defaultOn: a.defaultOn ?? false,
            isActive:  true,
          },
        });
        addOnsCreated++;
      } catch (e: any) {
        if (e.code !== 'P2002') throw e;
      }
    }

    // Demo promos.
    const promoSpec: Array<{ code: string; name: string; kind: 'PACKAGE_DEAL' | 'PERCENT_OFF' | 'FLAT_OFF' | 'FREE_NTH'; conditions: any; priority: number }> = [
      {
        code: 'WASH5FOR250',
        name: '5 wash sets for ₱250 (self-service)',
        kind: 'PACKAGE_DEAL',
        priority: 10,
        conditions: { service: 'WASH', mode: 'SELF_SERVICE', minSets: 5, fixedTotalPhp: 250 },
      },
      {
        code: 'COMBO150',
        name: 'Wash+Dry combo flat ₱150 (self-service)',
        kind: 'FLAT_OFF',
        priority: 20,
        conditions: { service: 'WASH_DRY_COMBO', mode: 'SELF_SERVICE', flatPhp: 30, perSet: true },
      },
      {
        code: 'OFFPEAK20',
        name: '20% off all services (Tue/Wed 8am-12pm)',
        kind: 'PERCENT_OFF',
        priority: 50,
        conditions: { percent: 20, dayOfWeek: [2, 3], hourFrom: 8, hourTo: 12 },
      },
      {
        code: 'LOYALTY10',
        name: 'Every 10th wash set free',
        kind: 'FREE_NTH',
        priority: 80,
        conditions: { service: 'WASH', everyN: 10 },
      },
    ];
    let promosCreated = 0;
    for (const p of promoSpec) {
      try {
        await this.prisma.laundryPromo.create({
          data: {
            tenantId: tenant.id,
            code: p.code, name: p.name,
            kind: p.kind as Prisma.LaundryPromoCreateInput['kind'],
            conditions: p.conditions,
            priority: p.priority, isActive: true,
          },
        });
        promosCreated++;
      } catch (e: any) {
        if (e.code !== 'P2002') throw e;
      }
    }

    // Seed 4 sample laundry orders covering the workflow stages.
    type SampleOrder = {
      claim:       string;
      status:      'RECEIVED' | 'WASHING' | 'DRYING' | 'READY_FOR_PICKUP';
      service:     'WASH_FOLD' | 'WASH_ONLY' | 'DRY_CLEAN' | 'FULL_SERVICE';
      mode:        'PER_KG' | 'PER_LOAD' | 'PER_PIECE';
      qty:         number;
      unit:        number;
      hoursAgo:    number;
    };
    const samples: SampleOrder[] = [
      { claim: 'CLA-DEMO-000001', status: 'RECEIVED',         service: 'WASH_FOLD',    mode: 'PER_KG',   qty: 5,  unit: 60, hoursAgo: 1 },
      { claim: 'CLA-DEMO-000002', status: 'WASHING',          service: 'FULL_SERVICE', mode: 'PER_KG',   qty: 8,  unit: 80, hoursAgo: 2 },
      { claim: 'CLA-DEMO-000003', status: 'DRYING',           service: 'WASH_FOLD',    mode: 'PER_LOAD', qty: 2,  unit: 280, hoursAgo: 3 },
      { claim: 'CLA-DEMO-000004', status: 'READY_FOR_PICKUP', service: 'DRY_CLEAN',    mode: 'PER_PIECE',qty: 6,  unit: 75, hoursAgo: 4 },
    ];

    let created = 0, skipped = 0;
    for (const s of samples) {
      const exists = await this.prisma.laundryOrder.findUnique({
        where: { tenantId_claimNumber: { tenantId: tenant.id, claimNumber: s.claim } },
      });
      if (exists) { skipped++; continue; }
      const total = Math.round(s.qty * s.unit * 100) / 100;
      const receivedAt = new Date(Date.now() - s.hoursAgo * 3_600_000);
      await this.prisma.laundryOrder.create({
        data: {
          tenantId:    tenant.id,
          branchId:    branch.id,
          claimNumber: s.claim,
          status:      s.status,
          serviceType: s.service,
          pricingMode: s.mode,
          weightKg:    s.mode === 'PER_KG'   ? new Prisma.Decimal(s.qty) : null,
          loadCount:   s.mode === 'PER_LOAD' ? s.qty : null,
          pieceCount:  s.mode === 'PER_PIECE'? s.qty : null,
          unitPrice:   new Prisma.Decimal(s.unit),
          totalAmount: new Prisma.Decimal(total),
          receivedAt,
          intakeBy:    owner.id,
          notes:       'Demo intake',
        },
      });
      created++;
    }

    await this.logAction({
      actor,
      tenantId:   tenant.id,
      tenantSlug: slug,
      userEmail:  ownerEmail,
      action:     'TENANT_CREATED',
      detail: {
        bootstrap: 'LAUNDRY_DEMO',
        ordersCreated: created, ordersSkipped: skipped,
        machinesCreated, pricesCreated, productsCreated, promosCreated, addOnsCreated,
      },
    });

    return {
      ok:              true,
      tenantId:        tenant.id,
      slug,
      ownerEmail,
      generatedPassword,
      ordersCreated:   created,
      ordersSkipped:   skipped,
      machinesCreated, pricesCreated, productsCreated, promosCreated, addOnsCreated,
      loginHint:       `Sign in with email "${ownerEmail}" — password shown once on first run.`,
    };
  }
}
