/**
 * LedgerMetricsService — process-health metrics for the Ledger dashboard.
 *
 * These are NOT financial KPIs (revenue, profit, balances). Those live in
 * P&L and Balance Sheet pages. These are accounting-ops metrics: how
 * fast / accurate / under-control the books are.
 *
 * Grouped into four buckets:
 *   1. Timeliness — how fresh is the data? (event lag, DSO, DPO, close cycle)
 *   2. Accuracy   — is the data trustworthy? (TB variance, voids, reopens)
 *   3. Volume     — how busy is the team? (JE counts, event throughput)
 *   4. Control    — what needs attention? (pending claims, SOD overrides, missing cost)
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ProcessMetrics {
  generatedAt: string;
  timeliness: {
    /** Average ms between AccountingEvent.createdAt and JournalEntry.createdAt for last 24h. */
    avgEventLagMs:           number;
    /** Events still in PENDING status. */
    pendingEvents:           number;
    /** Events stuck in FAILED status — need manual triage. */
    failedEvents:            number;
    /** Days Sales Outstanding — weighted avg days from invoice to cash for paid invoices in last 90d. */
    daysSalesOutstanding:    number;
    /** Days Payable Outstanding — weighted avg days from bill to payment for paid bills in last 90d. */
    daysPayableOutstanding:  number;
    /** Days since the most recently closed period was closed. */
    daysSinceLastClose:      number | null;
  };
  accuracy: {
    /** Trial Balance: total debits − total credits as of now. Should be 0. */
    tbVariance:              number;
    /** Sum of debit lines (POSTED entries only). */
    tbTotalDebits:           number;
    /** Sum of credit lines. */
    tbTotalCredits:          number;
    isBalanced:              boolean;
    /** Voided POS orders in the last 30 days. */
    voidsLast30d:            number;
    /** % of total orders in the last 30 days that were voided. */
    voidRateLast30d:         number;
    /** Periods reopened in the last 90 days (audit risk indicator). */
    reopensLast90d:          number;
  };
  volume: {
    jesToday:                number;
    jesThisMonth:            number;
    eventsProcessedLast24h:  number;
    openArInvoices:          number;
    openArValue:             number;
    openApBills:             number;
    /** Net of WHT — the actual amount we still owe vendors. */
    openApValue:             number;
  };
  control: {
    pendingExpenseClaims:    number;
    sodOverridesLast30d:     number;
    productsMissingCost:     number;
    /** Audit log entries created in the last 24h (high count = unusual activity). */
    auditEntriesLast24h:     number;
    /** Orders synced from offline mode in last 24h (high count = network issues). */
    offlineSyncsLast24h:     number;
  };
}

@Injectable()
export class LedgerMetricsService {
  constructor(private prisma: PrismaService) {}

