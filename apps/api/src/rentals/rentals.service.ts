/**
 * Clerque API — RentalsService (DME / Medical Equipment)
 *
 * Lifecycle:
 *   - createSerializedUnit  → inventory IN_STOCK
 *   - openRental             → unit ON_RENT, status OPEN, deposit captured
 *   - returnRental           → unit IN_STOCK, status RETURNED, refund computed
 *   - markOverdue (cron)     → dueAt < now() && status=OPEN  →  status=OVERDUE
 *   - markLost               → unit RETIRED, status=LOST, deposit forfeited
 *
 * Deposit + return are NOT integrated into OrdersService yet — the V1 flow
 * is: capture a deposit on Counter as a regular Cash/GCash sale (Order with
 * a single "Wheelchair deposit" service line), then OPEN the rental linked
 * back to that Order via `depositOrderId`. Same pattern for return + damage
 * fee. V2 will fold this into a first-class rental cart line type.
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, RentalStatus, SerializedUnitStatus } from '@prisma/client';

export interface CreateSerializedUnitDto {
  branchId:       string;
  productId:      string;
  serialNumber:   string;
  acquiredCost?:  number;
  conditionNotes?: string;
}

export interface OpenRentalDto {
  branchId:         string;
  customerId:       string;
  serializedUnitId: string;
  rentalRate:       number;
  rateUnit:         'day' | 'week' | 'month';
  depositCents:     number;
  dueAt:            string;       // ISO
  intakeNotes?:     string;
  depositOrderId?:  string;       // optional link to the Order ringing the deposit
}

export interface ReturnRentalDto {
  damageFeeCents?: number;
  returnNotes?:    string;
  /// When set, links the receipt Order rung for the damage fee (if any).
  returnOrderId?:  string;
}

@Injectable()
export class RentalsService {
  constructor(private prisma: PrismaService) {}

  // ─── Serialized units (inventory of trackable equipment) ────────────────

  async listUnits(tenantId: string, opts: { branchId?: string; status?: SerializedUnitStatus } = {}) {
    return this.prisma.serializedUnit.findMany({
      where: {
        tenantId,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      include: {
        product: { select: { id: true, name: true, sku: true, price: true } },
        branch:  { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { serialNumber: 'asc' }],
    });
  }

  async createUnit(tenantId: string, dto: CreateSerializedUnitDto) {
    // Tenant-scope the product to prevent cross-tenant smuggling.
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Product not found.');
    if (!dto.serialNumber?.trim()) throw new BadRequestException('Serial number is required.');

    try {
      return await this.prisma.serializedUnit.create({
        data: {
          tenantId,
          branchId:       dto.branchId,
          productId:      dto.productId,
          serialNumber:   dto.serialNumber.trim(),
          acquiredCost:   dto.acquiredCost != null ? new Prisma.Decimal(dto.acquiredCost) : null,
          conditionNotes: dto.conditionNotes,
        },
        include: { product: { select: { id: true, name: true, sku: true } } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Serial number "${dto.serialNumber}" already exists for this tenant.`);
      }
      throw err;
    }
  }

  // ─── Rental agreements ───────────────────────────────────────────────────

  async listRentals(tenantId: string, opts: { branchId?: string; status?: RentalStatus[] } = {}) {
    return this.prisma.rentalAgreement.findMany({
      where: {
        tenantId,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        ...(opts.status?.length ? { status: { in: opts.status } } : {}),
      },
      include: {
        customer:       { select: { id: true, name: true, contactPhone: true } },
        serializedUnit: {
          select: { id: true, serialNumber: true, product: { select: { id: true, name: true } } },
        },
        createdBy:      { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: 200,
    });
  }

  async openRental(tenantId: string, createdById: string, dto: OpenRentalDto) {
    // Verify the unit is in stock + belongs to this tenant.
    const unit = await this.prisma.serializedUnit.findFirst({
      where: { id: dto.serializedUnitId, tenantId },
    });
    if (!unit) throw new BadRequestException('Serialized unit not found.');
    if (unit.status !== 'IN_STOCK') {
      throw new ConflictException(`Unit is currently ${unit.status}, cannot rent out.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const rental = await tx.rentalAgreement.create({
        data: {
          tenantId,
          branchId:         dto.branchId,
          customerId:       dto.customerId,
          serializedUnitId: dto.serializedUnitId,
          createdById,
          rentalRate:       new Prisma.Decimal(dto.rentalRate),
          rateUnit:         dto.rateUnit,
          depositCents:     dto.depositCents,
          dueAt:            new Date(dto.dueAt),
          intakeNotes:      dto.intakeNotes,
          depositOrderId:   dto.depositOrderId,
          status:           dto.depositCents > 0 && !dto.depositOrderId ? 'OPEN' : 'OPEN',
        },
        include: { serializedUnit: true },
      });
      await tx.serializedUnit.update({
        where: { id: dto.serializedUnitId },
        data: { status: 'ON_RENT', currentRentalId: rental.id },
      });
      return rental;
    });
  }

  async returnRental(tenantId: string, rentalId: string, dto: ReturnRentalDto) {
    const rental = await this.prisma.rentalAgreement.findFirst({
      where: { id: rentalId, tenantId },
    });
    if (!rental) throw new NotFoundException('Rental not found.');
    if (rental.status !== 'OPEN' && rental.status !== 'OVERDUE') {
      throw new ConflictException(`Cannot return a rental that is ${rental.status}.`);
    }

    const damageFee  = Math.max(0, dto.damageFeeCents ?? 0);
    const refundable = Math.max(0, rental.depositCents - damageFee);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.rentalAgreement.update({
        where: { id: rentalId },
        data: {
          status:         'RETURNED',
          returnedAt:     new Date(),
          damageFeeCents: damageFee,
          refundCents:    refundable,
          returnNotes:    dto.returnNotes,
          returnOrderId:  dto.returnOrderId,
        },
      });
      await tx.serializedUnit.update({
        where: { id: rental.serializedUnitId },
        data: { status: 'IN_STOCK', currentRentalId: null },
      });
      return updated;
    });
  }

  async markLost(tenantId: string, rentalId: string) {
    const rental = await this.prisma.rentalAgreement.findFirst({
      where: { id: rentalId, tenantId },
    });
    if (!rental) throw new NotFoundException('Rental not found.');
    return this.prisma.$transaction(async (tx) => {
      await tx.serializedUnit.update({
        where: { id: rental.serializedUnitId },
        data: { status: 'RETIRED', currentRentalId: null },
      });
      return tx.rentalAgreement.update({
        where: { id: rentalId },
        data: { status: 'LOST', refundCents: 0 },
      });
    });
  }

  /**
   * Cron-callable: flag OPEN rentals whose dueAt has passed as OVERDUE.
   * Owner gets a dashboard count and can chase the customer.
   */
  async markOverdueRentals(tenantId?: string) {
    const where: Prisma.RentalAgreementWhereInput = {
      status: 'OPEN',
      dueAt:  { lt: new Date() },
    };
    if (tenantId) where.tenantId = tenantId;
    const result = await this.prisma.rentalAgreement.updateMany({
      where,
      data: { status: 'OVERDUE' },
    });
    return { flagged: result.count };
  }
}
