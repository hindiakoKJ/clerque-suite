import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
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
}

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  // ─── Open shift ──────────────────────────────────────────────────────────

  async open(
    tenantId: string,
    cashierId: string,
    branchId: string,
    openingCash: number,
    notes?: string,
  ) {
    // Idempotent: return existing active shift if one exists for this cashier+branch
    const existing = await this.prisma.shift.findFirst({
      where: { tenantId, cashierId, branchId, closedAt: null },
    });
    if (existing) return existing;

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

    return this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        closedAt: new Date(),
        closingCashDeclared: new Prisma.Decimal(closingCashDeclared),
        closingCashExpected: new Prisma.Decimal(closingCashExpected),
        variance: new Prisma.Decimal(variance),
        notes: notes ?? shift.notes,
      },
    });
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

    for (const order of orders) {
      if (order.status === 'VOIDED') { voidCount++; continue; }
      orderCount++;
      for (const p of order.payments) {
        const amt = Number(p.amount);
        if (p.method === 'CASH') {
          cashSales += amt;
        } else {
          nonCashSales += amt;
        }
      }
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
    };
  }
}
