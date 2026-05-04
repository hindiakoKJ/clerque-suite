import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { Prisma, InventoryLogType } from '@prisma/client';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { SetThresholdDto } from './dto/set-threshold.dto';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { ReceiveRawMaterialDto } from './dto/receive-raw-material.dto';

export { AdjustStockDto, SetThresholdDto, CreateRawMaterialDto, ReceiveRawMaterialDto };

/** A unified stock-movement entry returned by getAllMovements(). */
export interface StockMovement {
  id:                string;
  kind:              'PRODUCT' | 'RAW_MATERIAL';
  occurredAt:        string;
  type:              string;
  itemName:          string;
  unit:              string | null;
  quantity:          number;       // signed: positive in, negative out
  quantityBefore:    number | null;
  quantityAfter:     number | null;
  branchId:          string | null;
  reason:            string | null;
  reference:         string | null; // order # for sales, supplier ref for receipts
  createdById:       string | null;
  createdByName:     string | null;
  paymentMethod:     string | null;
  totalValue:        number | null;
  accountingEventId: string | null;
}

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private periods: AccountingPeriodsService,
  ) {}

  // ─── List inventory for a branch ─────────────────────────────────────────

  async list(
    tenantId: string,
    branchId: string,
    opts: { page?: number; search?: string; lowStockOnly?: boolean } = {},
  ) {
    const { page = 1, search, lowStockOnly } = opts;
    const take = 50;
    const skip = (page - 1) * take;

    const where: Prisma.InventoryItemWhereInput = {
      tenantId,
      branchId,
      ...(search ? {
        product: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku:  { contains: search, mode: 'insensitive' } },
          ],
        },
      } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.inventoryItem.count({ where }),
      this.prisma.inventoryItem.findMany({
        where,
        include: {
          product: {
            select: {
              id: true, name: true, sku: true,
              isVatable: true, isActive: true, costPrice: true,
              category: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ product: { name: 'asc' } }],
        skip,
        take,
      }),
    ]);

    const rows = items.map((item) => ({
      ...item,
      quantity:   Number(item.quantity),
      totalValue: item.product.costPrice
        ? Number(item.quantity) * Number(item.product.costPrice)
        : null,
      isLowStock: item.lowStockAlert != null && Number(item.quantity) <= item.lowStockAlert,
    }));

    return {
      data:  lowStockOnly ? rows.filter((r) => r.isLowStock) : rows,
      total,
      page,
      pages: Math.ceil(total / take),
    };
  }

  // ─── Low-stock items ──────────────────────────────────────────────────────

  async getLowStock(tenantId: string, branchId: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, branchId },
      include: {
        product: { select: { id: true, name: true, sku: true } },
      },
    });
    return items
      .filter((i) => i.lowStockAlert != null && Number(i.quantity) <= i.lowStockAlert)
      .map((i) => ({
        ...i,
        quantity: Number(i.quantity),
        isLowStock: true,
      }));
  }

  // ─── Branch ownership guard ───────────────────────────────────────────────

  /**
   * Guard: verify that `branchId` is owned by `tenantId`.
   * Prevents cross-tenant branch injection in client-supplied DTOs.
   */
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

  // ─── Adjust stock ─────────────────────────────────────────────────────────

  async adjust(tenantId: string, createdById: string, dto: AdjustStockDto) {
    const { productId, branchId, quantity, type, reason, note, unitCost } = dto;

    // Verify product belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Verify branch belongs to tenant (CRITICAL-2 fix — prevents cross-tenant branch injection)
    await this.assertBranchBelongsToTenant(tenantId, branchId);

    return this.prisma.$transaction(async (tx) => {
      // Upsert inventory item
      const existing = await tx.inventoryItem.findUnique({
        where: { branchId_productId: { branchId, productId } },
      });

      const quantityBefore = existing ? Number(existing.quantity) : 0;
      const quantityAfter = quantityBefore + quantity;
      const oldAvgCost = existing?.avgCost ? Number(existing.avgCost) : null;

      if (quantityAfter < 0) {
        throw new BadRequestException(
          `Stock would go negative (current: ${quantityBefore}, adjustment: ${quantity})`,
        );
      }

      // ── Moving-Average Cost recompute ──────────────────────────────────
      // Only run on positive-qty receipts where the operator gave us a
      // unit cost (e.g. supplier delivery). Stockouts, write-offs and
      // adjustments don't change avgCost.
      let newAvgCost: number | null = oldAvgCost;
      if (quantity > 0 && unitCost != null && unitCost >= 0) {
        if (quantityBefore <= 0 || oldAvgCost == null) {
          // First-ever costed receipt or restocking from zero — avgCost = unitCost
          newAvgCost = unitCost;
        } else {
          // Weighted average: (oldQty × oldAvg + receivedQty × receivedCost) / total
          newAvgCost = (quantityBefore * oldAvgCost + quantity * unitCost) / quantityAfter;
        }
      }
      // If quantity drops to exactly 0, reset avgCost to null so the next
      // receipt can establish a fresh baseline (avoids carrying stale costs)
      if (quantityAfter === 0) newAvgCost = null;

      const item = await tx.inventoryItem.upsert({
        where: { branchId_productId: { branchId, productId } },
        create: {
          tenantId,
          branchId,
          productId,
          quantity: new Prisma.Decimal(quantityAfter),
          avgCost:  newAvgCost != null ? new Prisma.Decimal(newAvgCost) : null,
        },
        update: {
          quantity: new Prisma.Decimal(quantityAfter),
          avgCost:  newAvgCost != null ? new Prisma.Decimal(newAvgCost) : null,
        },
      });

      // Create movement log
      await tx.inventoryLog.create({
        data: {
          tenantId,
          branchId,
          productId,
          type: type as InventoryLogType,
          quantity: new Prisma.Decimal(quantity),
          quantityBefore: new Prisma.Decimal(quantityBefore),
          quantityAfter: new Prisma.Decimal(quantityAfter),
          reason,
          note,
          createdById,
        },
      });

      // ── Accounting event — always fired so the ledger stays in sync
      // regardless of whether the user has Ledger app access (tier gating
      // controls visibility only; accounting records are always created).
      // Journal processor uses cost value; if costPrice is null the event
      // will be marked SYNCED (skipped) without posting a zero-value JE.
      const costPrice = product.costPrice ? Number(product.costPrice) : 0;
      const totalValue = Math.abs(quantity) * costPrice;
      await tx.accountingEvent.create({
        data: {
          tenantId,
          type: 'INVENTORY_ADJUSTMENT',
          status: 'PENDING',
          payload: {
            productId,
            productName: product.name,
            branchId,
            adjustmentType: type,  // INITIAL | STOCK_IN | STOCK_OUT | ADJUSTMENT
            quantity,
            quantityBefore,
            quantityAfter,
            costPrice,
            totalValue,
            reason: reason ?? null,
          },
        },
      });

      return { ...item, quantity: Number(item.quantity) };
    });
  }

  // ─── Set low-stock threshold ──────────────────────────────────────────────

  async setThreshold(tenantId: string, dto: SetThresholdDto) {
    const { productId, branchId, lowStockAlert } = dto;

    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Verify branch belongs to tenant (CRITICAL-2 fix)
    await this.assertBranchBelongsToTenant(tenantId, branchId);

    const item = await this.prisma.inventoryItem.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: {
        tenantId,
        branchId,
        productId,
        quantity: new Prisma.Decimal(0),
        lowStockAlert,
      },
      update: { lowStockAlert },
    });

    return { ...item, quantity: Number(item.quantity) };
  }

  // ─── Movement log for one product ────────────────────────────────────────

  async getLogs(tenantId: string, productId: string, branchId: string, limit = 50) {
    const logs = await this.prisma.inventoryLog.findMany({
      where: { tenantId, productId, branchId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return logs.map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      quantityBefore: Number(l.quantityBefore),
      quantityAfter: Number(l.quantityAfter),
    }));
  }

  /**
   * Combined stock-movement log across both finished goods (InventoryLog) and
   * raw material receipts (sourced from AccountingEvents of type
   * INVENTORY_ADJUSTMENT with kind='RAW_MATERIAL_RECEIPT').
   *
   * Returns a unified, chronologically-sorted list with a consistent shape so
   * the Stock Movements page can render product and ingredient activity in one
   * timeline.
   */
  async getAllMovements(
    tenantId: string,
    opts: {
      branchId?: string;
      from?:    string;
      to?:      string;
      kind:     'PRODUCT' | 'RAW_MATERIAL' | 'ALL';
      limit:    number;
    },
  ): Promise<StockMovement[]> {
    const { branchId, from, to, kind, limit } = opts;
    const fromDate = from ? new Date(from) : undefined;
    const toDate   = to   ? new Date(to)   : undefined;

    const results: StockMovement[] = [];

    // ── Finished-goods movements (InventoryLog) ────────────────────────────
    if (kind === 'PRODUCT' || kind === 'ALL') {
      const productLogs = await this.prisma.inventoryLog.findMany({
        where: {
          tenantId,
          ...(branchId ? { branchId } : {}),
          ...(fromDate || toDate
            ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
            : {}),
        },
        include: {
          product: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      // Resolve cashier names in one batch (no Prisma relation defined for createdById)
      const userIds = [...new Set(productLogs.map((l) => l.createdById).filter(Boolean))] as string[];
      const users = userIds.length
        ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [];
      const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

      for (const log of productLogs) {
        results.push({
          id:             log.id,
          kind:           'PRODUCT',
          occurredAt:     log.createdAt.toISOString(),
          type:           log.type,
          itemName:       log.product?.name ?? 'Unknown product',
          unit:           null,
          quantity:       Number(log.quantity),
          quantityBefore: Number(log.quantityBefore),
          quantityAfter:  Number(log.quantityAfter),
          branchId:       log.branchId,
          reason:         log.reason,
          reference:      log.referenceId,
          createdById:    log.createdById ?? null,
          createdByName:  log.createdById ? (userMap[log.createdById] ?? null) : null,
          paymentMethod:  null,
          totalValue:     null,
          accountingEventId: null,
        });
      }
    }

    // ── Raw-material receipts (sourced from AccountingEvent payloads) ──────
    if (kind === 'RAW_MATERIAL' || kind === 'ALL') {
      const events = await this.prisma.accountingEvent.findMany({
        where: {
          tenantId,
          type: 'INVENTORY_ADJUSTMENT',
          ...(fromDate || toDate
            ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      for (const ev of events) {
        const p = ev.payload as Record<string, unknown> | null;
        if (!p) continue;
        if (p['kind'] !== 'RAW_MATERIAL_RECEIPT') continue;
        if (branchId && p['branchId'] && p['branchId'] !== branchId) continue;

        const occurredAt = (typeof p['receivedAt'] === 'string' ? p['receivedAt'] : ev.createdAt.toISOString());

        results.push({
          id:             ev.id,
          kind:           'RAW_MATERIAL',
          occurredAt,
          type:           'STOCK_IN',
          itemName:       String(p['rawMaterialName'] ?? p['productName'] ?? 'Ingredient'),
          unit:           typeof p['unit'] === 'string' ? p['unit'] : null,
          quantity:       Number(p['quantity'] ?? 0),
          quantityBefore: null,
          quantityAfter:  null,
          branchId:       typeof p['branchId'] === 'string' ? p['branchId'] : null,
          reason:         typeof p['note'] === 'string' ? p['note'] : null,
          reference:      typeof p['referenceNumber'] === 'string' ? p['referenceNumber'] : null,
          createdById:    null,
          createdByName:  null,
          paymentMethod:  typeof p['paymentMethod'] === 'string' ? p['paymentMethod'] : null,
          totalValue:     Number(p['totalValue'] ?? 0),
          accountingEventId: ev.id,
        });
      }
    }

    // Merge and sort by occurredAt desc, then cap to the requested limit.
    results.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return results.slice(0, limit);
  }

  // ─── Raw Materials (F&B ingredient library) ───────────────────────────────

  async listRawMaterials(tenantId: string, includeInactive = false, branchId?: string) {
    const items = await this.prisma.rawMaterial.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
      ...(branchId
        ? { include: { inventory: { where: { branchId }, select: { quantity: true } } } }
        : {}),
    });
    return items.map((m) => {
      const invRow   = 'inventory' in m && Array.isArray(m.inventory) ? m.inventory[0] : undefined;
      const stockQty = invRow != null ? Number(invRow.quantity) : null;
      const alert    = m.lowStockAlert != null ? Number(m.lowStockAlert) : null;
      return {
        ...m,
        costPrice:     m.costPrice     != null ? Number(m.costPrice)     : null,
        lowStockAlert: alert,
        stockQty,
        isLowStock: stockQty != null && alert != null && stockQty <= alert,
      };
    });
  }

  async createRawMaterial(tenantId: string, dto: CreateRawMaterialDto) {
    const item = await this.prisma.rawMaterial.create({
      data: {
        tenantId,
        name: dto.name,
        unit: dto.unit,
        costPrice: dto.costPrice != null ? new Prisma.Decimal(dto.costPrice) : undefined,
      },
    });
    return { ...item, costPrice: item.costPrice != null ? Number(item.costPrice) : null };
  }

  async updateRawMaterial(tenantId: string, id: string, dto: Partial<CreateRawMaterialDto> & { isActive?: boolean; lowStockAlert?: number | null }) {
    const item = await this.prisma.rawMaterial.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Raw material not found');

    const updated = await this.prisma.rawMaterial.update({
      where: { id },
      data: {
        ...(dto.name          != null ? { name:          dto.name }                              : {}),
        ...(dto.unit          != null ? { unit:          dto.unit }                              : {}),
        ...(dto.costPrice     != null ? { costPrice:     new Prisma.Decimal(dto.costPrice) }     : {}),
        ...(dto.isActive      != null ? { isActive:      dto.isActive }                          : {}),
        // null explicitly clears the alert; undefined means "not provided — leave alone"
        ...(dto.lowStockAlert !== undefined
          ? { lowStockAlert: dto.lowStockAlert != null ? new Prisma.Decimal(dto.lowStockAlert) : null }
          : {}),
      },
    });
    return {
      ...updated,
      costPrice:     updated.costPrice     != null ? Number(updated.costPrice)     : null,
      lowStockAlert: updated.lowStockAlert != null ? Number(updated.lowStockAlert) : null,
    };
  }

  /**
   * Add incoming stock for a raw material (supplier delivery).
   *
   * Three things happen atomically:
   *   1. RawMaterialInventory.quantity is incremented at the branch level.
   *   2. Weighted-Average Cost (WAC) is updated if the receipt carries a unit cost.
   *   3. A queued AccountingEvent is created so the journal posts a stock-receipt
   *      entry: Dr 1050 Inventory / Cr (Cash | AP | Owner's Capital) based on
   *      the receipt's `paymentMethod`.
   *
   * Period lock is enforced — backdating into a closed period is rejected.
   */
  async receiveRawMaterial(tenantId: string, rawMaterialId: string, dto: ReceiveRawMaterialDto) {
    const material = await this.prisma.rawMaterial.findFirst({
      where: { id: rawMaterialId, tenantId },
    });
    if (!material) throw new NotFoundException('Raw material not found');

    // Verify branch belongs to tenant
    await this.assertBranchBelongsToTenant(tenantId, dto.branchId);

    // Resolve receipt date — defaults to now, allows backdating to invoice date.
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new BadRequestException('receivedAt is not a valid date.');
    }

    // Period-lock check before doing any writes.
    await this.periods.assertDateIsOpen(tenantId, receivedAt);

    const paymentMethod = dto.paymentMethod ?? 'CASH';

    // Sprint 4B — CREDIT receipts require a vendor so the resulting AP Bill
    // can be tracked. Verify ownership of the vendor up-front to avoid
    // cross-tenant injection.
    if (paymentMethod === 'CREDIT') {
      if (!dto.vendorId) {
        throw new BadRequestException(
          'A vendor is required when paying on credit. Pick a supplier or switch to cash.',
        );
      }
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: dto.vendorId, tenantId },
        select: { id: true },
      });
      if (!vendor) {
        throw new BadRequestException('Vendor not found in your organization.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.rawMaterialInventory.findUnique({
        where: { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId } },
      });

      const qtyBefore = existing ? Number(existing.quantity) : 0;
      const qtyAfter  = qtyBefore + dto.quantity;

      await tx.rawMaterialInventory.upsert({
        where: { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId } },
        create: {
          tenantId,
          branchId: dto.branchId,
          rawMaterialId,
          quantity: new Prisma.Decimal(qtyAfter),
        },
        update: { quantity: new Prisma.Decimal(qtyAfter) },
      });

      // WAC cost update: if new cost price provided, update material cost
      let unitCost = material.costPrice ? Number(material.costPrice) : 0;
      if (dto.costPrice != null) {
        const oldCost    = unitCost;
        const totalOldValue  = qtyBefore * oldCost;
        const totalNewValue  = dto.quantity * dto.costPrice;
        const newWac = qtyAfter > 0
          ? (totalOldValue + totalNewValue) / qtyAfter
          : dto.costPrice;

        await tx.rawMaterial.update({
          where: { id: rawMaterialId },
          data: { costPrice: new Prisma.Decimal(newWac) },
        });
        unitCost = dto.costPrice; // value this delivery at its own cost
      }

      // Total value for the journal entry = (this delivery's qty) × (unit cost).
      // We use the delivery cost (or current WAC if no cost specified) — NOT the
      // post-WAC blended cost — so the journal value matches the actual money
      // changing hands today.
      const totalValue = dto.quantity * unitCost;

      // Sprint 4A — always create a Lot record on receive, regardless of the
      // tenant's valuation method. WAC tenants ignore lots (their COGS still
      // averages via RawMaterial.costPrice); FIFO tenants drain lots in
      // receivedAt order on consumption. Always-creating decouples the
      // valuation choice from the data model.
      if (dto.quantity > 0) {
        await tx.rawMaterialLot.create({
          data: {
            tenantId,
            branchId:        dto.branchId,
            rawMaterialId,
            qtyReceived:     new Prisma.Decimal(dto.quantity),
            qtyRemaining:    new Prisma.Decimal(dto.quantity),
            unitCost:        new Prisma.Decimal(unitCost),
            receivedAt,
            referenceNumber: dto.referenceNumber ?? null,
            paymentMethod:   paymentMethod,
          },
        });
      }

      // Queue accounting event — only if there's a value to record.
      // Zero-cost receipts (free samples, no cost set) are skipped at journal time.
      if (totalValue > 0) {
        await tx.accountingEvent.create({
          data: {
            tenantId,
            type: 'INVENTORY_ADJUSTMENT',
            status: 'PENDING',
            payload: {
              kind:           'RAW_MATERIAL_RECEIPT',
              rawMaterialId,
              rawMaterialName: material.name,
              unit:           material.unit,
              quantity:       dto.quantity,        // positive — stock IN
              unitCost,
              totalValue,
              paymentMethod,
              receivedAt:     receivedAt.toISOString(),
              referenceNumber: dto.referenceNumber ?? null,
              note:           dto.note ?? null,
              branchId:       dto.branchId,
              // Legacy fields the existing journal handler reads
              productName:    material.name,
              adjustmentType: 'RAW_MATERIAL_RECEIPT',
              reason:         dto.note ?? dto.referenceNumber ?? null,
            } as unknown as Prisma.JsonObject,
          },
        });
      }

      // Sprint 4B — when paying on credit, create a formal AP Bill so the
      // tenant can pay it later through /ledger/ap/bills + /ap/payments.
      // The journal entry above already credits 2010 Accounts Payable
      // (general ledger); this Bill record is the SUB-ledger that lets us
      // age the obligation by vendor and match payments to specific bills.
      if (paymentMethod === 'CREDIT' && totalValue > 0 && dto.vendorId) {
        const termsDays = dto.termsDays ?? 30;
        const dueDate   = new Date(receivedAt.getTime() + termsDays * 24 * 60 * 60 * 1000);

        // Generate a tenant-scoped bill number. Cheap counter — find max
        // and increment. Race-safe enough because we're inside the receive
        // transaction; the @@unique([tenantId, billNumber]) index is the
        // final guard if two cashiers receive simultaneously.
        const lastBill = await tx.aPBill.findFirst({
          where:   { tenantId },
          orderBy: { createdAt: 'desc' },
          select:  { billNumber: true },
        });
        const nextNum = lastBill?.billNumber
          ? (parseInt(lastBill.billNumber.replace(/\D/g, ''), 10) || 0) + 1
          : 1;
        const billNumber = `BILL-${String(nextNum).padStart(6, '0')}`;

        await tx.aPBill.create({
          data: {
            tenantId,
            branchId:      dto.branchId,
            billNumber,
            vendorBillRef: dto.referenceNumber ?? null,
            reference:     dto.referenceNumber ?? null,
            vendorId:      dto.vendorId,
            billDate:      receivedAt,
            postingDate:   receivedAt,
            dueDate,
            termsDays,
            subtotal:      new Prisma.Decimal(totalValue),
            vatAmount:     new Prisma.Decimal(0),
            whtAmount:     new Prisma.Decimal(0),
            totalAmount:   new Prisma.Decimal(totalValue),
            paidAmount:    new Prisma.Decimal(0),
            balanceAmount: new Prisma.Decimal(totalValue),
            status:        'OPEN',
            description:   `Stock receipt: ${dto.quantity} ${material.unit} ${material.name}`,
            notes:         dto.note ?? null,
            createdById:   'system-receive',
          },
        });
      }

      return {
        rawMaterialId,
        branchId: dto.branchId,
        quantityBefore: qtyBefore,
        quantityAfter: qtyAfter,
        quantity: dto.quantity,
        receivedAt: receivedAt.toISOString(),
        paymentMethod,
        totalValue,
      };
    });
  }

  /** Get raw-material stock levels for a branch */
  async listRawMaterialStock(tenantId: string, branchId: string) {
    const stocks = await this.prisma.rawMaterialInventory.findMany({
      where: { tenantId, branchId },
      include: {
        rawMaterial: { select: { id: true, name: true, unit: true, costPrice: true, isActive: true } },
      },
      orderBy: { rawMaterial: { name: 'asc' } },
    });
    return stocks.map((s) => ({
      ...s,
      quantity: Number(s.quantity),
      costPrice: s.rawMaterial.costPrice != null ? Number(s.rawMaterial.costPrice) : null,
      totalValue: s.rawMaterial.costPrice != null
        ? Number(s.quantity) * Number(s.rawMaterial.costPrice)
        : null,
    }));
  }
}
