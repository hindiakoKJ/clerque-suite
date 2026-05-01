import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePeriodDto } from './dto/create-period.dto';
export { CreatePeriodDto };

@Injectable()
export class AccountingPeriodsService {
  constructor(
    private prisma: PrismaService,
    private audit:  AuditService,
  ) {}

  async list(tenantId: string) {
    const periods = await this.prisma.accountingPeriod.findMany({
      where: { tenantId },
      orderBy: { startDate: 'desc' },
    });

    // Enrich closedById with the user's display name (no Prisma relation defined)
    const closerIds = [...new Set(periods.map((p) => p.closedById).filter(Boolean))] as string[];
    const closers = closerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: closerIds } },
          select: { id: true, name: true },
        })
      : [];
    const closerMap = Object.fromEntries(
      closers.map((u) => [u.id, u.name]),
    );

    return periods.map((p) => ({
      ...p,
      closedBy: p.closedById ? (closerMap[p.closedById] ?? 'Unknown') : null,
    }));
  }

  async create(tenantId: string, dto: CreatePeriodDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (end <= start) {
      throw new BadRequestException('End date must be after start date');
    }

    // Check for overlap with existing periods
    const overlap = await this.prisma.accountingPeriod.findFirst({
      where: {
        tenantId,
        OR: [
          { startDate: { lte: end }, endDate: { gte: start } },
        ],
      },
    });
    if (overlap) {
      throw new BadRequestException(
        `Period overlaps with existing period "${overlap.name}"`,
      );
    }

    return this.prisma.accountingPeriod.create({
      data: {
        tenantId,
        name: dto.name,
        startDate: start,
        endDate: end,
        notes: dto.notes,
        status: 'OPEN',
      },
    });
  }

  /** Close a period — prevents any new journal entries from being posted into it. */
  async closePeriod(tenantId: string, periodId: string, closedById: string, ipAddress?: string) {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, tenantId },
    });
    if (!period) throw new NotFoundException('Accounting period not found');
    if (period.status === 'CLOSED') {
      throw new BadRequestException('Period is already closed');
    }

    const updated = await this.prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'CLOSED', closedById, closedAt: new Date() },
    });

    // Immutable audit record — fire-and-forget
    void this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'AccountingPeriod',
      entityId:    periodId,
      before:      { status: 'OPEN' },
      after:       { status: 'CLOSED', closedById, closedAt: updated.closedAt },
      description: `Accounting period "${period.name}" closed`,
      performedBy: closedById,
      ipAddress,
    });

    return updated;
  }

  /**
   * Reopen a closed accounting period.
   *
   * Mirrors SAP OB52 behaviour:
   *   - A written reason is mandatory (regulatory requirement).
   *   - Close metadata (closedById, closedAt) is PRESERVED — it is a historical fact
   *     that the period was closed and must remain visible to auditors.
   *   - Reopen metadata (reopenedById, reopenedAt, reopenReason) is written alongside.
   *   - reopenCount is incremented so auditors can immediately see how many times
   *     this period has been opened and closed.
   *   - The action is recorded in the immutable AuditLog.
   */
  async reopenPeriod(
    tenantId:    string,
    periodId:    string,
    reopenedById: string,
    reason:      string,
    ipAddress?:  string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException(
        'A written reason is required to reopen an accounting period.',
      );
    }

    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, tenantId },
    });
    if (!period) throw new NotFoundException('Accounting period not found');
    if (period.status === 'OPEN') {
      throw new BadRequestException('Period is already open');
    }

    const now = new Date();
    const updated = await this.prisma.accountingPeriod.update({
      where: { id: periodId },
      data: {
        status:       'OPEN',
        // ── close metadata preserved — do NOT null these out ──────────────
        // closedById and closedAt intentionally left untouched; they are facts.
        // ── reopen metadata ───────────────────────────────────────────────
        reopenedById,
        reopenedAt:   now,
        reopenReason: reason.trim(),
        reopenCount:  { increment: 1 },
      },
    });

    // Immutable audit record — fire-and-forget
    void this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'AccountingPeriod',
      entityId:    periodId,
      before:      { status: 'CLOSED', closedById: period.closedById, closedAt: period.closedAt },
      after:       { status: 'OPEN', reopenedById, reopenedAt: now, reopenReason: reason.trim(),
                     reopenCount: updated.reopenCount },
      description: `Accounting period "${period.name}" reopened. Reason: ${reason.trim()}`,
      performedBy: reopenedById,
      ipAddress,
    });

    return updated;
  }

  /**
   * Check if a given date falls inside a closed period.
   * Used by the journal service before posting any entry.
   */
  async assertDateIsOpen(tenantId: string, date: Date) {
    const closedPeriod = await this.prisma.accountingPeriod.findFirst({
      where: {
        tenantId,
        status: 'CLOSED',
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
    if (closedPeriod) {
      throw new ForbiddenException(
        `Cannot post to a closed accounting period: "${closedPeriod.name}". ` +
        `Ask your Business Owner to reopen it if this was an error.`,
      );
    }
  }

  /**
   * Period-Close Checklist (CLOCO style — modelled after SAP's Closing Cockpit).
   * Returns a structured list of pre-close checks, each auto-evaluated where
   * the system has the data, otherwise marked "manual confirmation".
   *
   * Status enum:
   *   PASS    — auto-check passed; safe to close
   *   FAIL    — auto-check failed; must fix before closing
   *   MANUAL  — system can't verify; user attests
   *   N_A     — not applicable for this tenant (e.g. no payroll set up)
   */
  async getCloseChecklist(tenantId: string, periodId: string) {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, tenantId },
    });
    if (!period) throw new NotFoundException('Period not found.');

    const periodEnd = new Date(period.endDate);
    periodEnd.setHours(23, 59, 59, 999);

    type Check = {
      id:     string;
      group:  string;
      title:  string;
      detail: string;
      status: 'PASS' | 'FAIL' | 'MANUAL' | 'N_A';
      hint?:  string;
      link?:  string;
      count?: number;
    };

    const checks: Check[] = [];

    // ── Group: TRANSACTIONS ────────────────────────────────────────────────
    const openShifts = await this.prisma.shift.count({
      where: { tenantId, closedAt: null, openedAt: { lte: periodEnd } },
    });
    checks.push({
      id: 'shifts-closed', group: 'Transactions',
      title: 'All POS shifts closed',
      detail: 'Every cashier shift opened during the period must be closed before the books lock.',
      status: openShifts === 0 ? 'PASS' : 'FAIL',
      count: openShifts,
      hint: openShifts > 0 ? `${openShifts} open shift${openShifts === 1 ? '' : 's'} blocking close.` : 'No open shifts.',
      link: '/pos/orders',
    });

    const draftBills = await this.prisma.aPBill.count({
      where: { tenantId, status: 'DRAFT', billDate: { lte: periodEnd } },
    });
    checks.push({
      id: 'ap-bills-finalised', group: 'Transactions',
      title: 'All vendor bills finalised',
      detail: 'Draft AP bills inside the period should be either posted or cancelled.',
      status: draftBills === 0 ? 'PASS' : 'FAIL',
      count: draftBills,
      hint: draftBills > 0 ? `${draftBills} draft bill${draftBills === 1 ? '' : 's'} pending.` : 'No drafts.',
      link: '/ledger/ap/bills',
    });

    const draftInvoices = await this.prisma.aRInvoice.count({
      where: { tenantId, status: 'DRAFT', invoiceDate: { lte: periodEnd } },
    });
    checks.push({
      id: 'ar-invoices-finalised', group: 'Transactions',
      title: 'All AR invoices finalised',
      detail: 'Draft customer invoices inside the period should be posted or cancelled.',
      status: draftInvoices === 0 ? 'PASS' : 'FAIL',
      count: draftInvoices,
      hint: draftInvoices > 0 ? `${draftInvoices} draft invoice${draftInvoices === 1 ? '' : 's'} pending.` : 'No drafts.',
      link: '/ledger/ar/billing',
    });

    const pendingClaims = await this.prisma.expenseClaim.count({
      where: { tenantId, status: 'SUBMITTED' },
    }).catch(() => 0);
    checks.push({
      id: 'expense-claims', group: 'Transactions',
      title: 'Expense claims approved or rejected',
      detail: 'Pending expense claims will leak across periods if left unhandled.',
      status: pendingClaims === 0 ? 'PASS' : 'FAIL',
      count: pendingClaims,
      hint: pendingClaims > 0 ? `${pendingClaims} pending approval.` : 'All processed.',
      link: '/ledger/expense-approvals',
    });

    // ── Group: ACCOUNTING ─────────────────────────────────────────────────
    const pendingEvents = await this.prisma.accountingEvent.count({
      where: { tenantId, status: 'PENDING', createdAt: { lte: periodEnd } },
    });
    checks.push({
      id: 'events-pending', group: 'Accounting',
      title: 'Event Queue empty (PENDING)',
      detail: 'Pending accounting events become orphan if the period closes.',
      status: pendingEvents === 0 ? 'PASS' : 'FAIL',
      count: pendingEvents,
      hint: pendingEvents > 0 ? `${pendingEvents} event${pendingEvents === 1 ? '' : 's'} unprocessed.` : 'Queue clear.',
      link: '/ledger/events',
    });

    const failedEvents = await this.prisma.accountingEvent.count({
      where: { tenantId, status: 'FAILED', createdAt: { lte: periodEnd } },
    });
    checks.push({
      id: 'events-failed', group: 'Accounting',
      title: 'No FAILED accounting events',
      detail: 'Failed events represent transactions that never made it into the GL.',
      status: failedEvents === 0 ? 'PASS' : 'FAIL',
      count: failedEvents,
      hint: failedEvents > 0 ? `${failedEvents} event${failedEvents === 1 ? '' : 's'} need triage.` : 'No failures.',
      link: '/ledger/events',
    });

    const pendingApprovalJEs = await this.prisma.journalEntry.count({
      where: { tenantId, status: 'PENDING_APPROVAL' },
    });
    checks.push({
      id: 'je-pending-approval', group: 'Accounting',
      title: 'No JEs awaiting approval',
      detail: 'Journal entries above the approval threshold need sign-off before posting.',
      status: pendingApprovalJEs === 0 ? 'PASS' : 'FAIL',
      count: pendingApprovalJEs,
      hint: pendingApprovalJEs > 0 ? `${pendingApprovalJEs} entr${pendingApprovalJEs === 1 ? 'y' : 'ies'} pending.` : 'Cleared.',
      link: '/ledger/journal',
    });

    // Trial Balance check
    const tb = await this.prisma.journalLine.aggregate({
      where: {
        journalEntry: {
          tenantId, status: 'POSTED',
          OR: [{ postingDate: { lte: periodEnd } }, { postingDate: null, date: { lte: periodEnd } }],
        },
      },
      _sum: { debit: true, credit: true },
    });
    const variance = Math.abs(Number(tb._sum.debit ?? 0) - Number(tb._sum.credit ?? 0));
    checks.push({
      id: 'tb-balanced', group: 'Accounting',
      title: 'Trial Balance balanced',
      detail: 'Σ Debits must equal Σ Credits at period end (to the centavo).',
      status: variance < 0.005 ? 'PASS' : 'FAIL',
      hint: variance < 0.005 ? 'Books balance.' : `Off by ₱${variance.toFixed(2)}.`,
      link: '/ledger/trial-balance',
    });

    // ── Group: RECONCILIATION ─────────────────────────────────────────────
    const cashAccounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true, code: { startsWith: '10' } },
      select: { id: true, code: true },
    });
    let reconCount = 0;
    for (const a of cashAccounts) {
      const recon = await this.prisma.bankReconciliation.findFirst({
        where: {
          tenantId, accountId: a.id, status: 'COMPLETED',
          periodEnd: { gte: new Date(period.endDate.getFullYear(), period.endDate.getMonth(), 1) },
        },
      });
      if (recon) reconCount++;
    }
    checks.push({
      id: 'bank-recon', group: 'Reconciliation',
      title: 'Bank reconciliation completed',
      detail: 'Each cash/bank account should have a completed reconciliation for the period.',
      status: cashAccounts.length === 0 ? 'N_A' :
              reconCount === cashAccounts.length ? 'PASS' :
              reconCount > 0 ? 'FAIL' : 'MANUAL',
      count: cashAccounts.length,
      hint: cashAccounts.length === 0 ? 'No cash accounts seeded.' :
            `${reconCount} of ${cashAccounts.length} bank accounts reconciled.`,
      link: '/ledger/bank-recon',
    });

    // ── Group: MANUAL ATTESTATIONS ────────────────────────────────────────
    checks.push({
      id: 'tax-forms', group: 'Compliance',
      title: 'BIR tax forms reviewed',
      detail: '2550Q (VAT) / 1701Q (income tax) data sanity-checked for the period.',
      status: 'MANUAL',
      hint: 'Owner/Accountant attests after reviewing the Tax Estimation page.',
      link: '/ledger/bir',
    });
    checks.push({
      id: 'reports-archived', group: 'Compliance',
      title: 'Period reports archived',
      detail: 'Trial Balance, P&L, Balance Sheet, Cash Flow exported and saved offline.',
      status: 'MANUAL',
      hint: 'Owner/Accountant attests.',
    });

    // ── Roll-up status ────────────────────────────────────────────────────
    const failed = checks.filter((c) => c.status === 'FAIL').length;
    const manual = checks.filter((c) => c.status === 'MANUAL').length;
    const ready = failed === 0;

    return { period, checks, failed, manual, ready };
  }
}
