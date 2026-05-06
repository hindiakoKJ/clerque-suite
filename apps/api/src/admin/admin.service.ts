/**
 * AdminService — cross-tenant operations for the Clerque Console.
 *
 * Every method here runs WITHOUT tenant scoping. Only callable behind
 * SuperAdminGuard. All mutating actions are automatically logged to the
 * ConsoleLog table for audit-readiness.
 */

import {
  Injectable, NotFoundException, BadRequestException, ConflictException, Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_APP_ACCESS } from '@repo/shared-types';
import { DEMO_SCENARIOS, ScenarioKey, allProducts } from './demo-scenarios';
import { COFFEE_SHOP_INGREDIENTS } from './coffee-shop-ingredients';
import { COFFEE_SHOP_CATEGORIES } from './coffee-shop-categories';
import { AccountsService } from '../accounting/accounts.service';

// ─── Types ────────────────────────────────────────────────────────────────────

type ConsoleActor = { email: string };

export interface CreateTenantDto {
  name:          string;
  slug:          string;
  businessType:  'COFFEE_SHOP' | 'RESTAURANT' | 'BAKERY' | 'FOOD_STALL' | 'BAR_LOUNGE' | 'CATERING' | 'RETAIL' | 'SERVICE' | 'MANUFACTURING';
  tier:          'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6';
  ownerName:     string;
  ownerEmail:    string;
  contactEmail?: string;
  contactPhone?: string;
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
  businessType?:   'COFFEE_SHOP' | 'RESTAURANT' | 'BAKERY' | 'FOOD_STALL' | 'BAR_LOUNGE' | 'CATERING' | 'RETAIL' | 'SERVICE' | 'MANUFACTURING';
  taxStatus?:      'VAT' | 'NON_VAT' | 'UNREGISTERED';
  tinNumber?:      string | null;
  isBirRegistered?: boolean;
  contactEmail?:   string | null;
  contactPhone?:   string | null;
  address?:        string | null;
  isDemoTenant?:   boolean;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(
    private prisma: PrismaService,
    private accounts: AccountsService,
  ) {}

  // ─── Internal helpers ────────────────────────────────────────────────────

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
        aiAddonType: true, aiQuotaOverride: true, aiAddonExpiresAt: true,
        // Sprint 3 — surface coffee-shop floor-layout tier in the Console
        coffeeShopTier: true,
        hasCustomerDisplay: true,
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

    const tenant = await this.prisma.$transaction(async (tx) => {
      // 1. Create tenant
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

    // Log to ConsoleLog
    await this.logAction({
      actor,
      tenantId:   tenant.tenant.id,
      tenantSlug: slug,
      userId:     tenant.user.id,
      userEmail:  dto.ownerEmail,
      action:     'TENANT_CREATED',
      detail:     { ownerName: dto.ownerName, tier: dto.tier, businessType: dto.businessType },
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

  async resetUserPassword(userId: string, actor: ConsoleActor) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, tenant: { select: { id: true, slug: true } } },
    });
    if (!user) throw new NotFoundException('User not found.');

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

  async setTenantStatus(tenantId: string, status: 'ACTIVE' | 'GRACE' | 'SUSPENDED', actor: ConsoleActor) {
    const t = await this.prisma.tenant.update({
      where:  { id: tenantId },
      data:   { status },
      select: { id: true, slug: true, status: true },
    });
    await this.logAction({ actor, tenantId, tenantSlug: t.slug, action: 'STATUS_CHANGED', detail: { status } });
    return t;
  }

  async setTenantTier(tenantId: string, tier: string, actor: ConsoleActor) {
    const t = await this.prisma.tenant.update({
      where:  { id: tenantId },
      data:   { tier: tier as Prisma.TenantUpdateInput['tier'] },
      select: { id: true, slug: true, tier: true },
    });
    await this.logAction({ actor, tenantId, tenantSlug: t.slug, action: 'TIER_CHANGED', detail: { tier } });
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
      select: { id: true, slug: true },
    });
    if (!t) throw new NotFoundException('Tenant not found.');

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

    const updated = await this.prisma.tenant.update({
      where:  { id: tenantId },
      data,
      select: { id: true, slug: true, name: true, businessType: true, taxStatus: true },
    });

    await this.logAction({
      actor,
      tenantId,
      tenantSlug: t.slug,
      action:  'PROFILE_UPDATED',
      detail:  { fields: Object.keys(dto) },
    });

    return updated;
  }

  // ─── Demo data reset ──────────────────────────────────────────────────────

  async resetDemoData(tenantId: string, scenarioKey: ScenarioKey, actor: ConsoleActor) {
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

    return {
      scenario:        scenario.label,
      businessType:    scenario.businessType,
      taxStatus:       scenario.taxStatus,
      productsSeeded:  catalog.length,
      ordersGenerated: orderCount,
      layoutTier,
    };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`resetDemoData failed for tenant ${tenantId} / scenario ${scenarioKey}: ${msg}`, err instanceof Error ? err.stack : undefined);
      throw new BadRequestException(`Demo reset failed: ${msg.slice(0, 300)}`);
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
  async clearAllTenantData(tenantId: string, actor: ConsoleActor) {
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

      this.logger.log(`Cleared all data for tenant ${tenant.slug} (${tenantId}) by ${actor.email}`);
      return {
        tenantSlug: tenant.slug,
        cleared: ['products', 'categories', 'rawMaterials', 'orders', 'inventoryLogs', 'accountingEvents', 'journalEntries'],
        preserved: ['tenant', 'users', 'branches', 'floorLayout'],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`clearAllTenantData failed for tenant ${tenantId}: ${msg}`, err instanceof Error ? err.stack : undefined);
      throw new BadRequestException(`Clear data failed: ${msg.slice(0, 300)}`);
    }
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
}
