import {
  Injectable, BadRequestException, NotFoundException, ConflictException, Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PLAN_MONTHLY_PRICE_PHP_CENTS, type PlanCode } from '@repo/shared-types';
import type { Prisma, SubscriptionInvoiceStatus } from '@prisma/client';

/**
 * Sprint 14 — Subscription Billing.
 *
 * HNS Corp PH's relationship with each Clerque tenant is tracked here:
 * monthly invoices for plan + add-ons, payment status, dunning timeline,
 * Acknowledgement Receipt PDFs.
 *
 * **Privacy invariant:** this service NEVER touches `Order`, `Payslip`,
 * `JournalEntry`, or any tenant business data. Only the platform-layer
 * `SubscriptionInvoice` table + the `Tenant` row's plan metadata. The
 * console may freely surface this data.
 *
 * GL accounting for HNS's revenue happens in HNS Corp PH's OWN Clerque
 * tenant — see hnsOrderId field for the cross-link. This service only
 * tracks the AR-equivalent on the platform layer.
 */
@Injectable()
export class SubscriptionBillingService {
  private readonly logger = new Logger(SubscriptionBillingService.name);
  /** HNS Corp PH's VAT status — controls whether to add 12% to invoices.
   *  When VAT-registered, set HNS_VAT_REGISTERED=true in env. Default false. */
  private readonly isVatRegistered = process.env.HNS_VAT_REGISTERED === 'true';
  /** Days from issuance until an ISSUED invoice flips to PAST_DUE. */
  private readonly dueDays = Number(process.env.SUBSCRIPTION_DUE_DAYS ?? 7);

  constructor(private readonly prisma: PrismaService) {}

  // ─── List + filter ────────────────────────────────────────────────────────

