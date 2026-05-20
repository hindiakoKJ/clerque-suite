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
  currentMeter?: number;
  sortOrder?:    number;
}

export interface UpdatePumpDto {
  label?:        string;
  fuelGrade?:    FuelGrade;
  productId?:    string;
  currentMeter?: number;
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
