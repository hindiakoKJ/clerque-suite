/**
 * AdminService — cross-tenant operations for the Clerque Console.
 *
 * Every method here runs WITHOUT tenant scoping. Only callable behind
 * SuperAdminGuard. All mutating actions are automatically logged to the
 * ConsoleLog table for audit-readiness.
 */

import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_APP_ACCESS } from '@repo/shared-types';
import { DEMO_SCENARIOS, ScenarioKey, allProducts } from './demo-scenarios';

// ─── Types ────────────────────────────────────────────────────────────────────

type ConsoleActor = { email: string };

export interface CreateTenantDto {
  name:          string;
  slug:          string;
  businessType:  'FNB' | 'RETAIL' | 'SERVICE' | 'MFG';
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
  businessType?:   'FNB' | 'RETAIL' | 'SERVICE' | 'MFG';
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
  constructor(private prisma: PrismaService) {}

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

  async getPlatformMetrics() {
    const now = new Date();
    const day7  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      tenantsByStatus, tenantsByTier,
      activeLast7d, activeLast30d,
      totalUsers, totalOrders30d, totalRevenue30d,
      totalArInvoices, totalApBills,
      failedEvents, totalAiSpend30d,
    ] = await Promise.all([
      this.prisma.tenant.groupBy({ by: ['status'], _count: true }),
      this.prisma.tenant.groupBy({ by: ['tier'],   _count: true }),
      this.prisma.tenant.count({ where: { users: { some: { sessions: { some: { lastUsedAt: { gte: day7  } } } } } } }).catch(() => 0),
      this.prisma.tenant.count({ where: { users: { some: { sessions: { some: { lastUsedAt: { gte: day30 } } } } } } }).catch(() => 0),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.order.count({ where: { status: 'COMPLETED', completedAt: { gte: day30 } } }),
      this.prisma.order.aggregate({ where: { status: 'COMPLETED', completedAt: { gte: day30 } }, _sum: { totalAmount: true } }),
      this.prisma.aRInvoice.count({ where: { status: { in: ['OPEN', 'PARTIALLY_PAID'] } } }).catch(() => 0),
      this.prisma.aPBill.count({ where: { status: { in: ['OPEN', 'PARTIALLY_PAID'] } } }).catch(() => 0),
      this.prisma.accountingEvent.count({ where: { status: 'FAILED' } }).catch(() => 0),
      this.prisma.aiUsage.aggregate({ where: { createdAt: { gte: day30 } }, _sum: { costUsd: true } }).catch(() => ({ _sum: { costUsd: null } })),
    ]);

    return {
      generatedAt: now.toISOString(),
      tenants: {
        total:        tenantsByStatus.reduce((s, r) => s + r._count, 0),
        byStatus:     tenantsByStatus.map((r) => ({ status: r.status, count: r._count })),
        byTier:       tenantsByTier.map((r) => ({ tier: r.tier, count: r._count })),
        activeLast7d, activeLast30d,
      },
      users:    { totalActive: totalUsers },
      activity: {
        ordersLast30d:  totalOrders30d,
        revenueLast30d: Number(totalRevenue30d._sum.totalAmount ?? 0),
        openArInvoices: totalArInvoices,
        openApBills:    totalApBills,
        failedEvents,
        aiSpendUsd30d:  Number(totalAiSpend30d._sum.costUsd ?? 0),
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

    return {
      scenario:        scenario.label,
      businessType:    scenario.businessType,
      taxStatus:       scenario.taxStatus,
      productsSeeded:  catalog.length,
      ordersGenerated: orderCount,
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
