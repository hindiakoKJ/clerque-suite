import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LaundryServiceType, LaundryPricingMode, LaundryOrderStatus, BusinessType, Prisma,
  LaundryServiceCode, LaundryServiceMode, LaundryMachineKind, LaundryMachineStatus,
  LaundryMachineLineStatus, LaundryPromoKind,
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

  /** Upsert a single price row for (service, mode). */
  async setServicePrice(
    tenantId: string,
    serviceCode: LaundryServiceCode,
    mode: LaundryServiceMode,
    unitPrice: number,
    isActive = true,
  ) {
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
          include: {
            order: { select: { id: true, claimNumber: true } },
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
    return this.prisma.laundryMachine.update({ where: { id }, data: { status } });
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
      lines: Array<{
        serviceCode: LaundryServiceCode;
        mode:        LaundryServiceMode;
        sets:        number;
        weightKg?:   number;
        notes?:      string;
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

      // Compute service line subtotals.
      const serviceLines = dto.lines.map((l) => {
        const unit = priceMap.get(priceKey(l.serviceCode, l.mode));
        if (unit == null) {
          throw new BadRequestException(`No price set for ${l.serviceCode} (${l.mode}). Configure under Settings → Laundry.`);
        }
        const lineTotal = Math.round(unit * l.sets * 100) / 100;
        return { ...l, unitPrice: unit, lineTotal };
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

      // Promo evaluation (best-fit) — basic implementation; can be expanded.
      const promoDiscount = await this.evaluatePromos(tx, tenantId, serviceLines);

      const grossTotal = serviceSubtotal + productSubtotal;
      const netTotal   = Math.max(0, Math.round((grossTotal - promoDiscount.totalDiscount) * 100) / 100);

      // Generate claim number (reuse existing helper).
      const claimNumber = await this.nextClaimNumber(tx, tenantId);

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
          lines: {
            create: serviceLines.map((l) => ({
              serviceCode: l.serviceCode,
              mode:        l.mode,
              sets:        l.sets,
              unitPrice:   new Prisma.Decimal(l.unitPrice),
              lineTotal:   new Prisma.Decimal(l.lineTotal),
              weightKg:    l.weightKg != null ? new Prisma.Decimal(l.weightKg) : null,
              notes:       l.notes ?? null,
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
          lines:             { include: { machine: { select: { id: true, code: true, kind: true } } } },
          productLines:      { include: { product: { select: { id: true, name: true } } } },
          promoApplications: true,
          items:             true,
        },
      });

      return order;
    });
  }

  // ── Machine assignment + state transitions ────────────────────────────────

  async assignMachine(tenantId: string, lineId: string, machineId: string) {
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
      await tx.laundryMachine.update({ where: { id: machineId }, data: { status: 'RUNNING' } });
      return tx.laundryOrderLine.update({
        where: { id: lineId },
        data:  { machineId, machineStatus: 'RUNNING', startedAt: new Date() },
      });
    });
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
    const p = await this.prisma.laundryPromo.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('Promo not found.');
    return this.prisma.laundryPromo.update({ where: { id }, data: { isActive } });
  }

  async deletePromo(tenantId: string, id: string) {
    const p = await this.prisma.laundryPromo.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('Promo not found.');
    await this.prisma.laundryPromo.delete({ where: { id } });
    return { ok: true };
  }

  // ── Promo evaluation engine (basic) ───────────────────────────────────────

  private async evaluatePromos(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lines: Array<{ serviceCode: LaundryServiceCode; mode: LaundryServiceMode; sets: number; unitPrice: number; lineTotal: number }>,
  ): Promise<{ totalDiscount: number; applications: Array<{ code: string; name: string; discount: number }> }> {
    const now = new Date();
    const dow = now.getUTCDay();
    const hour = now.getUTCHours() + 8; // crude UTC+8 for PH

    const promos = await tx.laundryPromo.findMany({
      where: {
        tenantId, isActive: true,
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [{ OR: [{ validTo: null }, { validTo: { gte: now } }] }],
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
}