  listInvoices(q: ListInvoicesQuery = {}) {
    const where: Prisma.SubscriptionInvoiceWhereInput = {};
    if (q.tenantId) where.tenantId = q.tenantId;
    if (q.status)   where.status   = q.status;
    if (q.from || q.to) {
      where.periodStart = {};
      if (q.from) (where.periodStart as any).gte = new Date(q.from);
      if (q.to)   (where.periodStart as any).lte = new Date(q.to);
    }
    return this.prisma.subscriptionInvoice.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { invoiceNumber: 'desc' }],
      take:    q.take ? Math.min(q.take, 200) : 100,
      skip:    q.skip ?? 0,
      include: {
        tenant: { select: { id: true, name: true, slug: true, planCode: true, status: true } },
      },
    });
  }

  async getInvoice(id: string) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true, slug: true, contactEmail: true, planCode: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  // ─── Issue an invoice (manual or via cron) ────────────────────────────────

  async issueInvoice(dto: IssueInvoiceDto) {
    if (!dto.tenantId) throw new BadRequestException('tenantId is required.');
    if (!dto.periodStart || !dto.periodEnd) {
      throw new BadRequestException('periodStart and periodEnd are required.');
    }
    const periodStart = new Date(dto.periodStart);
    const periodEnd   = new Date(dto.periodEnd);
    if (Number.isNaN(periodStart.valueOf()) || Number.isNaN(periodEnd.valueOf())) {
      throw new BadRequestException('Invalid date format.');
    }
    if (periodEnd <= periodStart) {
      throw new BadRequestException('periodEnd must be after periodStart.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: dto.tenantId },
      select: { id: true, name: true, planCode: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    if (tenant.status === 'SUSPENDED') {
      throw new BadRequestException('Cannot issue an invoice to a suspended tenant.');
    }

    const planCode = (dto.planCode ?? tenant.planCode ?? 'STD_SOLO') as PlanCode;

    // Reject duplicate billing for the same period.
    const existing = await this.prisma.subscriptionInvoice.findFirst({
      where: {
        tenantId:    dto.tenantId,
        periodStart,
        status:      { notIn: ['WRITTEN_OFF', 'REFUNDED'] },
      },
      select: { id: true, invoiceNumber: true },
    });
    if (existing) {
      throw new ConflictException(
        `An invoice for this period already exists: ${existing.invoiceNumber}`,
      );
    }

    const baseAmount  = (dto.baseAmount  ?? PLAN_MONTHLY_PRICE_PHP_CENTS[planCode] ?? 0) / 100;
    const addonAmount = dto.addonAmount  ?? 0;
    const subtotal    = +(baseAmount + addonAmount).toFixed(2);
    const vatAmount   = this.isVatRegistered ? +(subtotal * 0.12).toFixed(2) : 0;
    const totalAmount = +(subtotal + vatAmount).toFixed(2);

    if (subtotal <= 0) {
      throw new BadRequestException('Total amount must be > 0 (ENTERPRISE plan? bill manually).');
    }

    // Sequence: SUB-{YYYY}-{6-digit-seq} platform-wide per year.
    const year   = new Date().getFullYear();
    const prefix = `SUB-${year}-`;
    const last   = await this.prisma.subscriptionInvoice.findFirst({
      where:   { invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: 'desc' },
      select:  { invoiceNumber: true },
    });
    const lastSeq = last ? Number(last.invoiceNumber.slice(prefix.length)) || 0 : 0;
    const invoiceNumber = `${prefix}${String(lastSeq + 1).padStart(6, '0')}`;

    const dueDate = new Date(Date.now() + this.dueDays * 86_400_000);

    return this.prisma.subscriptionInvoice.create({
      data: {
        tenantId:      dto.tenantId,
        invoiceNumber,
        periodStart,
        periodEnd,
        planCode,
        baseAmount:    baseAmount as any,
        addonAmount:   addonAmount as any,
        vatAmount:     vatAmount as any,
        totalAmount:   totalAmount as any,
        status:        dto.issueImmediately === false ? 'DRAFT' : 'ISSUED',
        issuedAt:      dto.issueImmediately === false ? null : new Date(),
        dueDate,
        notes:         dto.notes ?? null,
      },
    });
  }

  // ─── Payment recording ────────────────────────────────────────────────────

  async markPaid(invoiceId: string, dto: MarkPaidDto) {
    if (!dto.paidVia?.trim()) {
      throw new BadRequestException('paidVia is required (e.g. "Bank Transfer", "PayMongo", "GCash").');
    }

    const result = await this.prisma.subscriptionInvoice.updateMany({
      where: { id: invoiceId, status: { in: ['ISSUED', 'PAST_DUE'] } },
      data: {
        status:      'PAID',
        paidAt:      dto.paidAt ? new Date(dto.paidAt) : new Date(),
        paidVia:     dto.paidVia.trim(),
        externalRef: dto.externalRef ?? null,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('Invoice not in ISSUED/PAST_DUE state, or already paid.');
    }
    return this.getInvoice(invoiceId);
  }

  async writeOff(invoiceId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Write-off reason is required (≥ 5 chars).');
    }
    const result = await this.prisma.subscriptionInvoice.updateMany({
      where: { id: invoiceId, status: { in: ['ISSUED', 'PAST_DUE'] } },
      data: {
        status: 'WRITTEN_OFF',
        notes:  `Written off: ${reason.trim()}`,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('Invoice not in a write-offable state.');
    }
    return this.getInvoice(invoiceId);
  }

  // ─── Operational metrics for the Console dashboard ────────────────────────

  /**
   * Returns aggregate platform-wide subscription metrics. NO tenant-financial
   * data — only HNS Corp's billing data with each tenant.
   */
  async metrics() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [active, issuedThisMonth, paidThisMonth, pastDue, mrrAgg] = await Promise.all([
      // Tenant-level counts (operational, not financial)
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.subscriptionInvoice.count({
        where: { status: { in: ['ISSUED', 'PAST_DUE', 'PAID'] }, periodStart: { gte: monthStart, lt: monthEnd } },
      }),
      this.prisma.subscriptionInvoice.aggregate({
        where:  { status: 'PAID', paidAt: { gte: monthStart, lt: monthEnd } },
        _sum:   { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.subscriptionInvoice.count({ where: { status: 'PAST_DUE' } }),
      // MRR = sum of baseAmount + addonAmount across ACTIVE tenants' latest invoices.
      // Approximation: sum of last issued invoices in the current month.
      this.prisma.subscriptionInvoice.aggregate({
        where:  {
          status: { in: ['ISSUED', 'PAST_DUE', 'PAID'] },
          periodStart: { gte: monthStart, lt: monthEnd },
        },
        _sum: { baseAmount: true, addonAmount: true },
      }),
    ]);

    return {
      activeTenants:    active,
      issuedThisMonth,
      paidThisMonth: {
        count:  paidThisMonth._count._all,
        amount: Number(paidThisMonth._sum.totalAmount ?? 0),
      },
      pastDueCount:     pastDue,
      mrr:              Number(mrrAgg._sum.baseAmount ?? 0) + Number(mrrAgg._sum.addonAmount ?? 0),
      vatRegistered:    this.isVatRegistered,
      dueDaysWindow:    this.dueDays,
    };
  }

  // ─── Cron jobs ────────────────────────────────────────────────────────────

  /**
   * Runs daily at 02:00 server-local. Two responsibilities:
   *   1. Auto-issue the current-month invoice for every ACTIVE tenant that
   *      doesn't already have one for the period (skips ENTERPRISE — billed
   *      manually).
   *   2. Flip ISSUED invoices to PAST_DUE when dueDate is in the past.
   *
   * Idempotent: re-running on the same day is safe (issueInvoice's duplicate
   * check + updateMany status guard).
   */
  @Cron('0 0 2 * * *')
  async dailySweep() {
    if (process.env.SUBSCRIPTION_BILLING_DISABLED === 'true') {
      this.logger.warn('Subscription billing cron disabled via env.');
      return;
    }
    this.logger.log('[subscription-billing] daily sweep starting…');

    // 1) Past-due flip.
    const pastDueResult = await this.prisma.subscriptionInvoice.updateMany({
      where: { status: 'ISSUED', dueDate: { lt: new Date() } },
      data:  { status: 'PAST_DUE' },
    });
    if (pastDueResult.count > 0) {
      this.logger.log(`[subscription-billing] ${pastDueResult.count} invoices flipped to PAST_DUE.`);
    }

    // 2) Auto-issue current-month invoices for ACTIVE tenants without one.
    const now          = new Date();
    const periodStart  = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd    = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Only ACTIVE tenants with a non-ENTERPRISE plan get auto-issued.
    // ENTERPRISE is "contact sales" — billed manually outside this loop.
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', planCode: { notIn: ['ENTERPRISE'] } },
      select: { id: true, planCode: true, name: true },
    });

    let issued = 0;
    for (const t of tenants) {
      try {
        await this.issueInvoice({
          tenantId:         t.id,
          periodStart:      periodStart.toISOString(),
          periodEnd:        periodEnd.toISOString(),
          planCode:         t.planCode as PlanCode,
          issueImmediately: true,
        });
        issued++;
      } catch (err: any) {
        // ConflictException = already issued for this period (good, expected).
        if (err?.name === 'ConflictException') continue;
        this.logger.warn(`[subscription-billing] tenant ${t.name} (${t.id}) issuance failed: ${err?.message ?? err}`);
      }
    }
    this.logger.log(`[subscription-billing] auto-issued ${issued} invoices for ${tenants.length} ACTIVE tenants.`);
  }
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface ListInvoicesQuery {
  tenantId?: string;
  status?:   SubscriptionInvoiceStatus;
  from?:     string;
  to?:       string;
  take?:     number;
  skip?:     number;
}

export interface IssueInvoiceDto {
  tenantId:          string;
  periodStart:       string; // ISO
  periodEnd:         string;
  planCode?:         PlanCode;       // defaults to tenant.planCode
  /** Override the plan's monthly price (e.g. promo pricing). PHP, not centavos. */
  baseAmount?:       number;
  addonAmount?:      number;
  /** False to create as DRAFT (manual issue later). Default true. */
  issueImmediately?: boolean;
  notes?:            string;
}

export interface MarkPaidDto {
  paidVia:      string;
  paidAt?:      string;
  externalRef?: string;
}
