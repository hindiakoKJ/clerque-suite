/**
 * AdminService — cross-tenant operations for the Clerque Console.
 *
 * Every method here runs WITHOUT tenant scoping. Only callable behind
 * SuperAdminGuard. Reads are aggressive (joins, aggregates) since the
 * audience is the platform team, not customer-facing.
 */

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // ─── Platform metrics ────────────────────────────────────────────────────
  /** Top-of-funnel KPIs for the Console dashboard. */
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
      // Active = at least one user has used a session recently (lastUsedAt on UserSession)
      this.prisma.tenant.count({ where: { users: { some: { sessions: { some: { lastUsedAt: { gte: day7  } } } } } } }).catch(() => 0),
      this.prisma.tenant.count({ where: { users: { some: { sessions: { some: { lastUsedAt: { gte: day30 } } } } } } }).catch(() => 0),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.order.count({ where: { status: 'COMPLETED', completedAt: { gte: day30 } } }),
      this.prisma.order.aggregate({
        where: { status: 'COMPLETED', completedAt: { gte: day30 } },
        _sum:  { totalAmount: true },
      }),
      this.prisma.aRInvoice.count({ where: { status: { in: ['OPEN', 'PARTIALLY_PAID'] } } }).catch(() => 0),
      this.prisma.aPBill.count({ where: { status: { in: ['OPEN', 'PARTIALLY_PAID'] } } }).catch(() => 0),
      this.prisma.accountingEvent.count({ where: { status: 'FAILED' } }).catch(() => 0),
      this.prisma.aiUsage.aggregate({
        where: { createdAt: { gte: day30 } },
        _sum:  { costUsd: true },
      }).catch(() => ({ _sum: { costUsd: null } })),
    ]);

    return {
      generatedAt: now.toISOString(),
      tenants: {
        total:        tenantsByStatus.reduce((s, r) => s + r._count, 0),
        byStatus:     tenantsByStatus.map((r) => ({ status: r.status, count: r._count })),
        byTier:       tenantsByTier.map((r) => ({ tier: r.tier, count: r._count })),
        activeLast7d, activeLast30d,
      },
      users: { totalActive: totalUsers },
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
      ];
    }
    if (opts.status) where.status = opts.status as Prisma.TenantWhereInput['status'];
    if (opts.tier)   where.tier   = opts.tier   as Prisma.TenantWhereInput['tier'];

    const tenants = await this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, slug: true, name: true, status: true, tier: true,
        businessType: true, taxStatus: true, isBirRegistered: true,
        aiAddonType: true, aiQuotaOverride: true,
        createdAt: true,
        _count: { select: { users: true, branches: true } },
      },
    });

    // For each, fetch last activity + 30d revenue (cheap aggregate)
    const day30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const enriched = await Promise.all(tenants.map(async (t) => {
      const [lastSession, rev30d] = await Promise.all([
        this.prisma.userSession.findFirst({
          where: { user: { tenantId: t.id } },
          orderBy: { lastUsedAt: 'desc' },
          select: { lastUsedAt: true },
        }).catch(() => null),
        this.prisma.order.aggregate({
          where: { tenantId: t.id, status: 'COMPLETED', completedAt: { gte: day30 } },
          _sum:  { totalAmount: true },
          _count: true,
        }),
      ]);
      return {
        ...t,
        lastLoginAt: lastSession?.lastUsedAt ?? null,
        revenue30d:  Number(rev30d._sum.totalAmount ?? 0),
        orders30d:   rev30d._count,
      };
    }));
    return enriched;
  }

  async getTenantDetail(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: {
            users: true, branches: true, products: true,
          },
        },
      },
    });
    if (!t) throw new NotFoundException('Tenant not found.');

    const day30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [orders30d, jeCount, openAr, openAp, failedEvents, aiUsage30d] = await Promise.all([
      this.prisma.order.aggregate({
        where: { tenantId, status: 'COMPLETED', completedAt: { gte: day30 } },
        _sum:  { totalAmount: true },
        _count: true,
      }),
      this.prisma.journalEntry.count({ where: { tenantId, status: 'POSTED' } }),
      this.prisma.aRInvoice.count({ where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } } }).catch(() => 0),
      this.prisma.aPBill.count({ where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } } }).catch(() => 0),
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'FAILED' } }).catch(() => 0),
      this.prisma.aiUsage.aggregate({
        where: { tenantId, createdAt: { gte: day30 } },
        _sum:  { costUsd: true },
        _count: true,
      }).catch(() => ({ _sum: { costUsd: null }, _count: 0 })),
    ]);

    return {
      tenant: t,
      stats: {
        orders30d:        orders30d._count,
        revenue30d:       Number(orders30d._sum.totalAmount ?? 0),
        postedJEs:        jeCount,
        openArInvoices:   openAr,
        openApBills:      openAp,
        failedEvents,
        aiPrompts30d:     aiUsage30d._count,
        aiSpendUsd30d:    Number(aiUsage30d._sum.costUsd ?? 0),
      },
    };
  }

  // ─── Tenant actions ──────────────────────────────────────────────────────
  async setTenantStatus(tenantId: string, status: 'ACTIVE' | 'GRACE' | 'SUSPENDED') {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data:  { status },
      select: { id: true, status: true },
    });
  }

  async setTenantTier(tenantId: string, tier: 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6') {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data:  { tier },
      select: { id: true, tier: true },
    });
  }

  async setAiOverride(tenantId: string, quotaOverride: number | null, addonType: string | null) {
    if (quotaOverride != null && (quotaOverride < 0 || quotaOverride > 100000)) {
      throw new BadRequestException('Quota override must be between 0 and 100,000.');
    }
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data:  {
        aiQuotaOverride: quotaOverride,
        aiAddonType:     addonType as Prisma.TenantUpdateInput['aiAddonType'],
      },
      select: { id: true, aiQuotaOverride: true, aiAddonType: true },
    });
  }

  /** Failed events across all tenants — for triage. */
  async listFailedEvents(opts: { limit?: number } = {}) {
    return this.prisma.accountingEvent.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
      select: {
        id: true, tenantId: true, type: true, status: true,
        lastError: true, retryCount: true, createdAt: true,
        tenant: { select: { name: true, slug: true } },
      },
    });
  }
}
