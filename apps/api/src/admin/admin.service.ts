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
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_APP_ACCESS } from '@repo/shared-types';

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

  /** Appends an immutable entry to console_logs. Fire-and-forget safe. */
  private async logAction(params: {
    actor:       ConsoleActor;
    tenantId?:   string;
    tenantSlug?: string;
    userId?:     string;
    userEmail?:  string;
    action:      Prisma.ConsoleLogCreateInput['action'];
    detail?:     object;
  }) {
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
    }).catch(() => { /* never let audit failure break the main flow */ });
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
          businessType: dto.businessType,
          tier:         dto.tier,
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
              appCode: a.app,
              level:   a.level,
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
    const pinHash = dto.pinCode ? await bcrypt.hash(dto.pinCode, 10) : null;

    const appAccess = DEFAULT_APP_ACCESS[dto.role as keyof typeof DEFAULT_APP_ACCESS] ?? [];

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        branchId:    t.branches[0]?.id ?? null,
        name:        dto.name.trim(),
        email:       dto.email.toLowerCase().trim(),
        passwordHash,
        pinHash,
        role:        dto.role as Prisma.UserCreateInput['role'],
        isActive:    true,
        appAccess: {
          create: appAccess.map((a: { app: string; level: string }) => ({
            appCode: a.app,
            level:   a.level,
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
