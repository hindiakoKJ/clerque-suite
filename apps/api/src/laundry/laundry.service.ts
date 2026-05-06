import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LaundryServiceType, LaundryPricingMode, LaundryOrderStatus, BusinessType, Prisma,
} from '@prisma/client';

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateLaundryItemDto {
  garmentType: string;
  quantity?:   number;
  condition?:  string;
  tagNumber?:  string;
}

export interface CreateLaundryOrderDto {
  branchId:    string;
  customerId?: string;
  serviceType: LaundryServiceType;
  pricingMode: LaundryPricingMode;
  weightKg?:   number;
  loadCount?:  number;
  pieceCount?: number;
  unitPrice:   number;
  promisedAt?: string; // ISO
  notes?:      string;
  items?:      CreateLaundryItemDto[];
}

export interface UpdateStatusDto {
  status: LaundryOrderStatus;
}

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class LaundryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Guard: tenants must be BusinessType.LAUNDRY to use laundry endpoints.
   * Cheap pre-check before doing any real work.
   */
  private async assertLaundryTenant(tenantId: string): Promise<void> {
    const t = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { businessType: true },
    });
    if (!t) throw new NotFoundException('Tenant not found.');
    if (t.businessType !== BusinessType.LAUNDRY) {
      throw new ForbiddenException('Laundry endpoints are only available for LAUNDRY-type tenants.');
    }
  }

  /**
   * Generates the next claim number for the year, scoped per-tenant.
   * Format: CLA-{YYYY}-{6-digit-seq}
   * Race-safe: uses a SELECT-MAX inside a transaction caller wraps.
   */
  private async nextClaimNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `CLA-${year}-`;
    const last = await tx.laundryOrder.findFirst({
      where:   { tenantId, claimNumber: { startsWith: prefix } },
      orderBy: { claimNumber: 'desc' },
      select:  { claimNumber: true },
    });
    const lastSeq = last ? parseInt(last.claimNumber.slice(prefix.length), 10) : 0;
    const next = String(lastSeq + 1).padStart(6, '0');
    return `${prefix}${next}`;
  }

  /** Validates pricingMode → required quantity field combination. */
  private computeTotal(dto: CreateLaundryOrderDto): { quantity: number; total: number } {
    const unit = Number(dto.unitPrice);
    if (!isFinite(unit) || unit < 0) {
      throw new BadRequestException('unitPrice must be a non-negative number.');
    }
    let quantity = 0;
    switch (dto.pricingMode) {
      case 'PER_KG':
        if (!dto.weightKg || dto.weightKg <= 0) {
          throw new BadRequestException('weightKg is required for PER_KG pricing.');
        }
        quantity = Number(dto.weightKg);
        break;
      case 'PER_LOAD':
        if (!dto.loadCount || dto.loadCount <= 0) {
          throw new BadRequestException('loadCount is required for PER_LOAD pricing.');
        }
        quantity = dto.loadCount;
        break;
      case 'PER_PIECE':
      case 'PER_GARMENT':
        if (!dto.pieceCount || dto.pieceCount <= 0) {
          throw new BadRequestException('pieceCount is required for PER_PIECE / PER_GARMENT pricing.');
        }
        quantity = dto.pieceCount;
        break;
    }
    return { quantity, total: Math.round(quantity * unit * 100) / 100 };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async createOrder(tenantId: string, userId: string, dto: CreateLaundryOrderDto) {
    await this.assertLaundryTenant(tenantId);
    const { total } = this.computeTotal(dto);

    return this.prisma.$transaction(async (tx) => {
      // Validate branch
      const branch = await tx.branch.findFirst({
        where:  { id: dto.branchId, tenantId },
        select: { id: true },
      });
      if (!branch) throw new BadRequestException('Branch not found in this tenant.');

      const claimNumber = await this.nextClaimNumber(tx, tenantId);

      const order = await tx.laundryOrder.create({
        data: {
          tenantId,
          branchId:    dto.branchId,
          customerId:  dto.customerId ?? null,
          claimNumber,
          status:      'RECEIVED',
          serviceType: dto.serviceType,
          pricingMode: dto.pricingMode,
          weightKg:    dto.weightKg ? new Prisma.Decimal(dto.weightKg) : null,
          loadCount:   dto.loadCount ?? null,
          pieceCount:  dto.pieceCount ?? null,
          unitPrice:   new Prisma.Decimal(dto.unitPrice),
          totalAmount: new Prisma.Decimal(total),
          promisedAt:  dto.promisedAt ? new Date(dto.promisedAt) : null,
          notes:       dto.notes ?? null,
          intakeBy:    userId,
          items: dto.items?.length
            ? { create: dto.items.map((i) => ({
                garmentType: i.garmentType,
                quantity:    i.quantity ?? 1,
                condition:   i.condition ?? null,
                tagNumber:   i.tagNumber ?? null,
              })) }
            : undefined,
        },
        include: { items: true, customer: { select: { id: true, name: true, contactPhone: true } } },
      });

      return order;
    });
  }

  async listActive(tenantId: string, branchId?: string) {
    await this.assertLaundryTenant(tenantId);
    return this.prisma.laundryOrder.findMany({
      where: {
        tenantId,
        branchId: branchId || undefined,
        status:   { not: 'CLAIMED' },
      },
      orderBy: { receivedAt: 'desc' },
      include: {
        items:    true,
        customer: { select: { id: true, name: true, contactPhone: true } },
        branch:   { select: { id: true, name: true } },
      },
    });
  }

  async getOne(tenantId: string, id: string) {
    await this.assertLaundryTenant(tenantId);
    const order = await this.prisma.laundryOrder.findFirst({
      where: { id, tenantId },
      include: {
        items:    true,
        customer: { select: { id: true, name: true, contactPhone: true, address: true } },
        branch:   { select: { id: true, name: true } },
        order:    { select: { id: true, orderNumber: true, totalAmount: true } },
      },
    });
    if (!order) throw new NotFoundException('Laundry order not found.');
    return order;
  }

  /**
   * Advances the workflow status. Allowed transitions:
   *   RECEIVED → WASHING → DRYING → FOLDING → READY_FOR_PICKUP → CLAIMED
   * Skipping forward is allowed; backward transitions are not (ops decision —
   * keeps audit trail clean). CANCELLED can be set from any pre-CLAIMED state.
   * CLAIMED cannot be set via this endpoint — use claim() to link a POS Order.
   */
  async updateStatus(tenantId: string, id: string, status: LaundryOrderStatus) {
    await this.assertLaundryTenant(tenantId);
    const order = await this.prisma.laundryOrder.findFirst({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Laundry order not found.');
    if (order.status === 'CLAIMED') {
      throw new BadRequestException('Already CLAIMED — cannot revert.');
    }
    if (status === 'CLAIMED') {
      throw new BadRequestException('Use the claim endpoint to mark CLAIMED (creates POS Order).');
    }

    const flow: LaundryOrderStatus[] = ['RECEIVED', 'WASHING', 'DRYING', 'FOLDING', 'READY_FOR_PICKUP'];
    const fromIdx = flow.indexOf(order.status);
    const toIdx   = flow.indexOf(status);
    if (status !== 'CANCELLED' && toIdx >= 0 && fromIdx >= 0 && toIdx < fromIdx) {
      throw new BadRequestException(`Cannot move from ${order.status} back to ${status}.`);
    }

    return this.prisma.laundryOrder.update({
      where: { id },
      data: {
        status,
        readyAt: status === 'READY_FOR_PICKUP' && !order.readyAt ? new Date() : undefined,
      },
      include: { items: true },
    });
  }

  /**
   * Marks a laundry order CLAIMED. The actual POS Order (with payment + OR)
   * is created by the POS terminal flow; this endpoint just links the two.
   */
  async claim(tenantId: string, id: string, userId: string, posOrderId: string) {
    await this.assertLaundryTenant(tenantId);
    const order = await this.prisma.laundryOrder.findFirst({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Laundry order not found.');
    if (order.status === 'CLAIMED') throw new BadRequestException('Already claimed.');
    if (order.status === 'CANCELLED') throw new BadRequestException('Cannot claim a cancelled order.');

    return this.prisma.laundryOrder.update({
      where: { id },
      data: {
        status:     'CLAIMED',
        claimedAt:  new Date(),
        releasedBy: userId,
        orderId:    posOrderId,
      },
      include: { items: true, order: { select: { id: true, orderNumber: true, totalAmount: true } } },
    });
  }
}
