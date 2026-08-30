import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { ReportsService } from '../reports/reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '@prisma/client';

/**
 * Above this amount, a manager PIN co-auth is required for PAID_OUT.
 * Tenant-overridable in future settings; hardcoded for v1.
 */
const PAID_OUT_APPROVAL_THRESHOLD = 500;

export interface ShiftSummary {
  id: string;
  tenantId: string;
  branchId: string;
  cashierId: string;
  openingCash: number;
  openedAt: Date;
  closedAt: Date | null;
  closingCashDeclared: number | null;
  closingCashExpected: number | null;
  variance: number | null;
  notes: string | null;
  // computed
  cashSales: number;
  nonCashSales: number;
  totalSales: number;
  orderCount: number;
  voidCount: number;
  /** Total of all PAID_OUT cash-outs during the shift (real expenses from till). */
  paidOutTotal: number;
  /** Total of all CASH_DROP cash-outs during the shift (mid-shift moves to safe). */
  cashDropTotal: number;
  /**
   * Cash handed back to customers during this shift.
   *
   * Attributed by when the cash LEFT the drawer, not when the sale happened —
   * a refund against yesterday's coffee empties today's till.
   */
  refundTotal: number;
  /**
   * Cash rung at this branch during the shift window that carries no shiftId.
   *
   * Supervisors bypass the shift gate, so their sales land here. Reported, not
   * folded into expectedCash — the cashier should not be made accountable for
   * a drawer someone else added to, but she should be able to see why it is
   * over.
   */
  unattributedCashSales: number;
  expectedCash: number;
  /** Breakdown of digital payment totals by method for cashier reconciliation */
  digitalBreakdown: Record<string, number>;
}

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);

  constructor(
    private prisma:  PrismaService,
    private audit:   AuditService,
    private reports: ReportsService,
  ) {}

  // ─── Branch ownership guard ───────────────────────────────────────────────

  private async assertBranchBelongsToTenant(tenantId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { id: true },
    });
    if (!branch) {
      throw new ForbiddenException(
        'The provided branchId does not belong to your organization.',
      );
    }
  }

  // ─── Open shift ──────────────────────────────────────────────────────────

  async open(
    tenantId: string,
    cashierId: string,
    branchId: string,
    openingCash: number,
    notes?: string,
    terminalId?: string,
  ) {
    // Verify branch belongs to tenant (CRITICAL-2 fix — prevents cross-tenant branch injection)
    await this.assertBranchBelongsToTenant(tenantId, branchId);

    // Verify terminal belongs to tenant if supplied (Sprint 3 — multi-terminal)
    if (terminalId) {
      const term = await this.prisma.terminal.findFirst({
        where: { id: terminalId, tenantId },
        select: { id: true },
      });
      if (!term) {
        throw new BadRequestException('Selected terminal does not belong to your organization.');
      }
    }

    // Idempotent within the same calendar day (Asia/Manila / PH timezone):
    // - Same-day open shift → return it (cashier re-opening the page mid-shift)
    // - Previous-day open shift → auto-close it, then fall through to create a new one
    //   (handles the case where the shift was never closed at end of business day)
    const existing = await this.prisma.shift.findFirst({
      where: { tenantId, cashierId, branchId, closedAt: null },
    });
    if (existing) {
      const today    = new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });
      const shiftDay = new Date(existing.openedAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });
      if (shiftDay === today) {
        return existing;  // same day — fully idempotent, return the open shift
      }
      // Previous day — auto-close the stale shift before opening a fresh one.
      // closingCashDeclared is left null to signal it was system-closed (not cashier-declared).
      await this.prisma.shift.update({
        where: { id: existing.id },
        data:  { closedAt: new Date() },
      });
    }

    return this.prisma.shift.create({
      data: {
        tenantId,
        branchId,
        cashierId,
        terminalId: terminalId ?? null,
        openingCash: new Prisma.Decimal(openingCash),
        notes,
      },
    });
  }

  // ─── Get active shift for current cashier+branch ────────────────────────

  async getActive(
    tenantId: string,
    cashierId: string,
    branchId: string,
  ): Promise<ShiftSummary | null> {
    const shift = await this.prisma.shift.findFirst({
      where: { tenantId, cashierId, branchId, closedAt: null },
    });
    if (!shift) return null;
    return this.buildSummary(shift);
  }

  // ─── Get any shift by ID (with summary) ─────────────────────────────────

  async getById(tenantId: string, shiftId: string): Promise<ShiftSummary> {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, tenantId },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    return this.buildSummary(shift);
  }

  // ─── Close shift ─────────────────────────────────────────────────────────

  async close(
    tenantId: string,
    shiftId: string,
    cashierId: string,
    closingCashDeclared: number,
    notes?: string,
  ) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, tenantId },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.cashierId !== cashierId) throw new ForbiddenException('Only the shift owner can close this shift');
    if (shift.closedAt) throw new ConflictException('Shift is already closed');

    const summary = await this.buildSummary(shift);
    const closingCashExpected = summary.expectedCash;
    const variance = closingCashDeclared - closingCashExpected;

    // Atomic close + variance JE event in one transaction. Without this,
    // a shift could close successfully but the cash-variance JE could fail
    // and leave the GL out of sync with the actual drawer count. Wrapping in
    // a transaction guarantees all-or-nothing.
    const closed = await this.prisma.$transaction(async (tx) => {
      // HIGH-1 TOCTOU fix: updateMany with compound { id, tenantId, closedAt: null }
      // is atomic — the tenantId guard and the "not-yet-closed" check happen in one
      // SQL statement, eliminating the window between findFirst and the write.
      const result = await tx.shift.updateMany({
        where: { id: shiftId, tenantId, closedAt: null },
        data: {
          closedAt:            new Date(),
          closingCashDeclared: new Prisma.Decimal(closingCashDeclared),
          closingCashExpected: new Prisma.Decimal(closingCashExpected),
          variance:            new Prisma.Decimal(variance),
          notes:               notes ?? shift.notes,
        },
      });
      if (result.count === 0) {
        throw new ConflictException('Shift is already closed.');
      }

      // Queue cash-variance JE — non-zero variance only. Zero variance means
      // the drawer reconciled perfectly and there's nothing to post.
      if (variance !== 0) {
        await tx.accountingEvent.create({
          data: {
            tenantId,
            type:    'CASH_VARIANCE',
            status:  'PENDING',
            payload: {
              shiftId,
              cashierId,
              branchId:       shift.branchId,
              variance,
              declaredAmount: closingCashDeclared,
              expectedAmount: closingCashExpected,
              completedAt:    new Date().toISOString(),
            } as unknown as Prisma.JsonObject,
          },
        });
      }

      return tx.shift.findFirst({ where: { id: shiftId, tenantId } });
    });

    /*
      The last shift at a branch closing IS the end of the business day, so
      that is when the Z-Read gets written.

      POST /reports/z-read has always existed, is correct, and is idempotent
      per branch per day — and nothing in the product ever called it. The
      Z-Read History report in Ledger reads a table nothing writes. For a
      VAT-registered shop that is the daily record the BIR expects a CAS to
      keep, so its absence is not a missing convenience.

      Not a clock-based cron: a shop's day ends when the shop says it does,
      and a Z-Read fired at 23:55 while the till is still open would lock the
      day's totals early — the record is idempotent, so the premature one
      would win and the late sales would never appear on it.

      Not a call from the browser either: the endpoint is restricted to
      managers and owners, and the person who closes the last shift is usually
      a cashier. Generated here, server-side, where the close already is.

      Deliberately outside the transaction and deliberately swallowing its own
      errors: a cashier at 10pm must be able to close her drawer whether or not
      the day's Z-Read could be built. A missing Z-Read is recoverable — the
      owner regenerates it from Reports, and it is idempotent so nothing
      duplicates. A drawer she cannot close is not.
    */
    const stillOpen = await this.prisma.shift.count({
      where: { tenantId, branchId: shift.branchId, closedAt: null },
    });
    if (stillOpen === 0) {
      try {
        await this.reports.generateZRead(
          tenantId,
          shift.branchId,
          ShiftsService.todayPH(),
          cashierId,
        );
      } catch (err) {
        // Logged, never thrown. See above.
        this.logger.error(
          `[shifts] Z-Read generation failed for branch ${shift.branchId} after closing ` +
          `shift ${shiftId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return closed;
  }

  /** Today's date in PH local time (UTC+8) as YYYY-MM-DD. */
  private static todayPH(): string {
    const ph = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return ph.toISOString().slice(0, 10);
  }

  // ─── Cash Out / Cash Drop ───────────────────────────────────────────────

  /**
   * Record a cash-out event during a shift.
   *
   *   PAID_OUT  → real expense paid from cash drawer; reduces expected cash AND
   *               (future) creates a journal entry: DR <expense> / CR Cash on Hand.
   *   CASH_DROP → mid-shift safekeeping; reduces expected cash; offset is
   *               "Cash on Safe" — not an expense.
   *
   * Above PAID_OUT_APPROVAL_THRESHOLD an approvedById is required.
   * The approver must belong to this tenant and have a role permitted to
   * approve (BUSINESS_OWNER / BRANCH_MANAGER / SALES_LEAD).
   */
  /**
   * Handover drawer count — the shortage firewall between two cashiers.
   *
   * The quick till switch deliberately leaves the shift (and its eventual
   * variance) with the cashier who opened the drawer. That is right for
   * accountability but leaves one dispute unanswerable: if the drawer closes
   * short, was it short BEFORE the relief cashier took over, or after?
   *
   * This records the answer at the moment it can still be known: the person
   * taking over counts the drawer, and the declared amount is stored against
   * the system's expected cash AT THAT INSTANT. A shortage that predates the
   * handover shows up here, on the record, before the relief cashier has rung
   * a single sale — protecting both of them.
   *
   * Optional by design. Skipping it just means the variance question stays
   * with the drawer owner, exactly as it is today.
   *
   * Stored twice, deliberately:
   *   - the immutable audit log (Who column, no-update/no-delete triggers)
   *   - appended to Shift.notes, so it surfaces on the Z-read where variances
   *     are actually reviewed.
   */
  async recordHandover(
    tenantId: string,
    shiftId: string,
    countedById: string,
    countedByName: string,
    declaredCash: number,
  ) {
    if (!Number.isFinite(declaredCash) || declaredCash < 0) {
      throw new BadRequestException('Enter the amount counted in the drawer.');
    }

    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, tenantId },
    });
    if (!shift) throw new NotFoundException('Shift not found.');
    if (shift.closedAt) throw new BadRequestException('This shift is already closed.');

    const summary = await this.buildSummary(shift);
    const expected = summary.expectedCash;
    const variance = Math.round((declaredCash - expected) * 100) / 100;

    const stamp = new Date().toLocaleTimeString('en-PH', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
    });
    const line =
      `[handover ${stamp}] ${countedByName || 'Relief'} counted ` +
      `${declaredCash.toFixed(2)} vs expected ${expected.toFixed(2)} ` +
      `(${variance >= 0 ? '+' : ''}${variance.toFixed(2)})`;

    await this.prisma.shift.update({
      where: { id: shift.id },
      data:  { notes: shift.notes ? `${shift.notes}
${line}` : line },
    });

    await this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'SHIFT_HANDOVER',
      entityId:    shift.id,
      description: line,
      after: {
        shiftId:      shift.id,
        drawerOwner:  shift.cashierId,
        countedBy:    countedById,
        declaredCash,
        expectedCash: expected,
        variance,
      },
      performedBy: countedById,
    });

    return { declaredCash, expectedCash: expected, variance };
  }

  async recordCashOut(
    tenantId: string,
    shiftId: string,
    cashierId: string,
    dto: {
      type: 'PAID_OUT' | 'CASH_DROP';
      amount: number;
      reason: string;
      category?: string;
      receiptPhotoUrl?: string;
      approvedById?: string;
      aiAssisted?: boolean;
    },
  ) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, tenantId },
      select: { id: true, branchId: true, cashierId: true, closedAt: true, openingCash: true },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.closedAt) throw new ConflictException('Cannot record cash-out on a closed shift');

    // Cap amount at opening cash + cash sales so we never go negative.
    // Compute current expected cash on the fly.
    const orders = await this.prisma.order.findMany({
      where: { shiftId, tenantId, status: { not: 'VOIDED' } },
      include: { payments: true },
    });
    let cashSalesNet = 0;
    for (const o of orders) {
      const nonCash = o.payments.reduce((s, p) => s + (p.method !== 'CASH' ? Number(p.amount) : 0), 0);
      cashSalesNet += Math.max(0, Number(o.totalAmount) - nonCash);
    }
    const priorCashOuts = await this.prisma.shiftCashOut.aggregate({
      where: { shiftId },
      _sum: { amount: true },
    });
    const priorTotal     = Number(priorCashOuts._sum.amount ?? 0);
    const availableCash  = Number(shift.openingCash) + cashSalesNet - priorTotal;
    if (dto.amount > availableCash) {
      throw new BadRequestException(
        `Cannot pay out ₱${dto.amount.toFixed(2)} — only ₱${availableCash.toFixed(2)} left in the till.`,
      );
    }

    // PAID_OUT above threshold requires manager co-auth.
    if (dto.type === 'PAID_OUT' && dto.amount > PAID_OUT_APPROVAL_THRESHOLD) {
      if (!dto.approvedById) {
        throw new ForbiddenException(
          `Paid-outs over ₱${PAID_OUT_APPROVAL_THRESHOLD} require manager approval. ` +
          `Have a SALES_LEAD or BRANCH_MANAGER sign off.`,
        );
      }
      const approver = await this.prisma.user.findFirst({
        where: {
          id:       dto.approvedById,
          tenantId,
          isActive: true,
          role:     { in: ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'] },
        },
        select: { id: true, role: true },
      });
      if (!approver) {
        throw new ForbiddenException('Approver must be an active manager in your organization.');
      }
    }

    // CASH_DROP requires manager+ regardless of amount — the cashier shouldn't
    // self-authorize moving cash to the safe.
    if (dto.type === 'CASH_DROP') {
      if (!dto.approvedById) {
        throw new ForbiddenException('Cash drops require manager confirmation.');
      }
    }

    // Atomic cash-out + JE event in one transaction. PAID_OUT events post a
    // real expense to the GL (DR Expense / CR Cash); CASH_DROP is a balance-sheet
    // movement only (cash out of till, into safe — both still tenant assets,
    // no GL impact unless the tenant tracks a separate "Cash on Safe" account
    // and chooses to journal it manually).
    return this.prisma.$transaction(async (tx) => {
      const cashOut = await tx.shiftCashOut.create({
        data: {
          tenantId,
          branchId:        shift.branchId,
          shiftId,
          type:            dto.type,
          amount:          new Prisma.Decimal(dto.amount),
          reason:          dto.reason,
          category:        dto.category,
          receiptPhotoUrl: dto.receiptPhotoUrl,
          createdById:     cashierId,
          approvedById:    dto.approvedById,
          aiAssisted:      dto.aiAssisted ?? false,
        },
      });

      if (dto.type === 'PAID_OUT') {
        // Queue the GL posting. Processor: DR <category-mapped expense> / CR Cash.
        // Without this every paid-out leaks from the GL — cash leaves the
        // drawer and shows up in the variance at close, but no expense
        // category gets debited.
        await tx.accountingEvent.create({
          data: {
            tenantId,
            type:    'PAID_OUT',
            status:  'PENDING',
            payload: {
              cashOutId:   cashOut.id,
              shiftId,
              branchId:    shift.branchId,
              cashierId,
              amount:      dto.amount,
              category:    (dto.category ?? 'OTHER').toUpperCase(),
              reason:      dto.reason,
              completedAt: new Date().toISOString(),
            } as unknown as Prisma.JsonObject,
          },
        });
      }

      return cashOut;
    });
  }

  /** List cash-outs for a shift (for the EOD report and live cart-side view). */
  async listCashOuts(tenantId: string, shiftId: string) {
    return this.prisma.shiftCashOut.findMany({
      where: { tenantId, shiftId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Cancel a cash-out before close. Only the recording cashier or a manager+ can void it. */
  async deleteCashOut(tenantId: string, shiftId: string, cashOutId: string, callerId: string, callerRole: string) {
    const cashOut = await this.prisma.shiftCashOut.findFirst({
      where:  { id: cashOutId, shiftId, tenantId },
      include: { shift: { select: { closedAt: true } } },
    });
    if (!cashOut) throw new NotFoundException('Cash-out record not found');
    if (cashOut.shift.closedAt) {
      throw new ConflictException('Cannot delete cash-out from a closed shift');
    }
    const isOwnRecord = cashOut.createdById === callerId;
    const canManage   = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'].includes(callerRole);
    if (!isOwnRecord && !canManage) {
      throw new ForbiddenException('Only the recording cashier or a manager can remove a cash-out.');
    }
    await this.prisma.shiftCashOut.delete({ where: { id: cashOutId } });
  }

  // ─── List recent shifts for a branch ────────────────────────────────────

  async list(tenantId: string, branchId?: string, limit = 20) {
    return this.prisma.shift.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}) },
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
  }

  // ─── Private: compute summary from orders ────────────────────────────────

  private async buildSummary(shift: {
    id: string;
    tenantId: string;
    branchId: string;
    cashierId: string;
    openingCash: Prisma.Decimal;
    openedAt: Date;
    closedAt: Date | null;
    closingCashDeclared: Prisma.Decimal | null;
    closingCashExpected: Prisma.Decimal | null;
    variance: Prisma.Decimal | null;
    notes: string | null;
  }): Promise<ShiftSummary> {
    const orders = await this.prisma.order.findMany({
      where: { shiftId: shift.id, tenantId: shift.tenantId },
      include: { payments: true },
    });

    // Cash leaving the till mid-shift (paid-outs + cash drops). Subtract from
    // expected cash so close-shift variance reconciles correctly.
    const cashOuts = await this.prisma.shiftCashOut.findMany({
      where:  { shiftId: shift.id, tenantId: shift.tenantId },
      select: { type: true, amount: true },
    });
    let paidOutTotal  = 0;
    let cashDropTotal = 0;
    for (const c of cashOuts) {
      const amt = Number(c.amount);
      if (c.type === 'PAID_OUT')  paidOutTotal  += amt;
      if (c.type === 'CASH_DROP') cashDropTotal += amt;
    }

    /*
      Cash handed back to customers during this shift.

      Nothing here read refunds at all, so a ₱180 refund left the drawer and
      expected cash still counted the whole original sale. The drawer came up
      ₱180 short, the system booked a shortage, and the cashier was asked to
      sign for money she had given to a customer in front of a witness. The
      help text on the close screen already promised the opposite.

      Attributed by WHEN THE CASH LEFT, not when the sale happened: a refund
      against yesterday's coffee empties today's drawer, so it belongs to the
      shift that was open at the time. OrderItemRefund carries no shiftId, so
      the shift's own window plus its branch is the attribution — which is the
      same thing a shiftId would have recorded.

      Only CASH. A GCash reversal never touches the drawer.
    */
    const refunds = await this.prisma.orderItemRefund.findMany({
      where: {
        refundMethod: 'CASH',
        createdAt: { gte: shift.openedAt, ...(shift.closedAt ? { lte: shift.closedAt } : {}) },
        orderItem: { order: { tenantId: shift.tenantId, branchId: shift.branchId } },
      },
      select: { refundAmount: true },
    });
    const refundTotal = refunds.reduce((s, r) => s + Number(r.refundAmount), 0);

    /*
      Cash rung at this till during this shift that belongs to NO shift.

      Supervisors bypass the shift gate (ShiftGate.tsx), so when the owner
      jumps on the till at the morning rush his sales carry no shiftId. The
      cash still goes into the same physical drawer. At close, the barista
      counts more than she is expected to have, the system books the surplus
      to the GL as income, and she is asked to sign for money she cannot
      explain.

      Whether an owner should have to open his own shift is a decision about
      how the shop runs, not something to settle here — and with several
      shifts open per branch there is no unambiguous shift to attach a stray
      order to. What is not in doubt is that the money must be visible. Named
      here, the overage has an explanation instead of being a mystery; if the
      policy later becomes "everyone opens a shift", this simply reads zero.
    */
    const unattributed = await this.prisma.order.findMany({
      where: {
        tenantId: shift.tenantId,
        branchId: shift.branchId,
        shiftId:  null,
        channel:  'POS',
        status:   { not: 'VOIDED' },
        createdAt: { gte: shift.openedAt, ...(shift.closedAt ? { lte: shift.closedAt } : {}) },
      },
      include: { payments: true },
    });
    let unattributedCashSales = 0;
    for (const o of unattributed) {
      const nonCash = o.payments
        .filter((p) => p.method !== 'CASH')
        .reduce((s, p) => s + Number(p.amount), 0);
      unattributedCashSales += Math.max(0, Number(o.totalAmount) - nonCash);
    }

    let cashSales = 0;
    let nonCashSales = 0;
    let orderCount = 0;
    let voidCount = 0;
    const digitalBreakdown: Record<string, number> = {};

    for (const order of orders) {
      if (order.status === 'VOIDED') { voidCount++; continue; }
      orderCount++;

      // Sum non-cash payments first (these are always exact — no change given)
      let orderNonCash = 0;
      for (const p of order.payments) {
        if (p.method !== 'CASH') {
          const amt = Number(p.amount);
          orderNonCash += amt;
          digitalBreakdown[p.method] = (digitalBreakdown[p.method] ?? 0) + amt;
        }
      }
      nonCashSales += orderNonCash;

      // Net cash kept = order total minus what non-cash covered.
      // Using order total (not tendered) correctly excludes change given back.
      const orderCashNet = Math.max(0, Number(order.totalAmount) - orderNonCash);
      cashSales += orderCashNet;
    }

    const openingCash  = Number(shift.openingCash);
    // Expected cash = opening + cash sales − cash refunds − paid-outs − drops.
    // Drops physically leave the till; paid-outs are spent; refunds are handed
    // back across the counter. All three reduce what the cashier should have
    // on hand at close, and leaving refunds out made every one of them look
    // like a shortage on her name.
    const expectedCash = openingCash + cashSales - refundTotal - paidOutTotal - cashDropTotal;

    return {
      id: shift.id,
      tenantId: shift.tenantId,
      branchId: shift.branchId,
      cashierId: shift.cashierId,
      openingCash,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      closingCashDeclared: shift.closingCashDeclared ? Number(shift.closingCashDeclared) : null,
      closingCashExpected: shift.closingCashExpected ? Number(shift.closingCashExpected) : null,
      variance: shift.variance ? Number(shift.variance) : null,
      notes: shift.notes,
      cashSales,
      nonCashSales,
      totalSales: cashSales + nonCashSales,
      orderCount,
      voidCount,
      paidOutTotal,
      cashDropTotal,
      // Surfaced so the close screen can show the subtraction rather than
      // making the three numbers fail to add up on screen.
      refundTotal,
      /*
        Cash in this drawer that no shift claims — almost always a supervisor
        ringing sales outside the shift gate. NOT added to expectedCash: it is
        reported so the overage has a name, and adding it would quietly make
        one person accountable for another's till.
      */
      unattributedCashSales,
      expectedCash,
      digitalBreakdown,
    };
  }
}
