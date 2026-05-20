/**
 * Clerque API — FuelService (MSME gas station)
 *
 * Manual-meter workflow:
 *   1. Owner configures pumps (createPump): label + fuel grade + linked Product
 *   2. Cashier taps an IDLE pump → startDispense(openingMeter, attendantId)
 *   3. After fill → endDispense(closingMeter): computes liters, snapshots
 *      pricePerLiter, returns the line ready to be tendered. Caller (Counter
 *      or OrdersService) sends the eventual orderId via attachOrder() once
 *      tendered.
 *
 * Tank dip log: morning / evening / delivery rows recorded for reconciliation.
 * Variance reports (expected dispense from meters vs change in tank dips)
 * are a Phase 2 follow-up — schema is ready, report code stub-only for now.
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, FuelGrade, FuelDispenseStatus, TankDipKind } from '@prisma/client';

export interface CreatePumpDto {
  branchId:    string;
  label:       string;
  fuelGrade:   FuelGrade;
  productId:   string;
  currentMeter?:        number;
  doeCeilingPricePhp?:  number | null;
  sortOrder?:           number;
}

export interface UpdatePumpDto {
  label?:        string;
  fuelGrade?:    FuelGrade;
  productId?:    string;
  currentMeter?:        number;
  doeCeilingPricePhp?:  number | null;
  isActive?:     boolean;
  sortOrder?:    number;
}

export interface StartDispenseDto {
  pumpId:        string;
  attendantId?:  string;   // defaults to the calling cashier
  openingMeter:  number;
}

export interface EndDispenseDto {
  closingMeter: number;
}

export interface RecordTankDipDto {
  branchId:        string;
  fuelGrade:       FuelGrade;
  recordedAt:      string;   // ISO
  kind:            TankDipKind;
  litersOnHand:    number;
  deliveryLiters?: number;
  notes?:          string;
}

@Injectable()
export class FuelService {
  constructor(private prisma: PrismaService) {}

  // ─── Pumps (owner setup) ────────────────────────────────────────────────

  async listPumps(tenantId: string, branchId?: string) {
    return this.prisma.fuelPump.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}), isActive: true },
      include: {
        product: { select: { id: true, name: true, price: true } },
        dispenses: {
          where: { status: 'OPEN' },
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { attendant: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async createPump(tenantId: string, dto: CreatePumpDto) {
    // Tenant-scope the product.
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Product not found.');
    if (!dto.label?.trim()) throw new BadRequestException('Pump label is required.');

    try {
      return await this.prisma.fuelPump.create({
        data: {
          tenantId,
          branchId:     dto.branchId,
          label:        dto.label.trim(),
          fuelGrade:    dto.fuelGrade,
          productId:    dto.productId,
          currentMeter: new Prisma.Decimal(dto.currentMeter ?? 0),
          doeCeilingPricePhp: dto.doeCeilingPricePhp != null
            ? new Prisma.Decimal(dto.doeCeilingPricePhp)
            : null,
          sortOrder:    dto.sortOrder ?? 0,
        },
        include: { product: { select: { id: true, name: true, price: true } } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Pump label "${dto.label}" already exists for this branch.`);
      }
      throw err;
    }
  }

  async updatePump(tenantId: string, id: string, dto: UpdatePumpDto) {
    const existing = await this.prisma.fuelPump.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Pump not found.');
    if (dto.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: dto.productId, tenantId },
        select: { id: true },
      });
      if (!product) throw new BadRequestException('Product not found.');
    }
    return this.prisma.fuelPump.update({
      where: { id },
      data: {
        label:        dto.label?.trim(),
        fuelGrade:    dto.fuelGrade,
        productId:    dto.productId,
        currentMeter: dto.currentMeter != null ? new Prisma.Decimal(dto.currentMeter) : undefined,
        // Explicit null clears the ceiling; undefined leaves it untouched.
        doeCeilingPricePhp:
          dto.doeCeilingPricePhp === null
            ? null
            : dto.doeCeilingPricePhp !== undefined
              ? new Prisma.Decimal(dto.doeCeilingPricePhp)
              : undefined,
        isActive:     dto.isActive,
        sortOrder:    dto.sortOrder,
      },
    });
  }

  // ─── Dispenses (cashier till workflow) ──────────────────────────────────

  async startDispense(tenantId: string, defaultAttendantId: string, dto: StartDispenseDto) {
    const pump = await this.prisma.fuelPump.findFirst({
      where: { id: dto.pumpId, tenantId },
      include: { product: { select: { price: true } } },
    });
    if (!pump) throw new BadRequestException('Pump not found.');
    if (!pump.isActive) throw new ConflictException('Pump is inactive.');

    // Reject if there's already an OPEN dispense on this pump.
    const open = await this.prisma.fuelDispense.findFirst({
      where: { pumpId: dto.pumpId, status: 'OPEN' },
      select: { id: true },
    });
    if (open) {
      throw new ConflictException(
        'Pump already has an OPEN dispense. Complete or void it before starting a new one.',
      );
    }

    if (!Number.isFinite(dto.openingMeter) || dto.openingMeter < 0) {
      throw new BadRequestException('Opening meter must be a non-negative number.');
    }
    if (dto.openingMeter < Number(pump.currentMeter)) {
      throw new BadRequestException(
        `Opening meter (${dto.openingMeter}) is below the recorded current meter (${Number(pump.currentMeter)}). Did you mistype?`,
      );
    }

    try {
      return await this.prisma.fuelDispense.create({
        data: {
          pumpId:        dto.pumpId,
          attendantId:   dto.attendantId ?? defaultAttendantId,
          openingMeter:  new Prisma.Decimal(dto.openingMeter),
          pricePerLiter: pump.product.price,
          status:        'OPEN',
        },
        include: {
          pump:      { include: { product: { select: { id: true, name: true } } } },
          attendant: { select: { id: true, name: true } },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A dispense with this opening meter already exists.');
      }
      throw err;
    }
  }

  async endDispense(tenantId: string, dispenseId: string, dto: EndDispenseDto) {
    const dispense = await this.prisma.fuelDispense.findUnique({
      where: { id: dispenseId },
      include: { pump: { select: { id: true, tenantId: true, currentMeter: true } } },
    });
    if (!dispense || dispense.pump.tenantId !== tenantId) {
      throw new NotFoundException('Dispense not found.');
    }
    if (dispense.status !== 'OPEN') {
      throw new ConflictException(`Dispense is already ${dispense.status}.`);
    }
    if (!Number.isFinite(dto.closingMeter)) {
      throw new BadRequestException('Closing meter must be a number.');
    }
    const opening = Number(dispense.openingMeter);
    const closing = Number(dto.closingMeter);
    const liters  = closing - opening;
    if (liters <= 0) {
      throw new BadRequestException(`Closing meter (${closing}) must exceed opening (${opening}).`);
    }
    const pricePerLiter = Number(dispense.pricePerLiter);
    const totalCents    = Math.round(liters * pricePerLiter * 100);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.fuelDispense.update({
        where: { id: dispenseId },
        data: {
          closingMeter:    new Prisma.Decimal(closing),
          litersDispensed: new Prisma.Decimal(liters),
          totalCents,
          status:          'COMPLETED',
          endedAt:         new Date(),
        },
        include: {
          pump: { include: { product: { select: { id: true, name: true, price: true } } } },
          attendant: { select: { id: true, name: true } },
        },
      });
      // Advance the pump's cumulative meter so the next dispense pre-fills
      // with the right opening reading.
      await tx.fuelPump.update({
        where: { id: dispense.pumpId },
        data:  { currentMeter: new Prisma.Decimal(closing) },
      });
      return updated;
    });
  }

  async voidDispense(tenantId: string, dispenseId: string, reason: string) {
    const dispense = await this.prisma.fuelDispense.findUnique({
      where: { id: dispenseId },
      include: { pump: { select: { tenantId: true } } },
    });
    if (!dispense || dispense.pump.tenantId !== tenantId) {
      throw new NotFoundException('Dispense not found.');
    }
    if (dispense.status === 'VOIDED') return dispense;
    return this.prisma.fuelDispense.update({
      where: { id: dispenseId },
      data: { status: 'VOIDED', voidReason: reason, endedAt: new Date() },
    });
  }

  /// Link a freshly-rung Order to a dispense (called by Counter after Charge).
  async attachOrder(tenantId: string, dispenseId: string, orderId: string) {
    const dispense = await this.prisma.fuelDispense.findUnique({
      where: { id: dispenseId },
      include: { pump: { select: { tenantId: true } } },
    });
    if (!dispense || dispense.pump.tenantId !== tenantId) {
      throw new NotFoundException('Dispense not found.');
    }
    if (dispense.orderId) return dispense;
    return this.prisma.fuelDispense.update({
      where: { id: dispenseId },
      data:  { orderId },
    });
  }

  async listDispenses(
    tenantId: string,
    opts: { branchId?: string; from?: Date; to?: Date; status?: FuelDispenseStatus } = {},
  ) {
    return this.prisma.fuelDispense.findMany({
      where: {
        pump: { tenantId, ...(opts.branchId ? { branchId: opts.branchId } : {}) },
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.from || opts.to
          ? { startedAt: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to   ? { lte: opts.to   } : {}),
              } }
          : {}),
      },
      include: {
        pump:      { include: { product: { select: { id: true, name: true } } } },
        attendant: { select: { id: true, name: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 500,
    });
  }

  // ─── Tank dips ───────────────────────────────────────────────────────────

  async recordTankDip(tenantId: string, recordedById: string, dto: RecordTankDipDto) {
    if (!Number.isFinite(dto.litersOnHand) || dto.litersOnHand < 0) {
      throw new BadRequestException('Liters on hand must be a non-negative number.');
    }
    return this.prisma.tankDip.create({
      data: {
        tenantId,
        branchId:       dto.branchId,
        fuelGrade:      dto.fuelGrade,
        recordedAt:     new Date(dto.recordedAt),
        kind:           dto.kind,
        litersOnHand:   new Prisma.Decimal(dto.litersOnHand),
        deliveryLiters: dto.deliveryLiters != null ? new Prisma.Decimal(dto.deliveryLiters) : null,
        notes:          dto.notes,
        recordedById,
      },
    });
  }

  /**
   * Tank-dip variance — for each (branch, fuelGrade, day) within the window,
   * computes:
   *
   *   expected = morning dip + sum(deliveries) − sum(meter-derived sales for the day)
   *   actual   = evening dip
   *   variance = actual − expected
   *
   * Positive variance = more on hand than expected (overstatement / sale not
   * rung). Negative = shrinkage / leak / theft. Owner's "early warning" signal.
   */
  async getTankVariance(
    tenantId: string,
    opts: { branchId?: string; from: Date; to: Date },
  ): Promise<Array<{
    branchId:        string;
    fuelGrade:       FuelGrade;
    date:            string;
    morningLiters:   number | null;
    eveningLiters:   number | null;
    deliveryLiters:  number;
    soldLiters:      number;
    expectedEvening: number | null;
    varianceLiters:  number | null;
  }>> {
    // Pull all dips + dispenses in the window in two queries; aggregate in JS.
    const where = { tenantId, ...(opts.branchId ? { branchId: opts.branchId } : {}) };
    const dips = await this.prisma.tankDip.findMany({
      where: { ...where, recordedAt: { gte: opts.from, lte: opts.to } },
      orderBy: { recordedAt: 'asc' },
    });
    const dispenses = await this.prisma.fuelDispense.findMany({
      where: {
        pump: where,
        status: 'COMPLETED',
        endedAt: { gte: opts.from, lte: opts.to },
      },
      select: {
        litersDispensed: true,
        endedAt:         true,
        pump:            { select: { branchId: true, fuelGrade: true } },
      },
    });

    // Group by branch + grade + date.
    const key = (b: string, g: FuelGrade, d: string) => `${b}|${g}|${d}`;
    const ymd = (date: Date): string => date.toISOString().slice(0, 10);

    interface Row {
      morningLiters:  number | null;
      eveningLiters:  number | null;
      deliveryLiters: number;
      soldLiters:     number;
    }
    const map = new Map<string, Row & { branchId: string; fuelGrade: FuelGrade; date: string }>();
    const ensure = (b: string, g: FuelGrade, d: string) => {
      const k = key(b, g, d);
      if (!map.has(k)) {
        map.set(k, {
          branchId: b, fuelGrade: g, date: d,
          morningLiters: null, eveningLiters: null,
          deliveryLiters: 0, soldLiters: 0,
        });
      }
      return map.get(k)!;
    };

    for (const dip of dips) {
      const r = ensure(dip.branchId, dip.fuelGrade, ymd(dip.recordedAt));
      const liters = Number(dip.litersOnHand);
      if (dip.kind === 'MORNING')  r.morningLiters = liters;
      if (dip.kind === 'EVENING')  r.eveningLiters = liters;
      if (dip.deliveryLiters != null) r.deliveryLiters += Number(dip.deliveryLiters);
    }
    for (const d of dispenses) {
      if (!d.endedAt || d.litersDispensed == null) continue;
      const r = ensure(d.pump.branchId, d.pump.fuelGrade, ymd(d.endedAt));
      r.soldLiters += Number(d.litersDispensed);
    }

    return Array.from(map.values())
      .map((r) => {
        const expectedEvening = r.morningLiters != null
          ? r.morningLiters + r.deliveryLiters - r.soldLiters
          : null;
        const varianceLiters = expectedEvening != null && r.eveningLiters != null
          ? r.eveningLiters - expectedEvening
          : null;
        return { ...r, expectedEvening, varianceLiters };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.branchId.localeCompare(b.branchId));
  }

  /**
   * Daily reconciliation — sum of cash collected (from Orders linked to a
   * dispense) vs sum of meter-derived totals. They should match exactly when
   * every dispense was tendered; mismatch flags an un-rung pump fill.
   */
  async getDailyReconciliation(
    tenantId: string,
    opts: { branchId?: string; from: Date; to: Date },
  ): Promise<Array<{
    branchId:           string;
    date:               string;
    dispenseCount:      number;
    completedCount:     number;
    voidedCount:        number;
    meterTotalCents:    number;
    cashCollectedCents: number;
    unrungLitersValueCents: number;
  }>> {
    const dispenses = await this.prisma.fuelDispense.findMany({
      where: {
        pump: { tenantId, ...(opts.branchId ? { branchId: opts.branchId } : {}) },
        startedAt: { gte: opts.from, lte: opts.to },
      },
      select: {
        status:     true,
        startedAt:  true,
        totalCents: true,
        orderId:    true,
        pump:       { select: { branchId: true } },
      },
    });
    // FuelDispense → Order is a scalar back-pointer (no Prisma relation
    // because Order.id was set up before fuel landed). Fetch the linked
    // Orders in a single follow-up query, then index by id.
    const orderIds = dispenses.map((d) => d.orderId).filter((id): id is string => !!id);
    const orders = orderIds.length > 0
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, totalAmount: true },
        })
      : [];
    const orderTotalByOrderId = new Map(
      orders.map((o) => [o.id, Number(o.totalAmount)]),
    );
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const key = (b: string, d: string) => `${b}|${d}`;
    interface Row {
      branchId:           string;
      date:               string;
      dispenseCount:      number;
      completedCount:     number;
      voidedCount:        number;
      meterTotalCents:    number;
      cashCollectedCents: number;
      unrungLitersValueCents: number;
    }
    const map = new Map<string, Row>();
    for (const d of dispenses) {
      const k = key(d.pump.branchId, ymd(d.startedAt));
      const r = map.get(k) ?? {
        branchId: d.pump.branchId, date: ymd(d.startedAt),
        dispenseCount: 0, completedCount: 0, voidedCount: 0,
        meterTotalCents: 0, cashCollectedCents: 0, unrungLitersValueCents: 0,
      };
      r.dispenseCount += 1;
      if (d.status === 'COMPLETED') r.completedCount += 1;
      if (d.status === 'VOIDED')    r.voidedCount    += 1;
      if (d.status === 'COMPLETED' && d.totalCents != null) {
        r.meterTotalCents += d.totalCents;
        const orderTotal = d.orderId ? orderTotalByOrderId.get(d.orderId) : undefined;
        if (orderTotal != null) {
          r.cashCollectedCents += Math.round(orderTotal * 100);
        } else {
          // Completed but no order linked → un-rung sale. Flag it.
          r.unrungLitersValueCents += d.totalCents;
        }
      }
      map.set(k, r);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async listTankDips(tenantId: string, opts: { branchId?: string; from?: Date; to?: Date } = {}) {
    return this.prisma.tankDip.findMany({
      where: {
        tenantId,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        ...(opts.from || opts.to
          ? { recordedAt: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to   ? { lte: opts.to   } : {}),
              } }
          : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: 200,
      include: { recordedBy: { select: { id: true, name: true } } },
    });
  }
}