  async getProcessMetrics(tenantId: string): Promise<ProcessMetrics> {
    const now      = new Date();
    const dayAgo   = new Date(now.getTime() - 24  * 60 * 60 * 1000);
    const month30  = new Date(now.getTime() - 30  * 24 * 60 * 60 * 1000);
    const days90   = new Date(now.getTime() - 90  * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Run independent queries in parallel for speed.
    const [
      eventLag, pendingEvents, failedEvents, eventsLast24h,
      paidInvoices90d, paidBills90d, lastClose,
      tbLines, voidedOrders30d, totalOrders30d, reopens90d,
      jesToday, jesThisMonth,
      openAr, openAp,
      pendingClaims, sodOverrides, missingCost, auditCount, offlineSyncs,
    ] = await Promise.all([
      // ── Timeliness ──────────────────────────────────────────────────────
      this.prisma.accountingEvent.findMany({
        where:  { tenantId, status: 'SYNCED', syncedAt: { gte: dayAgo } },
        select: { createdAt: true, syncedAt: true },
        take:   500, // bound the query for very-busy tenants
      }),
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'FAILED'  } }),
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'SYNCED', syncedAt: { gte: dayAgo } } }),

      this.prisma.aRInvoice.findMany({
        where:  { tenantId, status: 'PAID', invoiceDate: { gte: days90 } },
        select: { invoiceDate: true, applications: { select: { appliedAt: true, appliedAmount: true } } },
      }),
      this.prisma.aPBill.findMany({
        where:  { tenantId, status: 'PAID', billDate: { gte: days90 } },
        select: { billDate: true, applications: { select: { appliedAt: true, appliedAmount: true } } },
      }),
      this.prisma.accountingPeriod.findFirst({
        where:   { tenantId, status: 'CLOSED' },
        orderBy: { closedAt: 'desc' },
        select:  { closedAt: true },
      }),

      // ── Accuracy ────────────────────────────────────────────────────────
      this.prisma.journalLine.findMany({
        where:  { journalEntry: { tenantId, status: 'POSTED' } },
        select: { debit: true, credit: true },
      }),
      this.prisma.order.count({ where: { tenantId, status: 'VOIDED', voidedAt: { gte: month30 } } }),
      this.prisma.order.count({ where: { tenantId, createdAt: { gte: month30 } } }),
      this.prisma.accountingPeriod.count({
        where: { tenantId, reopenedAt: { gte: days90, not: null } },
      }),

      // ── Volume ──────────────────────────────────────────────────────────
      this.prisma.journalEntry.count({ where: { tenantId, status: 'POSTED', createdAt: { gte: todayStart } } }),
      this.prisma.journalEntry.count({ where: { tenantId, status: 'POSTED', createdAt: { gte: monthStart } } }),
      this.prisma.aRInvoice.aggregate({
        where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
        _count: true,
        _sum:  { totalAmount: true, paidAmount: true },
      }),
      this.prisma.aPBill.aggregate({
        where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
        _count: true,
        _sum:  { totalAmount: true, paidAmount: true, whtAmount: true },
      }),

      // ── Control ─────────────────────────────────────────────────────────
      this.prisma.expenseClaim.count({ where: { tenantId, status: 'SUBMITTED' } }).catch(() => 0),
      this.prisma.auditLog.count({
        where: { tenantId, action: 'SOD_OVERRIDE_GRANTED' as any, createdAt: { gte: month30 } },
      }).catch(() => 0),
      this.prisma.product.count({ where: { tenantId, isActive: true, costPrice: null } }),
      this.prisma.auditLog.count({ where: { tenantId, createdAt: { gte: dayAgo } } }).catch(() => 0),
      // Offline-synced orders detected via clientUuid (set client-side
      // before sync; null on direct online orders).
      this.prisma.order.count({
        where: { tenantId, clientUuid: { not: null }, createdAt: { gte: dayAgo } },
      }).catch(() => 0),
    ]);

    // ── Compute event lag (avg ms PENDING → SYNCED) ───────────────────────
    let avgEventLagMs = 0;
    if (eventLag.length > 0) {
      const totalLag = eventLag.reduce(
        (sum, e) => sum + (e.syncedAt ? e.syncedAt.getTime() - e.createdAt.getTime() : 0),
        0,
      );
      avgEventLagMs = Math.round(totalLag / eventLag.length);
    }

    // ── DSO: weighted avg days from invoice to cash ───────────────────────
    let dsoNumerator = 0, dsoDenominator = 0;
    for (const inv of paidInvoices90d) {
      for (const app of inv.applications) {
        const days = Math.max(
          0,
          Math.floor((app.appliedAt.getTime() - inv.invoiceDate.getTime()) / 86_400_000),
        );
        const amt = Number(app.appliedAmount);
        dsoNumerator   += days * amt;
        dsoDenominator += amt;
      }
    }
    const daysSalesOutstanding = dsoDenominator > 0 ? dsoNumerator / dsoDenominator : 0;

    // ── DPO: weighted avg days from bill to payment ───────────────────────
    let dpoNumerator = 0, dpoDenominator = 0;
    for (const b of paidBills90d) {
      for (const app of b.applications) {
        const days = Math.max(
          0,
          Math.floor((app.appliedAt.getTime() - b.billDate.getTime()) / 86_400_000),
        );
        const amt = Number(app.appliedAmount);
        dpoNumerator   += days * amt;
        dpoDenominator += amt;
      }
    }
    const daysPayableOutstanding = dpoDenominator > 0 ? dpoNumerator / dpoDenominator : 0;

    // ── Days since last period close ───────────────────────────────────────
    const daysSinceLastClose = lastClose?.closedAt
      ? Math.floor((now.getTime() - lastClose.closedAt.getTime()) / 86_400_000)
      : null;

    // ── Trial Balance ─────────────────────────────────────────────────────
    const tbTotalDebits  = tbLines.reduce((s, l) => s + Number(l.debit),  0);
    const tbTotalCredits = tbLines.reduce((s, l) => s + Number(l.credit), 0);
    const tbVariance     = tbTotalDebits - tbTotalCredits;

    // ── Volume sums ───────────────────────────────────────────────────────
    const openArValue = (Number(openAr._sum.totalAmount ?? 0)) - (Number(openAr._sum.paidAmount ?? 0));
    const openApValue =
      (Number(openAp._sum.totalAmount ?? 0)) -
      (Number(openAp._sum.paidAmount  ?? 0)) -
      (Number(openAp._sum.whtAmount   ?? 0));

    return {
      generatedAt: now.toISOString(),
      timeliness: {
        avgEventLagMs,
        pendingEvents,
        failedEvents,
        daysSalesOutstanding:   Number(daysSalesOutstanding.toFixed(1)),
        daysPayableOutstanding: Number(daysPayableOutstanding.toFixed(1)),
        daysSinceLastClose,
      },
      accuracy: {
        tbVariance:      Number(tbVariance.toFixed(2)),
        tbTotalDebits:   Number(tbTotalDebits.toFixed(2)),
        tbTotalCredits:  Number(tbTotalCredits.toFixed(2)),
        isBalanced:      Math.abs(tbVariance) < 0.005,
        voidsLast30d:    voidedOrders30d,
        voidRateLast30d: totalOrders30d > 0 ? Number((voidedOrders30d / totalOrders30d).toFixed(4)) : 0,
        reopensLast90d:  reopens90d,
      },
      volume: {
        jesToday,
        jesThisMonth,
        eventsProcessedLast24h: eventsLast24h,
        openArInvoices:         openAr._count,
        openArValue:            Number(openArValue.toFixed(2)),
        openApBills:            openAp._count,
        openApValue:            Number(openApValue.toFixed(2)),
      },
      control: {
        pendingExpenseClaims: pendingClaims,
        sodOverridesLast30d:  sodOverrides,
        productsMissingCost:  missingCost,
        auditEntriesLast24h:  auditCount,
        offlineSyncsLast24h:  offlineSyncs,
      },
    };
  }
}
