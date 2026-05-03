import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  expectedCash: number;
  /** Breakdown of digital payment totals by method for cashier reconciliation */
  digitalBreakdown: Record<string, number>;
}

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

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

    // HIGH-1 TOCTOU fix: updateMany with compound { id, tenantId, closedAt: null }
    // is atomic — the tenantId guard and the "not-yet-closed" check happen in one
    // SQL statement, eliminating the window between findFirst and the write.
    await this.prisma.shift.updateMany({
      where: { id: shiftId, tenantId, closedAt: null },
      data: {
        closedAt:            new Date(),
        closingCashDeclared: new Prisma.Decimal(closingCashDeclared),
        closingCashExpected: new Prisma.Decimal(closingCashExpected),
        variance:            new Prisma.Decimal(variance),
        notes:               notes ?? shift.notes,
      },
    });

    // Re-fetch the closed shift for the response (updateMany does not return rows)
    return this.prisma.shift.findFirst({ where: { id: shiftId, tenantId } });
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

    return this.prisma.shiftCashOut.create({
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
    // Expected cash = opening + cash sales − paid-outs − cash drops.
    // Drops physically leave the till; paid-outs are spent. Both reduce what
    // the cashier should have on hand at close.
    const expectedCash = openingCash + cashSales - paidOutTotal - cashDropTotal;

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
      expectedCash,
      digitalBreakdown,
    };
  }
}
