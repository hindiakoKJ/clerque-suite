import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import {
  LaundryServiceType, LaundryPricingMode, LaundryOrderStatus, BusinessType, Prisma,
  LaundryServiceCode, LaundryServiceMode, LaundryMachineKind, LaundryMachineStatus,
  LaundryMachineLineStatus, LaundryPromoKind, LaundryAddOnKind,
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
  constructor(
    private prisma:    PrismaService,
    private numbering: NumberingService,
  ) {}

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
    // Sprint 16 — atomic per-tenant counter (NumberingService).
    return this.numbering.next(tenantId, 'LAUNDRY_CLAIM', null, tx);
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
        if (!dto.loadCount || dto.loadCount <= 0 || !Number.isInteger(dto.loadCount)) {
          throw new BadRequestException('loadCount must be a positive integer for PER_LOAD pricing.');
        }
        quantity = dto.loadCount;
        break;
      case 'PER_PIECE':
      case 'PER_GARMENT':
        if (!dto.pieceCount || dto.pieceCount <= 0 || !Number.isInteger(dto.pieceCount)) {
          throw new BadRequestException('pieceCount must be a positive integer for PER_PIECE / PER_GARMENT pricing.');
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

  /**
   * List active orders for the kanban. Always paginated to keep payloads
   * predictable on busy days. Caller can override take up to 200; default 100.
   */
  async listActive(tenantId: string, branchId?: string, take = 100, skip = 0) {
    await this.assertLaundryTenant(tenantId);
    const safeTake = Math.min(Math.max(take, 1), 200);
    const safeSkip = Math.max(skip, 0);
    const where = {
      tenantId,
      branchId: branchId || undefined,
      status:   { not: 'CLAIMED' as const },
    };
    const [total, data] = await Promise.all([
      this.prisma.laundryOrder.count({ where }),
      this.prisma.laundryOrder.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take:    safeTake,
        skip:    safeSkip,
        include: {
          items:    true,
          customer: { select: { id: true, name: true, contactPhone: true } },
          branch:   { select: { id: true, name: true } },
          lines: {
            select: {
              id: true, machineStatus: true,
              machine:      { select: { id: true, code: true, kind: true } },
              dryerMachine: { select: { id: true, code: true, kind: true } },
            },
          },
        },
      }),
    ]);
    return { data, total, take: safeTake, skip: safeSkip };
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
        lines: {
          include: {
            machine:      { select: { id: true, code: true, kind: true } },
              dryerMachine: { select: { id: true, code: true, kind: true } },
            addOns:  true,
          },
        },
        productLines:      { include: { product: { select: { id: true, name: true, sku: true } } } },
        promoApplications: true,
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
    if (order.status === 'CANCELLED') {
      throw new BadRequestException('Already CANCELLED — cannot revert or advance.');
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
  /**
   * Sprint 19 — Claim + Pay in one round-trip.
   *
   * The legacy two-step flow (frontend creates a POS Order via `POST /orders`,
   * then calls `POST /laundry/orders/:id/claim` with the order id) failed
   * because OrderItem.productId is required by schema. Laundry has no real
   * product to point at — the till is selling a service line.
   *
   * Server-side: lazily ensure a sentinel "Laundry Service" product exists
   * for this tenant (created once, reused on every subsequent claim), build
   * the POS Order using that product id, post the AccountingEvent for the
   * sale, and link the laundry order — all in one $transaction. The
   * frontend now just sends the payment info.
   */
  /**
   * Sprint 19 — Record payment on a laundry order WITHOUT marking it
   * CLAIMED. Activity status (RECEIVED → … → READY) progresses
   * independently. Use cases:
   *   - Self-service walk-in pays at intake, then loads the machine themselves
   *   - Full-service customer pays upfront before staff starts the wash
   *   - Anywhere in between
   *
   * Idempotent on the LaundryOrder.id — calling pay twice throws because
   * paymentStatus is already PAID. Creates one POS Order + AccountingEvent;
   * stamps paidAt + paymentStatus=PAID + orderId on the laundry order.
   */
  async payForOrder(
    tenantId: string,
    laundryOrderId: string,
    userId: string,
    payment: {
      method:    'CASH' | 'GCASH_PERSONAL' | 'GCASH_BUSINESS' | 'MAYA_PERSONAL' | 'MAYA_BUSINESS' | 'QR_PH';
      tendered?: number;
      reference?: string;
    },
  ) {
    await this.assertLaundryTenant(tenantId);
    const order = await this.prisma.laundryOrder.findFirst({
      where: { id: laundryOrderId, tenantId },
    });
    if (!order)                                throw new NotFoundException('Laundry order not found.');
    if (order.status === 'CANCELLED')          throw new BadRequestException('Cannot bill a cancelled order.');
    if (order.paymentStatus === 'PAID')        throw new BadRequestException('Order is already paid.');
    if (!order.branchId)                       throw new BadRequestException('Laundry order has no branch — cannot bill.');

    return this.prisma.$transaction(async (tx) => {
      const posOrderId = await this._recordSale(tx, tenantId, order, userId, payment);
      // Stamp payment fields on the laundry order; do NOT touch status.
      const flipped = await tx.laundryOrder.updateMany({
        where: { id: laundryOrderId, tenantId, paymentStatus: 'UNPAID' },
        data: {
          paymentStatus: 'PAID',
          paidAt:        new Date(),
          orderId:       posOrderId,
        },
      });
      if (flipped.count === 0) {
        throw new ConflictException('Order was paid concurrently — refresh and verify.');
      }
      return tx.laundryOrder.findUnique({
        where: { id: laundryOrderId },
        include: { items: true, order: { select: { id: true, orderNumber: true, totalAmount: true } } },
      });
    }, { timeout: 20_000, maxWait: 5_000 });
  }

  /**
   * Sprint 19 — Combined "claim + pay" for the legacy backend pay-at-claim
   * flow. If the order is already PAID (customer paid earlier), the payment
   * step is a no-op and only the CLAIMED stamp lands. If UNPAID, both fire.
   * The frontend's Claim & Pay modal hits this endpoint regardless.
   */
  async claimAndPay(
    tenantId: string,
    laundryOrderId: string,
    userId: string,
    payment: {
      method:    'CASH' | 'GCASH_PERSONAL' | 'GCASH_BUSINESS' | 'MAYA_PERSONAL' | 'MAYA_BUSINESS' | 'QR_PH';
      tendered?: number;
      reference?: string;
    },
  ) {
    await this.assertLaundryTenant(tenantId);
    const order = await this.prisma.laundryOrder.findFirst({
      where: { id: laundryOrderId, tenantId },
    });
    if (!order)                          throw new NotFoundException('Laundry order not found.');
    if (order.status === 'CLAIMED')      throw new BadRequestException('Already claimed.');
    if (order.status === 'CANCELLED')    throw new BadRequestException('Cannot claim a cancelled order.');
    if (!order.branchId)                 throw new BadRequestException('Laundry order has no branch — cannot bill.');

    return this.prisma.$transaction(async (tx) => {
      let posOrderId = order.orderId;
      // Only record a new sale if the order isn't already paid.
      if (order.paymentStatus !== 'PAID') {
        posOrderId = await this._recordSale(tx, tenantId, order, userId, payment);
      }

      // Always: status → CLAIMED + claimedAt + releasedBy + orderId link.
      // paymentStatus=PAID + paidAt land here too (no-op if already PAID).
      const flipped = await tx.laundryOrder.updateMany({
        where: { id: laundryOrderId, tenantId, status: { notIn: ['CLAIMED', 'CANCELLED'] } },
        data: {
          status:         'CLAIMED',
          claimedAt:      new Date(),
          releasedBy:     userId,
          orderId:        posOrderId,
          paymentStatus:  'PAID',
          paidAt:         order.paidAt ?? new Date(),
          deliveryStatus: order.isDelivery ? 'DELIVERED' : null,
        },
      });
      if (flipped.count === 0) {
        throw new ConflictException('Order is no longer claimable (already CLAIMED or CANCELLED).');
      }

      if (order.customerId) {
        await tx.customer.updateMany({
          where: { id: order.customerId, tenantId },
          data:  { loyaltyVisits: { increment: 1 } },
        });
      }

      return tx.laundryOrder.findUnique({
        where: { id: laundryOrderId },
        include: { items: true, order: { select: { id: true, orderNumber: true, totalAmount: true } } },
      });
    }, { timeout: 20_000, maxWait: 5_000 });
  }

  /**
   * Internal helper — given an open transaction client and a laundry order,
   * lazy-creates the sentinel "Laundry Service" product if needed, allocates
   * a POS order number, creates the POS Order + payment row, and emits the
   * SALE AccountingEvent so the journal posts. Returns the POS Order id.
   *
   * Used by both payForOrder() (pay-only) and claimAndPay() (pay + mark
   * claimed) so the cash-flow path is identical.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _recordSale(
    tx: any,
    tenantId: string,
    order: { id: string; branchId: string; customerId: string | null; claimNumber: string; totalAmount: any }, // eslint-disable-line @typescript-eslint/no-explicit-any
    userId: string,
    payment: {
      method:    'CASH' | 'GCASH_PERSONAL' | 'GCASH_BUSINESS' | 'MAYA_PERSONAL' | 'MAYA_BUSINESS' | 'QR_PH';
      tendered?: number;
      reference?: string;
    },
  ): Promise<string> {
    const total = Number(order.totalAmount);
    const tenderNum = payment.method === 'CASH'
      ? Math.max(Number(payment.tendered ?? total), total)
      : total;
    const change = payment.method === 'CASH' ? Math.max(0, tenderNum - total) : 0;

    // Sentinel "Laundry Service" product — lazy-created per tenant.
    const SENTINEL_SKU = '__LAUNDRY_SERVICE__';
    let serviceProduct = await tx.product.findFirst({
      where:  { tenantId, sku: SENTINEL_SKU },
      select: { id: true },
    });
    if (!serviceProduct) {
      serviceProduct = await tx.product.create({
        data: {
          tenantId,
          sku:        SENTINEL_SKU,
          name:       'Laundry Service',
          description: 'System-generated sentinel product for laundry claim cash-outs. Not user-editable.',
          price:      0,
          costPrice:  0,
          isVatable:  false,
          isActive:   false,
        },
        select: { id: true },
      });
    }

    const orderNumber = await this.numbering.next(tenantId, 'POS_ORDER', null, tx);
    const posOrder = await tx.order.create({
      data: {
        tenantId,
        branchId:       order.branchId,
        customerId:     order.customerId,
        orderNumber,
        status:         'COMPLETED',
        createdById:    userId,
        paidAt:         new Date(),
        completedAt:    new Date(),
        subtotal:       new Prisma.Decimal(total),
        discountAmount: new Prisma.Decimal(0),
        vatAmount:      new Prisma.Decimal(0),
        totalAmount:    new Prisma.Decimal(total),
        invoiceType:    'CASH_SALE',
        taxType:        'VAT_EXEMPT',
        notes:          `Laundry · ${order.claimNumber}`,
        items: {
          create: [{
            productId:      serviceProduct.id,
            productName:    `Laundry · ${order.claimNumber}`,
            unitPrice:      new Prisma.Decimal(total),
            quantity:       new Prisma.Decimal(1),
            discountAmount: new Prisma.Decimal(0),
            vatAmount:      new Prisma.Decimal(0),
            lineTotal:      new Prisma.Decimal(total),
            isVatable:      false,
            taxType:        'VAT_EXEMPT',
          }],
        },
        payments: {
          create: [{
            method:    payment.method,
            amount:    new Prisma.Decimal(payment.method === 'CASH' ? tenderNum : total),
            reference: payment.reference ?? null,
            ...(change > 0 ? { change: new Prisma.Decimal(change) } : {}),
          }],
        },
      },
      select: { id: true, orderNumber: true },
    });

    await tx.accountingEvent.create({
      data: {
        tenantId,
        orderId: posOrder.id,
        type:    'SALE',
        status:  'PENDING',
        payload: {
          orderId:         posOrder.id,
          orderNumber:     posOrder.orderNumber,
          branchId:        order.branchId,
          completedAt:     new Date().toISOString(),
          lines: [{
            productId:      serviceProduct.id,
            productName:    `Laundry · ${order.claimNumber}`,
            quantity:       1,
            unitPrice:      total,
            lineTotal:      total,
            discountAmount: 0,
            vatAmount:      0,
            isVatable:      false,
            taxType:        'VAT_EXEMPT',
          }],
          payments: [{
            method:    payment.method,
            amount:    payment.method === 'CASH' ? tenderNum : total,
            reference: payment.reference ?? null,
            ...(change > 0 ? { change } : {}),
          }],
          vatAmount:       0,
          totalAmount:     total,
          discountAmount:  0,
          isPwdScDiscount: false,
          invoiceType:     'CASH_SALE',
          taxType:         'VAT_EXEMPT',
        } as unknown as Prisma.JsonObject,
      },
    });

    return posOrder.id;
  }

  /**
   * Sprint 19 — Pickup-only claim. For orders that are already PAID
   * (self-service or pay-at-intake), records the customer taking custody
   * without re-billing. Throws if not paid — caller should route to
   * claimAndPay instead.
   */
  async claimPickup(tenantId: string, laundryOrderId: string, userId: string) {
    await this.assertLaundryTenant(tenantId);
    const order = await this.prisma.laundryOrder.findFirst({
      where: { id: laundryOrderId, tenantId },
    });
    if (!order)                            throw new NotFoundException('Laundry order not found.');
    if (order.status === 'CLAIMED')        throw new BadRequestException('Already claimed.');
    if (order.status === 'CANCELLED')      throw new BadRequestException('Cannot claim a cancelled order.');
    if (order.paymentStatus !== 'PAID') {
      throw new BadRequestException('Order is not paid yet — use claim-and-pay or record payment first.');
    }

    return this.prisma.$transaction(async (tx) => {
      const flipped = await tx.laundryOrder.updateMany({
        where: { id: laundryOrderId, tenantId, status: { notIn: ['CLAIMED', 'CANCELLED'] } },
        data: {
          status:         'CLAIMED',
          claimedAt:      new Date(),
          releasedBy:     userId,
          deliveryStatus: order.isDelivery ? 'DELIVERED' : null,
        },
      });
      if (flipped.count === 0) {
        throw new ConflictException('Order is no longer claimable.');
      }
      if (order.customerId) {
        await tx.customer.updateMany({
          where: { id: order.customerId, tenantId },
          data:  { loyaltyVisits: { increment: 1 } },
        });
      }
      return tx.laundryOrder.findUnique({
        where: { id: laundryOrderId },
        include: { items: true, order: { select: { id: true, orderNumber: true, totalAmount: true } } },
      });
    });
  }

  async claim(tenantId: string, id: string, userId: string, posOrderId: string) {
    await this.assertLaundryTenant(tenantId);
    const order = await this.prisma.laundryOrder.findFirst({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Laundry order not found.');
    if (order.status === 'CLAIMED') throw new BadRequestException('Already claimed.');
    if (order.status === 'CANCELLED') throw new BadRequestException('Cannot claim a cancelled order.');

    // Atomic claim + loyalty bump in one transaction. We use a status-conditional
    // updateMany so a concurrent claim for the same order can't double-credit
    // the customer's loyalty count.
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.laundryOrder.updateMany({
        where: {
          id, tenantId,
          status: { notIn: ['CLAIMED', 'CANCELLED'] },
        },
        data: {
          status:     'CLAIMED',
          claimedAt:  new Date(),
          releasedBy: userId,
          orderId:    posOrderId,
          // If the order was a delivery ticket, mark it DELIVERED — the
          // customer is taking custody right now (or has already received it).
          deliveryStatus: order.isDelivery ? 'DELIVERED' : null,
        },
      });
      if (result.count === 0) {
        throw new BadRequestException('Order is no longer claimable (already CLAIMED or CANCELLED).');
      }

      // Loyalty: increment Customer.loyaltyVisits if a customer was attached.
      // Walk-in tickets (customerId null) don't accrue loyalty by definition.
      if (order.customerId) {
        await tx.customer.updateMany({
          where: { id: order.customerId, tenantId },
          data:  { loyaltyVisits: { increment: 1 } },
        });
      }

      return tx.laundryOrder.findUnique({
        where:   { id },
        include: { items: true, order: { select: { id: true, orderNumber: true, totalAmount: true } } },
      });
    });
  }

  /**
   * Public claim-stub lookup — UNAUTHENTICATED endpoint. Customer scans the
   * QR on their paper ticket (or opens the SMS link) and sees their order
   * status without logging in. Token is unguessable (claimNumber + 4 random
   * alphanums) so iterating sequential claim numbers won't surface other
   * customers' orders.
   *
   * Returns minimal fields: claim number, status, promised time, total,
   * loyalty progress. Never returns service-line detail or customer PII.
   */
  async getPublicStub(token: string) {
    const order = await this.prisma.laundryOrder.findUnique({
      where:  { publicStubToken: token },
      select: {
        claimNumber:    true,
        status:         true,
        receivedAt:     true,
        promisedAt:     true,
        readyAt:        true,
        claimedAt:      true,
        totalAmount:    true,
        isDelivery:     true,
        deliveryStatus: true,
        tenant:         { select: { name: true } },
        branch:         { select: { name: true } },
        customer:       { select: { name: true, loyaltyVisits: true } },
      },
    });
    if (!order) throw new NotFoundException('Stub not found or expired.');
    return order;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // v2 — Multi-line tickets, machine fleet, promos (Sprint 7, 2026-05-08)
  // ═════════════════════════════════════════════════════════════════════════

  // ── Service price matrix ──────────────────────────────────────────────────

  async listServicePrices(tenantId: string) {
    return this.prisma.laundryServicePrice.findMany({
      where:   { tenantId },
      orderBy: [{ serviceCode: 'asc' }, { mode: 'asc' }],
    });
  }

  /**
   * Services that physically cannot be self-service. Dry-clean uses
   * solvents and dedicated equipment customers don't operate; ironing
   * and folding are inherently human-labor tasks. Setting a SELF_SERVICE
   * price for any of these is rejected so the catalog stays sensible.
   */
  private static readonly SELF_SERVICE_INELIGIBLE: LaundryServiceCode[] = [
    'DRY_CLEAN', 'IRON', 'FOLD',
  ];

  /** Upsert a single price row for (service, mode). */
  async setServicePrice(
    tenantId: string,
    serviceCode: LaundryServiceCode,
    mode: LaundryServiceMode,
    unitPrice: number,
    isActive = true,
  ) {
    if (
      mode === 'SELF_SERVICE'
      && LaundryService.SELF_SERVICE_INELIGIBLE.includes(serviceCode)
      && unitPrice > 0
    ) {
      throw new BadRequestException(
        `${serviceCode} cannot be sold as SELF_SERVICE — it requires staff. Use FULL_SERVICE pricing only.`,
      );
    }
    return this.prisma.laundryServicePrice.upsert({
      where: { tenantId_serviceCode_mode: { tenantId, serviceCode, mode } },
      create: { tenantId, serviceCode, mode, unitPrice: new Prisma.Decimal(unitPrice), isActive },
      update: { unitPrice: new Prisma.Decimal(unitPrice), isActive },
    });
  }

  // ── Machines ──────────────────────────────────────────────────────────────

  async listMachines(tenantId: string, branchId?: string) {
    return this.prisma.laundryMachine.findMany({
      where:   { tenantId, ...(branchId ? { branchId } : {}) },
      orderBy: [{ branchId: 'asc' }, { kind: 'asc' }, { code: 'asc' }],
      include: {
        branch: { select: { id: true, name: true } },
        lines: {
          where: { machineStatus: 'RUNNING' },
          // Sprint 19 — surface cycle info on the running line so the queue
          // page can render a live countdown.
          select: {
            id: true,
            startedAt: true,
            cycleEndsAt: true,
            cycleAutoComplete: true,
            cycle: { select: { id: true, name: true, durationMinutes: true } },
            order: {
              select: {
                id: true, claimNumber: true,
                customer: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
  }

  async createMachine(
    tenantId: string,
    dto: { branchId: string; code: string; kind: LaundryMachineKind; capacityKg: number; notes?: string },
  ) {
    const branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId } });
    if (!branch) throw new BadRequestException('Branch not found.');
    return this.prisma.laundryMachine.create({
      data: {
        tenantId,
        branchId:    dto.branchId,
        code:        dto.code,
        kind:        dto.kind,
        capacityKg:  new Prisma.Decimal(dto.capacityKg),
        notes:       dto.notes ?? null,
      },
    });
  }

  async updateMachineStatus(tenantId: string, id: string, status: LaundryMachineStatus) {
    const m = await this.prisma.laundryMachine.findFirst({ where: { id, tenantId } });
    if (!m) throw new NotFoundException('Machine not found.');
    if (status === 'IDLE' && m.status === 'RUNNING') {
      throw new BadRequestException('Machine is currently RUNNING — finish or cancel the load first.');
    }
    // Atomic tenant-scoped write — closes the TOCTOU window between findFirst and update.
    const result = await this.prisma.laundryMachine.updateMany({
      where: { id, tenantId },
      data:  { status },
    });
    if (result.count === 0) throw new NotFoundException('Machine not found.');
    return this.prisma.laundryMachine.findUnique({ where: { id } });
  }

  /**
   * Sprint 19 — Edit machine metadata (code, kind, capacity, branch, notes).
   * Cannot change while RUNNING — must be IDLE or OUT_OF_ORDER first.
   */
  async updateMachine(
    tenantId: string,
    id: string,
    dto: Partial<{
      code:       string;
      kind:       LaundryMachineKind;
      capacityKg: number;
      branchId:   string;
      notes:      string | null;
    }>,
  ) {
    const existing = await this.prisma.laundryMachine.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Machine not found.');
    if (existing.status === 'RUNNING') {
      throw new BadRequestException('Cannot edit a RUNNING machine — wait for the cycle to finish first.');
    }
    // If branch is being changed, validate the new branch belongs to this tenant.
    if (dto.branchId && dto.branchId !== existing.branchId) {
      const br = await this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId } });
      if (!br) throw new BadRequestException('Branch not found.');
    }
    if (dto.code != null && !dto.code.trim()) {
      throw new BadRequestException('Machine code cannot be empty.');
    }
    return this.prisma.laundryMachine.update({
      where: { id },
      data: {
        ...(dto.code       != null ? { code: dto.code.trim() } : {}),
        ...(dto.kind       != null ? { kind: dto.kind } : {}),
        ...(dto.capacityKg != null ? { capacityKg: new Prisma.Decimal(dto.capacityKg) } : {}),
        ...(dto.branchId   != null ? { branchId: dto.branchId } : {}),
        ...(dto.notes      !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  /**
   * Sprint 19 — Delete a machine. Refuses if there are RUNNING lines on it
   * (FK + active state). For machines with historical lines, the relation
   * is `Restrict` on delete, so this throws cleanly via Prisma's P2003 →
   * the global filter wraps it as 400. Operators should mark machines
   * OUT_OF_ORDER and stop using them rather than deleting if they have
   * any historical activity.
   */
  async deleteMachine(tenantId: string, id: string) {
    const existing = await this.prisma.laundryMachine.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { lines: true } } },
    });
    if (!existing) throw new NotFoundException('Machine not found.');
    if (existing.status === 'RUNNING') {
      throw new BadRequestException('Cannot delete a RUNNING machine.');
    }
    if (existing._count.lines > 0) {
      throw new BadRequestException(
        'This machine has historical loads attached. Mark it OUT_OF_ORDER instead so the audit trail is preserved.',
      );
    }
    await this.prisma.laundryMachine.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ── Multi-line ticket creation ────────────────────────────────────────────

  /**
   * Creates a v2 ticket with multiple service lines + retail product lines.
   * Looks up unit prices from LaundryServicePrice. Optionally applies promos
   * automatically based on the line set.
   */
  async createOrderV2(
    tenantId: string,
    userId: string,
    dto: {
      branchId:   string;
      customerId?: string;
      promisedAt?: string;
      notes?:      string;
      /** Sprint 11 — pickup/delivery support. */
      isDelivery?:      boolean;
      deliveryAddress?: string;
      deliveryFee?:     number;
      lines: Array<{
        serviceCode: LaundryServiceCode;
        mode:        LaundryServiceMode;
        sets:        number;
        weightKg?:   number;
        notes?:      string;
        /** Optional list of add-on IDs to attach to this line. */
        addOnIds?:   string[];
        /**
         * Optional machine to assign at intake time. Sets the line as
         * RUNNING immediately + flips the machine to RUNNING (no separate
         * /lines/:id/assign call needed). Validated below: machine must
         * belong to the tenant + same branch, be IDLE, and its `kind`
         * must be compatible with `serviceCode` (WASH → WASHER/COMBO,
         * DRY → DRYER/COMBO, WASH_DRY_COMBO → COMBO).
         */
        machineId?:  string;
        /**
         * Sprint 19 — Optional wash/dry cycle picked at intake time.
         * Drives cycleEndsAt + cycleAutoComplete on the resulting line so
         * the fleet dashboard shows a countdown and the cron can
         * auto-complete. Validated against the picked machine's kind.
         * Ignored unless machineId is also set.
         */
        cycleId?:          string;
        /** Override the cycle's default autoComplete on a per-line basis. */
        cycleAutoComplete?: boolean;
      }>;
      productLines?: Array<{ productId: string; quantity: number; notes?: string }>;
      garments?: Array<{ garmentType: string; quantity?: number; condition?: string; tagNumber?: string }>;
    },
  ) {
    await this.assertLaundryTenant(tenantId);
    if (!dto.lines.length && !dto.productLines?.length) {
      throw new BadRequestException('At least one service line or product is required.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Branch validation
      const branch = await tx.branch.findFirst({ where: { id: dto.branchId, tenantId } });
      if (!branch) throw new BadRequestException('Branch not found.');

      // Look up service prices.
      const priceRows = await tx.laundryServicePrice.findMany({
        where: { tenantId, isActive: true },
      });
      const priceKey = (s: LaundryServiceCode, m: LaundryServiceMode) => `${s}|${m}`;
      const priceMap = new Map(
        priceRows.map((p) => [priceKey(p.serviceCode, p.mode), Number(p.unitPrice)]),
      );

      // Resolve all add-on definitions referenced by any line.
      const allAddOnIds = Array.from(
        new Set(dto.lines.flatMap((l) => l.addOnIds ?? [])),
      );
      const addOns = allAddOnIds.length
        ? await tx.laundryServiceAddOn.findMany({
            where:  { id: { in: allAddOnIds }, tenantId, isActive: true },
            select: { id: true, code: true, name: true, kind: true, amount: true },
          })
        : [];
      if (addOns.length !== allAddOnIds.length) {
        throw new BadRequestException('One or more add-ons not found or inactive.');
      }
      const addOnById = new Map(addOns.map((a) => [a.id, a]));

      // ── Optional machine pre-assignment ────────────────────────────────
      // Cashier can tag a washer / dryer at intake time so the customer
      // sees exactly which unit their load is in. Validate every requested
      // machine here, in one batch, before we mutate anything.
      //
      // Sprint 19 — WASH_DRY_COMBO lines accept TWO machines (washer slot
      // via `machineId`, dryer slot via `dryerMachineId`) so the combo can
      // run on a real washer + real dryer instead of a fictional COMBO unit.
      const requestedMachineIds = Array.from(
        new Set(
          dto.lines.flatMap((l) => [l.machineId, (l as any).dryerMachineId])
            .filter((x): x is string => !!x),
        ),
      );
      const machinesById = new Map<string, { id: string; kind: 'WASHER' | 'DRYER' | 'COMBO'; status: string; branchId: string; code: string }>();
      if (requestedMachineIds.length) {
        const machines = await tx.laundryMachine.findMany({
          where:  { id: { in: requestedMachineIds }, tenantId },
          select: { id: true, kind: true, status: true, branchId: true, code: true },
        });
        for (const m of machines) machinesById.set(m.id, m as any);
        for (const id of requestedMachineIds) {
          const m = machinesById.get(id);
          if (!m) throw new NotFoundException(`Machine ${id} not found.`);
          if (m.branchId !== dto.branchId) {
            throw new BadRequestException(`Machine ${m.code} belongs to a different branch.`);
          }
          if (m.status !== 'IDLE') {
            throw new BadRequestException(`Machine ${m.code} is ${m.status} — pick another or wait for it to free up.`);
          }
        }
        // Reject duplicate machine IDs across all line slots (washer +
        // dryer combined). Two lines on the same machine is ambiguous;
        // ditto a single combo with the same machine in both slots.
        const lineMachineIds = dto.lines
          .flatMap((l) => [l.machineId, (l as any).dryerMachineId])
          .filter(Boolean) as string[];
        const dupCheck = new Set<string>();
        for (const id of lineMachineIds) {
          if (dupCheck.has(id)) {
            const code = machinesById.get(id)?.code ?? id;
            throw new BadRequestException(`Machine ${code} is referenced by more than one slot — pick a different machine.`);
          }
          dupCheck.add(id);
        }
      }

      // ── Sprint 19 — Cycle pre-assignment ───────────────────────────────
      // Operator can pick "Premium Wash 60min" / "Heavy Duty Dry 45min"
      // alongside the machine at intake time. We validate kind compat,
      // compute cycleEndsAt = now + duration, and stamp the line so the
      // fleet dashboard shows a countdown immediately + the cron can
      // auto-complete when the timer elapses (if flagged).
      const requestedCycleIds = Array.from(
        new Set(dto.lines.map((l) => l.cycleId).filter((x): x is string => !!x)),
      );
      const cyclesById = new Map<string, { id: string; kind: 'WASHER' | 'DRYER' | 'COMBO'; durationMinutes: number; autoComplete: boolean }>();
      if (requestedCycleIds.length) {
        const cycles = await tx.laundryWashCycle.findMany({
          where:  { id: { in: requestedCycleIds }, tenantId, isActive: true },
          select: { id: true, kind: true, durationMinutes: true, autoComplete: true },
        });
        for (const c of cycles) cyclesById.set(c.id, c as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (cycles.length !== requestedCycleIds.length) {
          throw new BadRequestException('One or more wash cycles not found or inactive.');
        }
        // Validate kind compat against the line's chosen machine.
        for (const l of dto.lines) {
          if (!l.cycleId) continue;
          if (!l.machineId) {
            throw new BadRequestException('Cycle requires a machine on the same line.');
          }
          const cycle = cyclesById.get(l.cycleId)!;
          const machine = machinesById.get(l.machineId)!;
          const compatible =
            cycle.kind === machine.kind ||
            machine.kind === 'COMBO' ||
            cycle.kind === 'COMBO';
          if (!compatible) {
            throw new BadRequestException(
              `Cycle is for ${cycle.kind} — can't run on ${machine.code} (${machine.kind}).`,
            );
          }
        }
      }
      // Service-code → compatible machine kinds. Sprint 19: combo lines
      // run on a washer (or COMBO) for the wash phase + a dryer (or COMBO)
      // for the dry phase. Two slots, validated independently.
      const KIND_BY_SERVICE: Partial<Record<LaundryServiceCode, {
        washer?: Array<'WASHER' | 'DRYER' | 'COMBO'>;
        dryer?:  Array<'WASHER' | 'DRYER' | 'COMBO'>;
      }>> = {
        WASH:           { washer: ['WASHER', 'COMBO'] },
        DRY:            { washer: ['DRYER',  'COMBO'] }, // single slot — repurpose 'washer' field
        WASH_DRY_COMBO: { washer: ['WASHER', 'COMBO'], dryer: ['DRYER', 'COMBO'] },
        // Other services (DRY_CLEAN / IRON / FOLD / EXTRA_RINSE /
        // FABRIC_SOFTENER) are inherently human-labor or chemical — no
        // machine assignment supported.
      };

      // Compute service line subtotals (base + add-on contributions).
      const serviceLines = dto.lines.map((l) => {
        const unit = priceMap.get(priceKey(l.serviceCode, l.mode));
        if (unit == null) {
          throw new BadRequestException(`No price set for ${l.serviceCode} (${l.mode}). Configure under Settings → Laundry.`);
        }

        // If machines were requested, confirm their kinds are compatible
        // with this line's service code. WASH on a DRYER is nonsensical.
        const slots = KIND_BY_SERVICE[l.serviceCode];
        const dryerMachineId = (l as any).dryerMachineId as string | undefined;
        if ((l.machineId || dryerMachineId) && !slots) {
          throw new BadRequestException(
            `${l.serviceCode} doesn't run on a machine — remove the machine assignment.`,
          );
        }
        if (l.machineId && slots?.washer) {
          const m = machinesById.get(l.machineId)!;
          if (!slots.washer.includes(m.kind)) {
            throw new BadRequestException(
              `Machine ${m.code} is a ${m.kind} — can't run ${l.serviceCode}'s ` +
              `${l.serviceCode === 'WASH_DRY_COMBO' ? 'wash phase' : 'cycle'} on it.`,
            );
          }
        }
        if (dryerMachineId) {
          if (l.serviceCode !== 'WASH_DRY_COMBO') {
            throw new BadRequestException(
              `dryerMachineId is only meaningful for WASH_DRY_COMBO lines.`,
            );
          }
          const m = machinesById.get(dryerMachineId)!;
          if (!slots?.dryer || !slots.dryer.includes(m.kind)) {
            throw new BadRequestException(
              `Machine ${m.code} is a ${m.kind} — can't run the dry phase on it.`,
            );
          }
        }
        // Sprint 19 — for combos, both slots should be filled. The cashier
        // CAN leave both blank (assign machines later) but supplying only
        // one half is ambiguous and we reject it.
        if (l.serviceCode === 'WASH_DRY_COMBO') {
          if ((l.machineId && !dryerMachineId) || (!l.machineId && dryerMachineId)) {
            throw new BadRequestException(
              `Wash + Dry combo needs both a washer and a dryer assigned (or leave both blank to assign later).`,
            );
          }
        }

        const baseTotal = Math.round(unit * l.sets * 100) / 100;

        // Resolve add-ons for this line and compute contributions.
        const lineAddOns = (l.addOnIds ?? []).map((id) => {
          const a = addOnById.get(id)!;
          const perUnit  = Number(a.amount);
          const totalAmt = a.kind === 'FLAT_FEE'
            ? Math.round(perUnit * 100) / 100              // once per line
            : Math.round(perUnit * l.sets * 100) / 100;    // SURCHARGE per set
          return {
            addOnId:       a.id,
            kind:          a.kind,
            code:          a.code,
            name:          a.name,
            amountPerUnit: perUnit,
            totalAmount:   totalAmt,
          };
        });
        const addOnTotal = lineAddOns.reduce((s, a) => s + a.totalAmount, 0);
        const lineTotal  = Math.round((baseTotal + addOnTotal) * 100) / 100;

        return { ...l, unitPrice: unit, lineTotal, addOns: lineAddOns };
      });
      const serviceSubtotal = serviceLines.reduce((s, l) => s + l.lineTotal, 0);

      // Look up product prices.
      const productLines = (dto.productLines ?? []);
      const productIds = productLines.map((p) => p.productId);
      const products = productIds.length
        ? await tx.product.findMany({
            where:  { id: { in: productIds }, tenantId },
            select: { id: true, price: true },
          })
        : [];
      if (products.length !== productIds.length) {
        throw new BadRequestException('One or more products not found.');
      }
      const productPriceById = new Map(products.map((p) => [p.id, Number(p.price)]));
      const enrichedProductLines = productLines.map((p) => {
        const unit = productPriceById.get(p.productId)!;
        return { ...p, unitPrice: unit, lineTotal: Math.round(unit * p.quantity * 100) / 100 };
      });
      const productSubtotal = enrichedProductLines.reduce((s, l) => s + l.lineTotal, 0);

      // Note: retail product inventory deduction is performed AFTER the
      // claim number is generated (see below) — we need the claim number in
      // the InventoryLog reason for traceability. The placeholder list of
      // products + quantities is held here, applied after.

      // Promo evaluation (best-fit) — basic implementation; can be expanded.
      const promoDiscount = await this.evaluatePromos(tx, tenantId, serviceLines);

      // Delivery fee — added to gross before promo discount. Walk-in tickets
      // ignore this field; delivery tickets default to 0 if the operator
      // didn't enter a fee (we still flag isDelivery so the rider workflow
      // surfaces the order on the queue board).
      const deliveryFee = dto.isDelivery && Number.isFinite(dto.deliveryFee)
        ? Math.max(0, Math.round((dto.deliveryFee as number) * 100) / 100)
        : 0;

      const grossTotal = serviceSubtotal + productSubtotal + deliveryFee;
      const netTotal   = Math.max(0, Math.round((grossTotal - promoDiscount.totalDiscount) * 100) / 100);

      // Generate claim number (reuse existing helper).
      const claimNumber = await this.nextClaimNumber(tx, tenantId);

      // Public stub token — short random suffix appended to the claim number
      // so the customer-facing /stub/<token> page is unguessable. Format:
      // {claimNumber}-{4 random alphanum}. Stored on the order; never reuses.
      const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/1/O/0 — easier to read
      const suffix = Array.from({ length: 4 }, () =>
        ALPHA[Math.floor(Math.random() * ALPHA.length)],
      ).join('');
      const publicStubToken = `${claimNumber}-${suffix}`;

      const order = await tx.laundryOrder.create({
        data: {
          tenantId,
          branchId:    dto.branchId,
          customerId:  dto.customerId ?? null,
          claimNumber,
          status:      'RECEIVED',
          // v2 leaves the legacy single-shape header fields null.
          serviceType: null,
          pricingMode: null,
          weightKg:    null,
          loadCount:   null,
          pieceCount:  null,
          unitPrice:   null,
          totalAmount: new Prisma.Decimal(netTotal),
          promisedAt:  dto.promisedAt ? new Date(dto.promisedAt) : null,
          notes:       dto.notes ?? null,
          intakeBy:    userId,
          // Delivery — only set when isDelivery=true. Walk-in tickets keep these null.
          isDelivery:      Boolean(dto.isDelivery),
          deliveryAddress: dto.isDelivery ? (dto.deliveryAddress?.trim() || null) : null,
          deliveryFee:     dto.isDelivery ? new Prisma.Decimal(deliveryFee) : null,
          deliveryStatus:  dto.isDelivery ? 'PENDING_PICKUP' : null,
          publicStubToken,
          lines: {
            create: serviceLines.map((l) => ({
              serviceCode: l.serviceCode,
              mode:        l.mode,
              sets:        l.sets,
              unitPrice:   new Prisma.Decimal(l.unitPrice),
              lineTotal:   new Prisma.Decimal(l.lineTotal),
              weightKg:    l.weightKg != null ? new Prisma.Decimal(l.weightKg) : null,
              notes:       l.notes ?? null,
              // Pre-assigned machine — line starts RUNNING immediately so
              // the queue board / customer stub shows it as in-progress.
              // Sprint 19 — combos carry both a washer (machineId) and a
              // dryer (dryerMachineId); single-machine lines leave the dryer slot null.
              machineId:      l.machineId ?? null,
              dryerMachineId: (l as any).dryerMachineId ?? null,
              machineStatus:  l.machineId ? 'RUNNING' : 'NOT_STARTED',
              startedAt:      l.machineId ? new Date() : null,
              // Sprint 19 — wash cycle (drives countdown + auto-complete).
              // Validated above; safe to look up + compute end time here.
              ...(l.cycleId && l.machineId
                ? (() => {
                    const c = cyclesById.get(l.cycleId)!;
                    return {
                      cycleId:           c.id,
                      cycleEndsAt:       new Date(Date.now() + c.durationMinutes * 60_000),
                      cycleAutoComplete: l.cycleAutoComplete ?? c.autoComplete,
                    };
                  })()
                : {}),
              addOns: l.addOns.length ? {
                create: l.addOns.map((a) => ({
                  addOnId:       a.addOnId,
                  kind:          a.kind,
                  code:          a.code,
                  name:          a.name,
                  amountPerUnit: new Prisma.Decimal(a.amountPerUnit),
                  totalAmount:   new Prisma.Decimal(a.totalAmount),
                })),
              } : undefined,
            })),
          },
          productLines: enrichedProductLines.length ? {
            create: enrichedProductLines.map((p) => ({
              productId: p.productId,
              quantity:  p.quantity,
              unitPrice: new Prisma.Decimal(p.unitPrice),
              lineTotal: new Prisma.Decimal(p.lineTotal),
              notes:     p.notes ?? null,
            })),
          } : undefined,
          promoApplications: promoDiscount.applications.length ? {
            create: promoDiscount.applications.map((a) => ({
              promoCode:      a.code,
              promoName:      a.name,
              discountAmount: new Prisma.Decimal(a.discount),
            })),
          } : undefined,
          items: dto.garments?.length ? {
            create: dto.garments.map((g) => ({
              garmentType: g.garmentType,
              quantity:    g.quantity ?? 1,
              condition:   g.condition ?? null,
              tagNumber:   g.tagNumber ?? null,
            })),
          } : undefined,
        },
        include: {
          lines: {
            include: {
              machine:      { select: { id: true, code: true, kind: true } },
              dryerMachine: { select: { id: true, code: true, kind: true } },
              addOns:  true,
            },
          },
          productLines:      { include: { product: { select: { id: true, name: true } } } },
          promoApplications: true,
          items:             true,
        },
      });

      // Flip every pre-assigned machine to RUNNING in one updateMany.
      // Idempotent w.r.t. the validation above (we already confirmed all
      // were IDLE), so any of them flipping in-flight surfaces as count
      // mismatch and aborts the transaction (TOCTOU-safe).
      if (requestedMachineIds.length) {
        const flipped = await tx.laundryMachine.updateMany({
          where: { id: { in: requestedMachineIds }, tenantId, status: 'IDLE' },
          data:  { status: 'RUNNING' },
        });
        if (flipped.count !== requestedMachineIds.length) {
          throw new ConflictException(
            'A selected machine became unavailable mid-intake — please retry.',
          );
        }
      }

      // Decrement retail product inventory + write InventoryLog audit row.
      // Skip products that are recipe-mode (BOM-based) since their stock is
      // implicit through raw materials. Allow negative-stock to not block
      // a sale (POS behaviour); low-stock alerts cover the gap separately.
      if (enrichedProductLines.length > 0) {
        const productInvMeta = await tx.product.findMany({
          where:  { id: { in: enrichedProductLines.map((p) => p.productId) }, tenantId },
          select: { id: true, inventoryMode: true },
        });
        const inventoryModeById = new Map(productInvMeta.map((p) => [p.id, p.inventoryMode]));
        for (const line of enrichedProductLines) {
          if (inventoryModeById.get(line.productId) !== 'UNIT_BASED') continue;
          const before = await tx.inventoryItem.findUnique({
            where: { branchId_productId: { branchId: dto.branchId, productId: line.productId } },
            select: { quantity: true },
          });
          const beforeQty = Number(before?.quantity ?? 0);
          const afterQty  = beforeQty - line.quantity;
          await tx.inventoryItem.upsert({
            where:  { branchId_productId: { branchId: dto.branchId, productId: line.productId } },
            update: { quantity: { decrement: line.quantity } },
            create: { tenantId, branchId: dto.branchId, productId: line.productId, quantity: -line.quantity },
          });
          await tx.inventoryLog.create({
            data: {
              tenantId, branchId: dto.branchId, productId: line.productId,
              type:           'SALE_DEDUCTION',
              quantity:       new Prisma.Decimal(-line.quantity),
              quantityBefore: new Prisma.Decimal(beforeQty),
              quantityAfter:  new Prisma.Decimal(afterQty),
              reason:         `Laundry retail · ${claimNumber}`,
              referenceId:    order.id,
              createdById:    userId,
            },
          }).catch(() => { /* best-effort audit; never block sale */ });
        }
      }

      return order;
    }, {
      // Sprint 19 — bump transaction window above the 5s Prisma default.
      // Intake does branch/prices/add-on/machine lookups, promo eval,
      // claim numbering, a big nested create with multiple child relations,
      // machine flip, and per-product inventory updates. Under cold-start
      // latency on Railway that easily breaks 5s and surfaces as P2028.
      // 20s is comfortable headroom; ops alerts still fire on prod regressions.
      timeout: 20_000,
      maxWait: 5_000,
    });
  }

  // ── Machine assignment + state transitions ────────────────────────────────

  async assignMachine(
    tenantId: string,
    lineId: string,
    machineId: string,
    cycleOpts?: { cycleId?: string; autoComplete?: boolean },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.laundryOrderLine.findFirst({
        where:  { id: lineId, order: { tenantId } },
        select: { id: true, machineStatus: true },
      });
      if (!line) throw new NotFoundException('Line not found.');
      if (line.machineStatus !== 'NOT_STARTED') {
        throw new BadRequestException(`Cannot assign — line is ${line.machineStatus}.`);
      }
      const machine = await tx.laundryMachine.findFirst({ where: { id: machineId, tenantId } });
      if (!machine) throw new NotFoundException('Machine not found.');
      if (machine.status !== 'IDLE') {
        throw new BadRequestException(`Machine is ${machine.status}.`);
      }

      // Sprint 19 — Cycle picker. If a cycle was selected, validate it
      // matches the machine kind and compute cycleEndsAt = now + duration.
      // The flag also locks in whether the @Cron worker should auto-flip
      // this line to DONE when the timer elapses.
      let cycleId: string | null = null;
      let cycleEndsAt: Date | null = null;
      let cycleAutoComplete = false;
      if (cycleOpts?.cycleId) {
        const cycle = await tx.laundryWashCycle.findFirst({
          where:  { id: cycleOpts.cycleId, tenantId, isActive: true },
          select: { id: true, kind: true, durationMinutes: true, autoComplete: true },
        });
        if (!cycle) throw new NotFoundException('Wash cycle not found or inactive.');
        // COMBO machines accept WASHER or DRYER cycles; otherwise kinds must match.
        const compatible =
          cycle.kind === machine.kind ||
          machine.kind === 'COMBO' ||
          cycle.kind === 'COMBO';
        if (!compatible) {
          throw new BadRequestException(
            `Cycle is for ${cycle.kind} — can't run on a ${machine.kind} machine.`,
          );
        }
        cycleId = cycle.id;
        cycleEndsAt = new Date(Date.now() + cycle.durationMinutes * 60_000);
        // Body flag overrides the cycle's default — operator can opt out
        // of auto-complete on a per-cycle basis ("manual confirmation
        // tonight, not in the mood to trust the timer").
        cycleAutoComplete = cycleOpts.autoComplete ?? cycle.autoComplete;
      }

      await tx.laundryMachine.update({ where: { id: machineId }, data: { status: 'RUNNING' } });
      return tx.laundryOrderLine.update({
        where: { id: lineId },
        data:  {
          machineId,
          machineStatus: 'RUNNING',
          startedAt: new Date(),
          cycleId,
          cycleEndsAt,
          cycleAutoComplete,
        },
      });
    });
  }

  // ── Wash Cycle CRUD (Sprint 19) ───────────────────────────────────────────

  async listCycles(tenantId: string) {
    return this.prisma.laundryWashCycle.findMany({
      where:   { tenantId },
      orderBy: [{ isActive: 'desc' }, { kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCycle(
    tenantId: string,
    dto: {
      name: string;
      kind: 'WASHER' | 'DRYER' | 'COMBO';
      durationMinutes: number;
      autoComplete?: boolean;
      surcharge?: number | null;
      sortOrder?: number;
      isActive?: boolean;
    },
  ) {
    if (!dto.name?.trim())                           throw new BadRequestException('Cycle name is required.');
    if (!Number.isFinite(dto.durationMinutes) || dto.durationMinutes <= 0) {
      throw new BadRequestException('durationMinutes must be a positive number.');
    }
    if (dto.durationMinutes > 24 * 60) {
      throw new BadRequestException('durationMinutes cannot exceed 24 hours.');
    }
    return this.prisma.laundryWashCycle.create({
      data: {
        tenantId,
        name:            dto.name.trim(),
        kind:            dto.kind as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        durationMinutes: dto.durationMinutes,
        autoComplete:    dto.autoComplete ?? false,
        surcharge:       dto.surcharge != null ? new Prisma.Decimal(dto.surcharge) : null,
        sortOrder:       dto.sortOrder ?? 0,
        isActive:        dto.isActive ?? true,
      },
    });
  }

  async updateCycle(
    tenantId: string,
    id: string,
    dto: Partial<{
      name: string;
      kind: 'WASHER' | 'DRYER' | 'COMBO';
      durationMinutes: number;
      autoComplete: boolean;
      surcharge: number | null;
      sortOrder: number;
      isActive: boolean;
    }>,
  ) {
    const existing = await this.prisma.laundryWashCycle.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Cycle not found.');

    if (dto.durationMinutes != null) {
      if (!Number.isFinite(dto.durationMinutes) || dto.durationMinutes <= 0) {
        throw new BadRequestException('durationMinutes must be positive.');
      }
      if (dto.durationMinutes > 24 * 60) {
        throw new BadRequestException('durationMinutes cannot exceed 24 hours.');
      }
    }

    return this.prisma.laundryWashCycle.update({
      where: { id },
      data: {
        ...(dto.name             !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.kind             !== undefined ? { kind: dto.kind as any } : {}), // eslint-disable-line @typescript-eslint/no-explicit-any
        ...(dto.durationMinutes  !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
        ...(dto.autoComplete     !== undefined ? { autoComplete: dto.autoComplete } : {}),
        ...(dto.surcharge        !== undefined
          ? { surcharge: dto.surcharge != null ? new Prisma.Decimal(dto.surcharge) : null }
          : {}),
        ...(dto.sortOrder        !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive         !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deleteCycle(tenantId: string, id: string) {
    // Soft delete — keep historical line.cycleId references valid.
    const existing = await this.prisma.laundryWashCycle.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Cycle not found.');
    return this.prisma.laundryWashCycle.update({
      where: { id },
      data:  { isActive: false },
    });
  }

  /**
   * Sprint 19 — @Cron worker target. Scans for RUNNING lines whose timer
   * has elapsed and which are flagged for auto-complete; promotes them
   * to DONE and releases the machine. Runs every minute.
   *
   * Idempotent: status-conditional updates so two overlapping cron ticks
   * cannot double-flip a line.
   */
  async tickAutoCompleteCycles(): Promise<{ promoted: number }> {
    const now = new Date();
    const candidates = await this.prisma.laundryOrderLine.findMany({
      where: {
        machineStatus:     'RUNNING',
        cycleAutoComplete: true,
        cycleEndsAt:       { lte: now },
      },
      select: { id: true, machineId: true },
      take: 200, // bound batch size
    });
    if (!candidates.length) return { promoted: 0 };

    let promoted = 0;
    for (const c of candidates) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const flipped = await tx.laundryOrderLine.updateMany({
            where: {
              id: c.id,
              machineStatus: 'RUNNING',
              cycleAutoComplete: true,
              cycleEndsAt: { lte: now },
            },
            data:  { machineStatus: 'DONE', finishedAt: now },
          });
          if (flipped.count !== 1) return;
          if (c.machineId) {
            await tx.laundryMachine.updateMany({
              where: { id: c.machineId, status: 'RUNNING' },
              data:  { status: 'IDLE' },
            });
          }
          promoted++;
        });
      } catch {
        // best-effort; log + continue. We'll catch the next tick.
      }
    }
    return { promoted };
  }

  async markLineDone(tenantId: string, lineId: string) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.laundryOrderLine.findFirst({
        where:  { id: lineId, order: { tenantId } },
        select: { id: true, machineStatus: true, machineId: true },
      });
      if (!line) throw new NotFoundException('Line not found.');
      if (line.machineStatus !== 'RUNNING') {
        throw new BadRequestException(`Line is ${line.machineStatus}, not RUNNING.`);
      }
      if (line.machineId) {
        await tx.laundryMachine.update({ where: { id: line.machineId }, data: { status: 'IDLE' } });
      }
      return tx.laundryOrderLine.update({
        where: { id: lineId },
        data:  { machineStatus: 'DONE', finishedAt: new Date() },
      });
    });
  }

  // ── Promo CRUD ────────────────────────────────────────────────────────────

  async listPromos(tenantId: string) {
    return this.prisma.laundryPromo.findMany({
      where:   { tenantId },
      orderBy: [{ isActive: 'desc' }, { priority: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createPromo(
    tenantId: string,
    dto: {
      code: string; name: string; kind: LaundryPromoKind;
      conditions: any; priority?: number; isActive?: boolean;
      validFrom?: string; validTo?: string;
    },
  ) {
    return this.prisma.laundryPromo.create({
      data: {
        tenantId,
        code:       dto.code.toUpperCase(),
        name:       dto.name,
        kind:       dto.kind,
        conditions: dto.conditions,
        priority:   dto.priority ?? 100,
        isActive:   dto.isActive ?? true,
        validFrom:  dto.validFrom ? new Date(dto.validFrom) : null,
        validTo:    dto.validTo   ? new Date(dto.validTo)   : null,
      },
    });
  }

  async togglePromo(tenantId: string, id: string, isActive: boolean) {
    // Atomic tenant-scoped toggle — no findFirst pre-check needed.
    const result = await this.prisma.laundryPromo.updateMany({
      where: { id, tenantId },
      data:  { isActive },
    });
    if (result.count === 0) throw new NotFoundException('Promo not found.');
    return this.prisma.laundryPromo.findUnique({ where: { id } });
  }

  async deletePromo(tenantId: string, id: string) {
    // Atomic tenant-scoped delete.
    const result = await this.prisma.laundryPromo.deleteMany({ where: { id, tenantId } });
    if (result.count === 0) throw new NotFoundException('Promo not found.');
    return { ok: true };
  }

  // ── Promo evaluation engine (basic) ───────────────────────────────────────

  private async evaluatePromos(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lines: Array<{ serviceCode: LaundryServiceCode; mode: LaundryServiceMode; sets: number; unitPrice: number; lineTotal: number }>,
  ): Promise<{ totalDiscount: number; applications: Array<{ code: string; name: string; discount: number }> }> {
    // Compute day-of-week + hour in Asia/Manila (UTC+8) using Intl.
    // The previous implementation did `getUTCHours() + 8` which can yield 24+
    // and crosses the day boundary near midnight, mis-evaluating off-peak windows.
    const phFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      weekday:  'short',
      hour:     '2-digit',
      hour12:   false,
    });
    const parts = phFormatter.formatToParts(new Date());
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dow  = weekdayMap[parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'] ?? 1;
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);

    const nowUtc = new Date();
    const promos = await tx.laundryPromo.findMany({
      where: {
        tenantId, isActive: true,
        OR: [{ validFrom: null }, { validFrom: { lte: nowUtc } }],
        AND: [{ OR: [{ validTo: null }, { validTo: { gte: nowUtc } }] }],
      },
      orderBy: { priority: 'asc' },
    });

    const applications: Array<{ code: string; name: string; discount: number }> = [];
    let totalDiscount = 0;

    for (const p of promos) {
      const c = (p.conditions ?? {}) as any;
      // Day-of-week / hour-window check.
      if (c.dayOfWeek && Array.isArray(c.dayOfWeek) && !c.dayOfWeek.includes(dow)) continue;
      if (c.hourFrom != null && hour < c.hourFrom) continue;
      if (c.hourTo   != null && hour > c.hourTo)   continue;

      // Match lines that satisfy service/mode filters.
      const matchingLines = lines.filter((l) =>
        (!c.service || c.service === l.serviceCode) &&
        (!c.mode    || c.mode === l.mode),
      );
      if (matchingLines.length === 0) continue;

      const matchingSets    = matchingLines.reduce((s, l) => s + l.sets, 0);
      const matchingTotal   = matchingLines.reduce((s, l) => s + l.lineTotal, 0);

      let discount = 0;
      if (p.kind === 'PACKAGE_DEAL' && c.minSets != null && c.fixedTotalPhp != null) {
        if (matchingSets >= c.minSets) {
          discount = Math.max(0, matchingTotal - Number(c.fixedTotalPhp));
        }
      } else if (p.kind === 'PERCENT_OFF' && c.percent != null) {
        discount = matchingTotal * (Number(c.percent) / 100);
      } else if (p.kind === 'FLAT_OFF' && c.flatPhp != null) {
        discount = c.perSet ? Number(c.flatPhp) * matchingSets : Number(c.flatPhp);
      } else if (p.kind === 'FREE_NTH' && c.everyN != null) {
        const freeSets = Math.floor(matchingSets / Number(c.everyN));
        const avgUnit  = matchingTotal / Math.max(1, matchingSets);
        discount = freeSets * avgUnit;
      }
      discount = Math.round(discount * 100) / 100;
      if (discount > 0) {
        applications.push({ code: p.code, name: p.name, discount });
        totalDiscount += discount;
      }
    }
    return { totalDiscount: Math.round(totalDiscount * 100) / 100, applications };
  }

  // ── Service Add-Ons (Sprint 8) ────────────────────────────────────────────

  async listAddOns(tenantId: string, includeInactive = false) {
    return this.prisma.laundryServiceAddOn.findMany({
      where:   { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createAddOn(
    tenantId: string,
    dto: {
      code: string; name: string; kind?: LaundryAddOnKind;
      amount: number; priority?: number; defaultOn?: boolean; isActive?: boolean;
    },
  ) {
    return this.prisma.laundryServiceAddOn.create({
      data: {
        tenantId,
        code:     dto.code.toUpperCase().replace(/\s+/g, '_'),
        name:     dto.name,
        kind:     (dto.kind ?? 'SURCHARGE') as LaundryAddOnKind,
        amount:   new Prisma.Decimal(dto.amount),
        priority: dto.priority ?? 100,
        defaultOn: dto.defaultOn ?? false,
        isActive:  dto.isActive ?? true,
      },
    });
  }

  async updateAddOn(
    tenantId: string,
    id: string,
    dto: Partial<{ name: string; amount: number; priority: number; defaultOn: boolean; isActive: boolean }>,
  ) {
    const a = await this.prisma.laundryServiceAddOn.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('Add-on not found.');
    return this.prisma.laundryServiceAddOn.update({
      where: { id },
      data: {
        ...(dto.name      !== undefined ? { name: dto.name } : {}),
        ...(dto.amount    !== undefined ? { amount: new Prisma.Decimal(dto.amount) } : {}),
        ...(dto.priority  !== undefined ? { priority: dto.priority } : {}),
        ...(dto.defaultOn !== undefined ? { defaultOn: dto.defaultOn } : {}),
        ...(dto.isActive  !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deleteAddOn(tenantId: string, id: string) {
    const a = await this.prisma.laundryServiceAddOn.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('Add-on not found.');
    // Soft-deactivate if any historical line in THIS tenant references it; else hard delete.
    // Tenant-scoped count to avoid cross-tenant existence leaks.
    const usage = await this.prisma.laundryOrderLineAddOn.count({
      where: { addOnId: id, line: { order: { tenantId } } },
    });
    if (usage > 0) {
      await this.prisma.laundryServiceAddOn.update({ where: { id }, data: { isActive: false } });
      return { ok: true, softDeleted: true };
    }
    await this.prisma.laundryServiceAddOn.delete({ where: { id } });
    return { ok: true, softDeleted: false };
  }
}
