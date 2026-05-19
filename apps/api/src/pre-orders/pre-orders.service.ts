/**
 * Clerque API — PreOrdersService
 *
 * Bakery custom-cake reservation flow. The PreOrder header captures the
 * customer's intent + the totals snapshot; the actual cash movement still
 * flows through OrderService — we create a regular Order with kind=DEPOSIT
 * when the deposit is paid, and a second Order on settle that credits
 * the prior deposit.
 *
 * Status lifecycle:
 *   DRAFT → DEPOSIT_PAID → READY → PICKED_UP
 *                                ↓
 *                            CANCELLED (from any state pre-pickup)
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, PreOrderStatus } from '@prisma/client';

export interface PreOrderItemDto {
  productId:        string;
  productName:      string;
  quantity:         number;
  unitPriceCents:   number;
  modifierAddCents?: number;
  notes?:           string;
  modifiers?: Array<{
    modifierGroupId:  string;
    modifierOptionId: string;
    groupName:        string;
    optionName:       string;
    priceAdjustment:  number;
  }>;
}

export interface CreatePreOrderDto {
  branchId:       string;
  customerId?:    string;
  pickupDate:     string;       // ISO date
  pickupTime?:    string;       // "HH:MM"
  inscription?:   string;
  notes?:         string;
  items:          PreOrderItemDto[];
  discountCents?: number;
  depositCents?:  number;       // pesos pre-paid
}

export interface UpdatePreOrderDto {
  customerId?:    string | null;
  pickupDate?:    string;
  pickupTime?:    string | null;
  inscription?:   string | null;
  notes?:         string | null;
  items?:         PreOrderItemDto[];
  discountCents?: number;
  status?:        PreOrderStatus;
}

@Injectable()
export class PreOrdersService {
  constructor(private prisma: PrismaService) {}

  /** Hot path: list pre-orders by pickup date window. The Counter dashboard
   *  pulls today's pickups; the web admin filters by date range. */
  async list(
    tenantId: string,
    opts: {
      branchId?: string;
      from?:     Date;
      to?:       Date;
      status?:   PreOrderStatus[];
    } = {},
  ) {
    const where: Prisma.PreOrderWhereInput = { tenantId };
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.status?.length) where.status = { in: opts.status };
    if (opts.from || opts.to) {
      where.pickupDate = {};
      if (opts.from) where.pickupDate.gte = opts.from;
      if (opts.to)   where.pickupDate.lte = opts.to;
    }
    return this.prisma.preOrder.findMany({
      where,
      include: {
        customer:  { select: { id: true, name: true, contactPhone: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { modifiers: true } },
      },
      orderBy: [{ pickupDate: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async getOne(tenantId: string, id: string) {
    const row = await this.prisma.preOrder.findFirst({
      where: { id, tenantId },
      include: {
        customer:    true,
        createdBy:   { select: { id: true, name: true } },
        items:       { include: { modifiers: true, product: { select: { id: true, name: true } } } },
        depositOrder:{ select: { id: true, orderNumber: true } },
        balanceOrder:{ select: { id: true, orderNumber: true } },
      },
    });
    if (!row) throw new NotFoundException('Pre-order not found');
    return row;
  }

  async create(tenantId: string, createdById: string, dto: CreatePreOrderDto) {
    if (!dto.items?.length) {
      throw new BadRequestException('At least one line item is required.');
    }
    if (!dto.branchId) {
      throw new BadRequestException('branchId is required.');
    }
    // Tenant-scope every productId to prevent cross-tenant smuggling.
    const productIds = [...new Set(dto.items.map(i => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products do not belong to this tenant.');
    }

    const subtotalCents = dto.items.reduce(
      (acc, i) => acc + Math.round(i.quantity * i.unitPriceCents) + (i.modifierAddCents ?? 0),
      0,
    );
    const discountCents = Math.max(0, dto.discountCents ?? 0);
    const totalCents    = Math.max(0, subtotalCents - discountCents);
    const depositCents  = Math.min(Math.max(0, dto.depositCents ?? 0), totalCents);
    const balanceCents  = totalCents - depositCents;

    const preOrderNumber = await this.generateNumber(tenantId);

    return this.prisma.preOrder.create({
      data: {
        tenantId,
        branchId:        dto.branchId,
        customerId:      dto.customerId,
        createdById,
        preOrderNumber,
        status:          'DRAFT',
        pickupDate:      new Date(dto.pickupDate),
        pickupTime:      dto.pickupTime,
        inscription:     dto.inscription,
        notes:           dto.notes,
        subtotalCents,
        discountCents,
        totalCents,
        depositCents,
        balanceCents,
        items: {
          create: dto.items.map(i => ({
            productId:       i.productId,
            productName:     i.productName,
            quantity:        new Prisma.Decimal(i.quantity),
            unitPriceCents:  i.unitPriceCents,
            modifierAddCents:i.modifierAddCents ?? 0,
            lineTotalCents:  Math.round(i.quantity * i.unitPriceCents) + (i.modifierAddCents ?? 0),
            notes:           i.notes,
            modifiers: i.modifiers?.length
              ? {
                  create: i.modifiers.map(m => ({
                    modifierGroupId:  m.modifierGroupId,
                    modifierOptionId: m.modifierOptionId,
                    groupName:        m.groupName,
                    optionName:       m.optionName,
                    priceAdjustment:  new Prisma.Decimal(m.priceAdjustment),
                  })),
                }
              : undefined,
          })),
        },
      },
      include: { items: { include: { modifiers: true } } },
    });
  }

  async update(tenantId: string, id: string, dto: UpdatePreOrderDto) {
    const existing = await this.getOne(tenantId, id);
    if (existing.status === 'PICKED_UP' || existing.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot edit a ${existing.status.toLowerCase()} pre-order.`);
    }

    // Replace items if provided
    if (dto.items) {
      if (!dto.items.length) throw new BadRequestException('Cannot remove every item — cancel the pre-order instead.');
      // Tenant-scope products
      const productIds = [...new Set(dto.items.map(i => i.productId))];
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds }, tenantId },
        select: { id: true },
      });
      if (products.length !== productIds.length) {
        throw new BadRequestException('One or more products do not belong to this tenant.');
      }
    }

    const subtotalCents = dto.items
      ? dto.items.reduce((acc, i) => acc + Math.round(i.quantity * i.unitPriceCents) + (i.modifierAddCents ?? 0), 0)
      : existing.subtotalCents;
    const discountCents = Math.max(0, dto.discountCents ?? existing.discountCents);
    const totalCents    = Math.max(0, subtotalCents - discountCents);
    const balanceCents  = totalCents - existing.depositCents;

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.preOrderItem.deleteMany({ where: { preOrderId: id } });
        await tx.preOrderItem.createMany({
          data: dto.items.map(i => ({
            preOrderId:       id,
            productId:        i.productId,
            productName:      i.productName,
            quantity:         new Prisma.Decimal(i.quantity),
            unitPriceCents:   i.unitPriceCents,
            modifierAddCents: i.modifierAddCents ?? 0,
            lineTotalCents:   Math.round(i.quantity * i.unitPriceCents) + (i.modifierAddCents ?? 0),
            notes:            i.notes,
          })),
        });
        // Note: per-item modifier rows not re-created on bulk edit. The
        // web admin should call a per-line endpoint for modifier edits;
        // this is a fast path for header + qty changes only.
      }

      return tx.preOrder.update({
        where: { id },
        data: {
          customerId:   dto.customerId === undefined ? undefined : dto.customerId,
          pickupDate:   dto.pickupDate ? new Date(dto.pickupDate) : undefined,
          pickupTime:   dto.pickupTime === undefined ? undefined : dto.pickupTime,
          inscription:  dto.inscription === undefined ? undefined : dto.inscription,
          notes:        dto.notes === undefined ? undefined : dto.notes,
          subtotalCents,
          discountCents,
          totalCents,
          balanceCents,
          status:       dto.status,
        },
        include: { items: { include: { modifiers: true } } },
      });
    });
  }

  /**
   * Flip a pre-order to READY — kitchen has finished production. Idempotent.
   * Allowed from DEPOSIT_PAID or DRAFT (if owner waived deposit).
   */
  async markReady(tenantId: string, id: string) {
    const existing = await this.getOne(tenantId, id);
    if (existing.status === 'READY') return existing;
    if (existing.status !== 'DEPOSIT_PAID' && existing.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot mark a ${existing.status.toLowerCase()} pre-order as ready.`);
    }
    return this.prisma.preOrder.update({
      where: { id },
      data:  { status: 'READY' },
      include: { items: { include: { modifiers: true } } },
    });
  }

  async cancel(tenantId: string, id: string, reason: string | null) {
    const existing = await this.getOne(tenantId, id);
    if (existing.status === 'PICKED_UP') {
      throw new BadRequestException('Cannot cancel a picked-up pre-order; issue a refund instead.');
    }
    if (existing.status === 'CANCELLED') return existing;
    return this.prisma.preOrder.update({
      where: { id },
      data: {
        status:             'CANCELLED',
        cancelledAt:        new Date(),
        cancellationReason: reason,
      },
    });
  }

  /**
   * Link a freshly-rung Order to a pre-order. Called by OrdersService after
   * a successful charge with `preOrderId` in the payload. Sets either the
   * deposit or balance pointer based on the pre-order's current status.
   *
   * Idempotent on the linkage: if the pointer is already set we just return.
   */
  async linkOrder(
    tenantId: string,
    preOrderId: string,
    orderId: string,
    kind: 'DEPOSIT' | 'BALANCE',
  ) {
    const existing = await this.getOne(tenantId, preOrderId);
    if (kind === 'DEPOSIT') {
      if (existing.depositOrderId) return existing;
      return this.prisma.preOrder.update({
        where: { id: preOrderId },
        data: { depositOrderId: orderId, status: 'DEPOSIT_PAID' },
      });
    }
    // BALANCE: requires we were READY (or DEPOSIT_PAID if owner skipped READY)
    if (existing.status === 'CANCELLED' || existing.status === 'PICKED_UP') {
      throw new BadRequestException(`Cannot settle balance on ${existing.status.toLowerCase()} pre-order.`);
    }
    if (existing.balanceOrderId) return existing;
    return this.prisma.preOrder.update({
      where: { id: preOrderId },
      data:  { balanceOrderId: orderId, status: 'PICKED_UP' },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Atomic counter via row-level lock on tenants.maxPreOrderNumber. We
   *  approximate it by reading max + 1 from the table — collisions are
   *  resolved by the unique constraint on (tenantId, preOrderNumber). */
  private async generateNumber(tenantId: string): Promise<string> {
    const last = await this.prisma.preOrder.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { preOrderNumber: true },
    });
    const lastNum = last ? parseInt(last.preOrderNumber.replace(/\D/g, ''), 10) || 0 : 0;
    const next    = String(lastNum + 1).padStart(6, '0');
    return `PO-${next}`;
  }
}
