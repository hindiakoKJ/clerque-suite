import {
  Injectable, BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, TripStatus, FleetAssetKind, PMScheduleType } from '@prisma/client';

/**
 * Logistics-Engine — Trucking.
 *
 * Surfaces:
 *  1. **FleetAsset** — vehicle master (truck/trailer/van) with mileage.
 *  2. **PMSchedule** — preventive maintenance per asset (oil, tires, etc.).
 *  3. **TripTicket** — driver/asset/route/cashAdvance lifecycle:
 *     DRAFT → DISPATCHED → IN_TRANSIT → DELIVERED → LIQUIDATED.
 *  4. **LiquidationItem** — receipts uploaded against a trip's cash advance.
 *
 * Trip-status transitions are validated server-side. Liquidation variance is
 * computed on-the-fly (cashAdvance - receiptsTotal). When liquidatedAt is
 * stamped, the AccountingEvent → JE engine handles the GL impact (Dr Driver
 * Expense / Cr Cash Advance) — vertical code never posts journal entries.
 */
@Injectable()
export class TruckingService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Fleet assets ──────────────────────────────────────────────────────────

  async createAsset(tenantId: string, dto: CreateFleetAssetDto) {
    if (!dto.plateNumber?.trim()) {
      throw new BadRequestException('plateNumber is required.');
    }

    // Tenant-unique plate guard (also enforced by DB unique index).
    const existing = await this.prisma.fleetAsset.findFirst({
      where: { tenantId, plateNumber: dto.plateNumber.trim() },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Plate ${dto.plateNumber} already exists for this tenant.`);
    }

    return this.prisma.fleetAsset.create({
      data: {
        tenantId,
        branchId:        dto.branchId ?? null,
        kind:            dto.kind,
        plateNumber:     dto.plateNumber.trim(),
        bodyNumber:      dto.bodyNumber ?? null,
        engineNumber:    dto.engineNumber ?? null,
        chassisNumber:   dto.chassisNumber ?? null,
        yearModel:       dto.yearModel ?? null,
        mileageKm:       dto.mileageKm ?? 0,
        primaryDriverId: dto.primaryDriverId ?? null,
        notes:           dto.notes ?? null,
      },
    });
  }

  listAssets(tenantId: string, q: { branchId?: string; activeOnly?: boolean } = {}) {
    const where: Prisma.FleetAssetWhereInput = { tenantId };
    if (q.branchId)   where.branchId = q.branchId;
    if (q.activeOnly) where.isActive = true;
    return this.prisma.fleetAsset.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { plateNumber: 'asc' }],
      include: {
        primaryDriver: { select: { id: true, name: true } },
        branch:        { select: { id: true, name: true } },
      },
    });
  }

  async getAsset(tenantId: string, id: string) {
    const asset = await this.prisma.fleetAsset.findFirst({
      where: { id, tenantId },
      include: {
        primaryDriver: { select: { id: true, name: true } },
        branch:        { select: { id: true, name: true } },
        pmSchedules:   { orderBy: { nextDueAt: 'asc' } },
        tireSerials:   { orderBy: { position: 'asc' } },
      },
    });
    if (!asset) throw new NotFoundException('Fleet asset not found.');
    return asset;
  }

  async updateAsset(tenantId: string, id: string, dto: Partial<CreateFleetAssetDto> & { isActive?: boolean }) {
    const result = await this.prisma.fleetAsset.updateMany({
      where: { id, tenantId },
      data:  this.cleanUndefined({
        branchId:        dto.branchId,
        kind:            dto.kind,
        bodyNumber:      dto.bodyNumber,
        engineNumber:    dto.engineNumber,
        chassisNumber:   dto.chassisNumber,
        yearModel:       dto.yearModel,
        mileageKm:       dto.mileageKm,
        primaryDriverId: dto.primaryDriverId,
        isActive:        dto.isActive,
        notes:           dto.notes,
      }),
    });
    if (result.count === 0) throw new NotFoundException('Fleet asset not found.');
    return this.getAsset(tenantId, id);
  }

  // ─── PM schedules ─────────────────────────────────────────────────────────

  async createPmSchedule(tenantId: string, dto: CreatePmScheduleDto) {
    const asset = await this.prisma.fleetAsset.findFirst({
      where:  { id: dto.fleetAssetId, tenantId },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('Fleet asset not found.');

    return this.prisma.pMSchedule.create({
      data: {
        tenantId,
        fleetAssetId:       dto.fleetAssetId,
        type:               dto.type,
        customLabel:        dto.customLabel ?? null,
        intervalKm:         dto.intervalKm ?? null,
        intervalDays:       dto.intervalDays ?? null,
        lastDoneAt:         dto.lastDoneAt        ? new Date(dto.lastDoneAt) : null,
        lastDoneMileageKm:  dto.lastDoneMileageKm ?? null,
        nextDueAt:          dto.nextDueAt         ? new Date(dto.nextDueAt) : null,
        nextDueMileageKm:   dto.nextDueMileageKm  ?? null,
        lastCost:           dto.lastCost as any,
        notes:              dto.notes ?? null,
      },
    });
  }

  listDuePm(tenantId: string, withinDays = 14) {
    const cutoff = new Date(Date.now() + withinDays * 86_400_000);
    return this.prisma.pMSchedule.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { nextDueAt: { lte: cutoff } },
          // Note: nextDueMileageKm comparison requires asset.mileageKm context;
          // returned as-is, frontend can flag any pmSchedule whose
          // (nextDueMileageKm - asset.mileageKm) <= some threshold.
        ],
      },
      orderBy: { nextDueAt: 'asc' },
      include: {
        fleetAsset: { select: { id: true, plateNumber: true, mileageKm: true } },
      },
    });
  }

  // ─── Trip tickets ─────────────────────────────────────────────────────────

  async createTrip(tenantId: string, createdByUserId: string, dto: CreateTripDto) {
    if (!dto.fleetAssetId || !dto.driverId || !dto.branchId) {
      throw new BadRequestException('branchId, fleetAssetId, driverId are required.');
    }
    if (Number(dto.freightAmount) <= 0) {
      throw new BadRequestException('freightAmount must be > 0.');
    }
    if (dto.cashAdvance != null && Number(dto.cashAdvance) < 0) {
      throw new BadRequestException('cashAdvance cannot be negative.');
    }

    // Tenant-scope guards on relations.
    const [asset, driver, branch] = await Promise.all([
      this.prisma.fleetAsset.findFirst({ where: { id: dto.fleetAssetId, tenantId, isActive: true }, select: { id: true } }),
      this.prisma.user.findFirst({       where: { id: dto.driverId,     tenantId, isActive: true }, select: { id: true } }),
      this.prisma.branch.findFirst({     where: { id: dto.branchId,     tenantId },                  select: { id: true } }),
    ]);
    if (!asset)  throw new NotFoundException('Fleet asset not found or inactive.');
    if (!driver) throw new NotFoundException('Driver not found or inactive.');
    if (!branch) throw new NotFoundException('Branch not found.');

    if (dto.helperId) {
      const helper = await this.prisma.user.findFirst({
        where: { id: dto.helperId, tenantId, isActive: true }, select: { id: true },
      });
      if (!helper) throw new NotFoundException('Helper not found.');
    }

    // Trip number generation: TRIP-YYYY-{6-digit-seq per tenant per year}.
    const year   = new Date().getFullYear();
    const prefix = `TRIP-${year}-`;
    const last   = await this.prisma.tripTicket.findFirst({
      where:   { tenantId, tripNumber: { startsWith: prefix } },
      orderBy: { tripNumber: 'desc' },
      select:  { tripNumber: true },
    });
    const lastSeq = last ? Number(last.tripNumber.slice(prefix.length)) || 0 : 0;
    const tripNumber = `${prefix}${String(lastSeq + 1).padStart(6, '0')}`;

    const cashAdvance = Number(dto.cashAdvance ?? 0);

    // Atomic: create the trip + queue the cash-advance accounting event so
    // the kernel JE engine posts DR 1034 / CR 1010 once a handler ships.
    // Until the handler exists, the event is marked SYNCED no-op by the
    // cron's default branch (same pattern as MATERIAL_ISSUANCE today).
    return this.prisma.$transaction(async (tx) => {
      const trip = await tx.tripTicket.create({
        data: {
          tenantId,
          branchId:         dto.branchId,
          tripNumber,
          status:           'DRAFT',
          customerId:       dto.customerId ?? null,
          fleetAssetId:     dto.fleetAssetId,
          driverId:         dto.driverId,
          helperId:         dto.helperId ?? null,
          originLabel:      dto.originLabel,
          destinationLabel: dto.destinationLabel,
          cargoDescription: dto.cargoDescription ?? null,
          cargoWeightKg:    (dto.cargoWeightKg ?? null) as any,
          freightAmount:    dto.freightAmount as any,
          cashAdvance:      cashAdvance as any,
          notes:            dto.notes ?? null,
        },
      });

      if (cashAdvance > 0) {
        await tx.accountingEvent.create({
          data: {
            tenantId,
            type:    'TRIP_CASH_ADVANCE',
            status:  'PENDING',
            payload: {
              tripId:     trip.id,
              tripNumber: trip.tripNumber,
              driverId:   dto.driverId,
              branchId:   dto.branchId,
              amount:     cashAdvance,
              issuedAt:   new Date().toISOString(),
            },
          },
        });
      }

      return trip;
    });
  }

  /**
   * Status-machine transitions. Each transition validates the prior state and
   * stamps the corresponding timestamp.
   */
  async setTripStatus(
    tenantId: string,
    tripId: string,
    targetStatus: TripStatus,
    actingUserId: string,
  ) {
    const trip = await this.prisma.tripTicket.findFirst({
      where:  { id: tripId, tenantId },
    });
    if (!trip) throw new NotFoundException('Trip not found.');

    // Allowed transitions.
    const allowed: Record<TripStatus, TripStatus[]> = {
      DRAFT:       ['DISPATCHED', 'CANCELLED'],
      DISPATCHED:  ['IN_TRANSIT', 'CANCELLED'],
      IN_TRANSIT:  ['DELIVERED', 'RETURNED', 'CANCELLED'],
      DELIVERED:   ['LIQUIDATED'],
      RETURNED:    ['LIQUIDATED'],
      LIQUIDATED:  [],
      CANCELLED:   [],
    };

    if (!allowed[trip.status].includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot move trip from ${trip.status} to ${targetStatus}.`,
      );
    }

    const now = new Date();
    const data: Prisma.TripTicketUpdateInput = { status: targetStatus };
    if (targetStatus === 'DISPATCHED' && !trip.dispatchedAt)  data.dispatchedAt = now;
    if (targetStatus === 'DELIVERED'  && !trip.deliveredAt)   data.deliveredAt  = now;

    // For LIQUIDATED: stamp the timestamps + compute variance + emit
    // TRIP_LIQUIDATION accounting event (atomically, in a single transaction
    // so a partial failure can't leave the trip liquidated without a JE-able
    // event row, or vice-versa). Variance > 0  → driver returns leftover cash.
    // Variance < 0  → driver overspent; carried on 1034 Advances to Employees
    // as a non-zero balance to force investigation.
    if (targetStatus === 'LIQUIDATED' && !trip.liquidatedAt) {
      const cashAdv       = Number(trip.cashAdvance);
      const receiptsTotal = Number(trip.receiptsTotal);
      const variance      = cashAdv - receiptsTotal;

      data.liquidatedAt        = now;
      data.liquidatedBy        = { connect: { id: actingUserId } };
      data.liquidationVariance = variance as any;

      // Per-category breakdown for the JE handler to expense each category
      // line (FUEL→6080, TOLL→6100, etc.). Aggregate at emit time so the
      // payload is self-contained.
      const liquidationLines = await this.prisma.liquidationItem.findMany({
        where:   { tripTicketId: tripId, tenantId },
        select:  { category: true, amount: true },
      });
      const categoryBreakdown = liquidationLines.reduce<Record<string, number>>((acc, line) => {
        const cat = (line.category || 'OTHER').toUpperCase();
        acc[cat] = (acc[cat] ?? 0) + Number(line.amount);
        return acc;
      }, {});

      return this.prisma.$transaction(async (tx) => {
        await tx.tripTicket.update({ where: { id: tripId }, data });
        await tx.accountingEvent.create({
          data: {
            tenantId,
            type:    'TRIP_LIQUIDATION',
            status:  'PENDING',
            payload: {
              tripId:           trip.id,
              tripNumber:       trip.tripNumber,
              driverId:         trip.driverId,
              branchId:         trip.branchId,
              cashAdvance:      cashAdv,
              receiptsTotal,
              variance,
              categoryBreakdown,
              liquidatedAt:     now.toISOString(),
              liquidatedById:   actingUserId,
            },
          },
        });
        return this.getTrip(tenantId, tripId);
      });
    }

    await this.prisma.tripTicket.update({ where: { id: tripId }, data });
    return this.getTrip(tenantId, tripId);
  }

  async addLiquidationItem(tenantId: string, tripId: string, dto: AddLiquidationItemDto) {
    const trip = await this.prisma.tripTicket.findFirst({
      where: { id: tripId, tenantId },
      select: { id: true, status: true },
    });
    if (!trip) throw new NotFoundException('Trip not found.');
    if (trip.status === 'LIQUIDATED' || trip.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot add liquidation items to a ${trip.status} trip.`);
    }
    if (Number(dto.amount) <= 0) {
      throw new BadRequestException('amount must be > 0.');
    }
    if (!dto.category?.trim()) {
      throw new BadRequestException('category is required (FUEL, TOLL, MEALS, REPAIR, OTHER, …).');
    }

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.liquidationItem.create({
        data: {
          tenantId,
          tripTicketId:    tripId,
          category:        dto.category.trim().toUpperCase(),
          amount:          dto.amount as any,
          receiptImageUrl: dto.receiptImageUrl ?? null,
          description:     dto.description ?? null,
        },
      });
      await tx.tripTicket.update({
        where: { id: tripId },
        data:  { receiptsTotal: { increment: dto.amount as any } },
      });
      return item;
    });
  }

  async getTrip(tenantId: string, id: string) {
    const trip = await this.prisma.tripTicket.findFirst({
      where: { id, tenantId },
      include: {
        fleetAsset: { select: { id: true, plateNumber: true, kind: true, mileageKm: true } },
        driver:     { select: { id: true, name: true } },
        helper:     { select: { id: true, name: true } },
        customer:   { select: { id: true, name: true } },
        branch:     { select: { id: true, name: true } },
        liquidation: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!trip) throw new NotFoundException('Trip not found.');
    return trip;
  }

  listTrips(tenantId: string, q: ListTripsQuery = {}) {
    const where: Prisma.TripTicketWhereInput = { tenantId };
    if (q.status)   where.status   = q.status;
    if (q.branchId) where.branchId = q.branchId;
    if (q.driverId) where.driverId = q.driverId;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as any).gte = new Date(q.from);
      if (q.to)   (where.createdAt as any).lte = new Date(q.to);
    }
    return this.prisma.tripTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.take ? Math.min(q.take, 200) : 50,
      skip: q.skip ?? 0,
      include: {
        fleetAsset: { select: { plateNumber: true } },
        driver:     { select: { id: true, name: true } },
      },
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private cleanUndefined<T extends object>(obj: T): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = v;
    }
    return out as Partial<T>;
  }
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateFleetAssetDto {
  branchId?:        string;
  kind:             FleetAssetKind;
  plateNumber:      string;
  bodyNumber?:      string;
  engineNumber?:    string;
  chassisNumber?:   string;
  yearModel?:       number;
  mileageKm?:       number;
  primaryDriverId?: string;
  notes?:           string;
}

export interface CreatePmScheduleDto {
  fleetAssetId:       string;
  type:               PMScheduleType;
  customLabel?:       string;
  intervalKm?:        number;
  intervalDays?:      number;
  lastDoneAt?:        string;
  lastDoneMileageKm?: number;
  nextDueAt?:         string;
  nextDueMileageKm?:  number;
  lastCost?:          number | string;
  notes?:             string;
}

export interface CreateTripDto {
  branchId:         string;
  customerId?:      string;
  fleetAssetId:     string;
  driverId:         string;
  helperId?:        string;
  originLabel:      string;
  destinationLabel: string;
  cargoDescription?: string;
  cargoWeightKg?:   number | string;
  freightAmount:    number | string;
  cashAdvance?:     number | string;
  notes?:           string;
}

export interface AddLiquidationItemDto {
  category:         string;
  amount:           number | string;
  receiptImageUrl?: string;
  description?:     string;
}

export interface ListTripsQuery {
  status?:   TripStatus;
  branchId?: string;
  driverId?: string;
  from?:     string;
  to?:       string;
  take?:     number;
  skip?:     number;
}
