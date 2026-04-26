import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

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
  ) {
    // Verify branch belongs to tenant (CRITICAL-2 fix — prevents cross-tenant branch injection)
    await this.assertBranchBelongsToTenant(tenantId, branchId);

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

    const openingCash = Number(shift.openingCash);
    const expectedCash = openingCash + cashSales;

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
      expectedCash,
      digitalBreakdown,
    };
  }
}
