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

  // ─── One-shot product transfer between branches (Sprint 19, owner) ─────
  // Decrements source branch inventory + increments destination atomically.
  // Logs an InventoryLog row at both branches so the audit trail is intact.
  // No DRAFT/SEND/RECEIVE state machine — most pharmacy transfers are
  // physical hand-carries between same-day branches.

  async transferProductBetweenBranches(
    tenantId: string,
    callerId: string,
    dto: { fromBranchId: string; toBranchId: string; productId: string; quantity: number; notes?: string },
  ) {
    if (dto.fromBranchId === dto.toBranchId) {
      throw new BadRequestException('Source and destination branches must differ.');
    }
    if (!dto.quantity || dto.quantity <= 0) {
      throw new BadRequestException('Quantity must be > 0.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Validate branches + product belong to tenant
      const [fromBranch, toBranch, product] = await Promise.all([
        tx.branch.findFirst({  where: { id: dto.fromBranchId, tenantId }, select: { id: true, name: true } }),
        tx.branch.findFirst({  where: { id: dto.toBranchId,   tenantId }, select: { id: true, name: true } }),
        tx.product.findFirst({ where: { id: dto.productId,    tenantId }, select: { id: true, name: true } }),
      ]);
      if (!fromBranch) throw new BadRequestException('Source branch does not belong to your tenant.');
      if (!toBranch)   throw new BadRequestException('Destination branch does not belong to your tenant.');
      if (!product)    throw new BadRequestException('Product does not belong to your tenant.');

      // Source must have enough stock
      const src = await tx.inventoryItem.findUnique({
        where:  { branchId_productId: { branchId: dto.fromBranchId, productId: dto.productId } },
        select: { id: true, quantity: true, avgCost: true },
      });
      const srcQty = src ? Number(src.quantity) : 0;
      if (srcQty < dto.quantity) {
        throw new BadRequestException({
          code:    'INSUFFICIENT_STOCK',
          message: `Source branch has only ${srcQty} of ${product.name}; cannot transfer ${dto.quantity}.`,
        });
      }

      const qty = new Prisma.Decimal(dto.quantity);
      const cost = src?.avgCost ?? null; // use source WAC if available

      // Source: capture before/after for the audit log, then decrement.
      const srcBefore = srcQty;
      const srcAfter  = srcBefore - dto.quantity;
      await tx.inventoryItem.update({
        where: { id: src!.id },
        data:  { quantity: { decrement: qty } },
      });

      // Increment destination (upsert for first-time receivers).
      // WAC re-blend at destination: (oldQty*oldAvg + qty*srcAvg) / (oldQty + qty)
      const dst = await tx.inventoryItem.findUnique({
        where:  { branchId_productId: { branchId: dto.toBranchId, productId: dto.productId } },
        select: { id: true, quantity: true, avgCost: true },
      });
      const dstBefore = dst ? Number(dst.quantity) : 0;
      const dstAfter  = dstBefore + dto.quantity;
      if (dst) {
        const oldQty = Number(dst.quantity);
        const oldAvg = dst.avgCost != null ? Number(dst.avgCost) : (cost != null ? Number(cost) : 0);
        const newQty = oldQty + dto.quantity;
        const srcAvg = cost != null ? Number(cost) : oldAvg;
        const newAvg = newQty > 0
          ? (oldQty * oldAvg + dto.quantity * srcAvg) / newQty
          : srcAvg;
        await tx.inventoryItem.update({
          where: { id: dst.id },
          data: {
            quantity: { increment: qty },
            avgCost:  new Prisma.Decimal(newAvg.toFixed(4)),
          },
        });
      } else {
        await tx.inventoryItem.create({
          data: {
            tenantId,
            branchId:  dto.toBranchId,
            productId: dto.productId,
            quantity:  qty,
            avgCost:   cost ?? undefined,
          },
        });
      }

      // Log both legs in InventoryLog for the audit trail. Reuse the
      // existing STOCK_OUT / STOCK_IN types (a separate TRANSFER_* enum
      // would require another migration; the note disambiguates).
      await tx.inventoryLog.createMany({
        data: [
          {
            tenantId, productId: dto.productId, branchId: dto.fromBranchId,
            type: 'STOCK_OUT' as any,
            quantity:       new Prisma.Decimal(-dto.quantity),
            quantityBefore: new Prisma.Decimal(srcBefore),
            quantityAfter:  new Prisma.Decimal(srcAfter),
            note: `Transfer OUT to ${toBranch.name}${dto.notes ? ` — ${dto.notes}` : ''}`,
            createdById: callerId,
          },
          {
            tenantId, productId: dto.productId, branchId: dto.toBranchId,
            type: 'STOCK_IN' as any,
            quantity:       new Prisma.Decimal(dto.quantity),
            quantityBefore: new Prisma.Decimal(dstBefore),
            quantityAfter:  new Prisma.Decimal(dstAfter),
            note: `Transfer IN from ${fromBranch.name}${dto.notes ? ` — ${dto.notes}` : ''}`,
            createdById: callerId,
          },
        ],
      });

      return {
        productId:    product.id,
        productName:  product.name,
        fromBranchId: fromBranch.id,
        fromBranchName: fromBranch.name,
        toBranchId:   toBranch.id,
        toBranchName: toBranch.name,
        quantity:     dto.quantity,
        at:           new Date().toISOString(),
      };
    });
  }

  // ─── Cross-branch inventory summary (Sprint 19, owner) ─────────────────
  // Returns one row per product × branch with current quantity, low-stock
  // threshold, plus a per-product expiry summary (earliest non-expired lot
  // expiry across all branches + count of lots expiring within 90 days).
  // Powers the "what do I have where" dashboard for multi-branch tenants.

  async crossBranchSummary(tenantId: string, opts?: { search?: string }) {
    const branches = await this.prisma.branch.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true },
    });

    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(opts?.search ? {
          OR: [
            { name:        { contains: opts.search, mode: 'insensitive' } },
            { genericName: { contains: opts.search, mode: 'insensitive' } },
            { brandName:   { contains: opts.search, mode: 'insensitive' } },
            { sku:         { contains: opts.search, mode: 'insensitive' } },
            { barcode:     { contains: opts.search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true, name: true, sku: true,
        genericName: true, brandName: true,
        drugClass: true, isRxRequired: true, isControlledDrug: true,
        unitOfMeasure: { select: { abbreviation: true } },
      },
      take: 1000, // hard cap to keep the dashboard quick
    });
    const productIds = products.map((p) => p.id);

    // Inventory rows indexed by (productId, branchId).
    const invRows = productIds.length
      ? await this.prisma.inventoryItem.findMany({
          where:  { productId: { in: productIds } },
          select: { productId: true, branchId: true, quantity: true, lowStockAlert: true },
        })
      : [];
    const invMap = new Map<string, Map<string, { qty: number; threshold: number | null }>>();
    for (const row of invRows) {
      let perProduct = invMap.get(row.productId);
      if (!perProduct) { perProduct = new Map(); invMap.set(row.productId, perProduct); }
      perProduct.set(row.branchId, {
        qty:       Number(row.quantity),
        threshold: row.lowStockAlert ?? null,
      });
    }

    // Lot expiry summary per product (across all branches; FDA-compliant view).
    const lots = productIds.length
      ? await this.prisma.productLot.findMany({
          where:  { tenantId, productId: { in: productIds }, isActive: true },
          select: { productId: true, branchId: true, expiresAt: true, quantity: true, lotNumber: true },
          orderBy: { expiresAt: 'asc' },
        })
      : [];
    const now = Date.now();
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const lotSummary = new Map<string, {
      earliestExpiry: Date | null;
      expiringSoon:   number;
      expired:        number;
      lots:           Array<{ branchId: string; lotNumber: string; expiresAt: string; quantity: number }>;
    }>();
    for (const lot of lots) {
      let s = lotSummary.get(lot.productId);
      if (!s) {
        s = { earliestExpiry: null, expiringSoon: 0, expired: 0, lots: [] };
        lotSummary.set(lot.productId, s);
      }
      const ts = lot.expiresAt.getTime();
      if (ts < now)                                  s.expired++;
      else if (ts - now < NINETY_DAYS_MS)            s.expiringSoon++;
      if (s.earliestExpiry == null || ts < s.earliestExpiry.getTime()) {
        s.earliestExpiry = lot.expiresAt;
      }
      s.lots.push({
        branchId:  lot.branchId,
        lotNumber: lot.lotNumber,
        expiresAt: lot.expiresAt.toISOString(),
        quantity:  Number(lot.quantity),
      });
    }

    // Build the rolled-up response. Each row carries quantities per branch
    // (sparse — branches with no row are explicitly absent so the UI can
    // render a "—" cell).
    return {
      branches,
      rows: products.map((p) => {
        const perBranch = invMap.get(p.id) ?? new Map();
        const summary   = lotSummary.get(p.id);
        const totalQty  = Array.from(perBranch.values()).reduce((sum, b) => sum + b.qty, 0);
        return {
          productId:        p.id,
          name:             p.name,
          sku:              p.sku,
          genericName:      p.genericName,
          brandName:        p.brandName,
          drugClass:        p.drugClass,
          isRxRequired:     p.isRxRequired,
          isControlledDrug: p.isControlledDrug,
          uom:              p.unitOfMeasure?.abbreviation ?? null,
          totalQty,
          // { branchId: { qty, threshold } } sparse map
          quantitiesByBranch: Object.fromEntries(
            Array.from(perBranch.entries()).map(([bid, info]) => [bid, info]),
          ),
          earliestExpiry: summary?.earliestExpiry?.toISOString() ?? null,
          expiringSoon:   summary?.expiringSoon ?? 0,
          expired:        summary?.expired ?? 0,
          lots:           summary?.lots ?? [],
        };
      }),
    };
  }

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

    // SECURITY H10 — bound `unitCost` against `product.costPrice`. Without
    // this, a BRANCH_MANAGER or WAREHOUSE_STAFF could STOCK_IN qty=1 at a
    // wildly inflated unitCost, poisoning the WAC `avgCost` upward — every
    // subsequent SALE_DEDUCTION would then drain inflated COGS, silently
    // hiding shrinkage. Meanwhile the INVENTORY_ADJUSTMENT accounting event
    // uses `product.costPrice` (not unitCost) so the GL doesn't show the
    // spike — books and ops diverge.
    //
    // We allow up to ±50% drift from costPrice without ceremony (real-world
    // suppliers change prices); beyond that, the operator must update the
    // product master costPrice first (audit-logged) and retry. STOCK_OUT /
    // ADJUSTMENT / write-off types skip this check — they don't update
    // avgCost anyway.
    if (
      quantity > 0 &&
      unitCost != null &&
      product.costPrice != null &&
      Number(product.costPrice) > 0
    ) {
      const baseline = Number(product.costPrice);
      const ratio = unitCost / baseline;
      if (ratio < 0.5 || ratio > 1.5) {
        throw new BadRequestException(
          `Unit cost ₱${unitCost.toFixed(2)} is more than 50% off the product master cost ` +
          `(₱${baseline.toFixed(2)}). Update the product's cost price first, then retry — this ` +
          `prevents accidental WAC poisoning. Ratio: ${(ratio * 100).toFixed(0)}%.`,
        );
      }
    }

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

  /**
   * Sprint 25 — Toggle FEFO/batch tracking on a raw material. Enforces the
   * Solo-tier `maxAdvancedInventoryItems` cap (Lite: 0, Standard: 10, Pro: -1).
   * When enabling, counts existing tracked items to ensure cap headroom.
   */
  async setRawMaterialLotTracking(tenantId: string, id: string, enabled: boolean) {
    const item = await this.prisma.rawMaterial.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Raw material not found');

    if (enabled) {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { planCode: true },
      });
      const { PLAN_FEATURES } = await import('@repo/shared-types');
      const cap = (PLAN_FEATURES as any)[tenant?.planCode ?? '']?.maxAdvancedInventoryItems ?? -1;
      if (cap === 0) {
        throw new BadRequestException(
          'Your plan does not include batch / expiry tracking. Upgrade to Solo Standard to enable on up to 10 items.',
        );
      }
      if (cap > 0) {
        const used = await this.prisma.rawMaterial.count({
          where: { tenantId, lotsTracked: true, isActive: true },
        });
        const usedInv = await this.prisma.inventoryItem.count({
          where: { tenantId, lotsTracked: true },
        });
        if (used + usedInv >= cap) {
          throw new BadRequestException(
            `Your plan caps batch / expiry tracking at ${cap} items. Upgrade to Solo Pro for unlimited tracking.`,
          );
        }
      }
    }

    return this.prisma.rawMaterial.update({
      where: { id },
      data:  { lotsTracked: enabled },
    });
  }

  async updateRawMaterial(tenantId: string, id: string, dto: Partial<CreateRawMaterialDto> & { isActive?: boolean; lowStockAlert?: number | null }) {
    const item = await this.prisma.rawMaterial.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Raw material not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.rawMaterial.update({
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

      // Sprint 8: when an ingredient's cost is manually edited, ripple the
      // change into every product that uses it. Same logic as the receipt
      // path so display + ledger stay aligned.
      if (dto.costPrice != null) {
        const affectedProducts = await tx.bomItem.findMany({
          where:    { rawMaterialId: id, product: { tenantId } },
          select:   { productId: true },
          distinct: ['productId'],
        });
        for (const { productId } of affectedProducts) {
          const allBom = await tx.bomItem.findMany({
            where:  { productId },
            select: { quantity: true, rawMaterial: { select: { costPrice: true } } },
          });
          const newProductCost = allBom.reduce(
            (sum, b) => sum + (b.rawMaterial?.costPrice != null ? Number(b.rawMaterial.costPrice) : 0) * Number(b.quantity),
            0,
          );
          await tx.product.update({
            where: { id: productId },
            data:  { costPrice: new Prisma.Decimal(newProductCost.toFixed(4)) },
          });
        }
      }

      return {
        ...updated,
        costPrice:     updated.costPrice     != null ? Number(updated.costPrice)     : null,
        lowStockAlert: updated.lowStockAlert != null ? Number(updated.lowStockAlert) : null,
      };
    });
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

        // Sprint 8: ripple the new WAC into every product that uses this
        // ingredient. RECIPE_BASED products' Product.costPrice is derived
        // from BOM × ingredient cost — when an ingredient's cost shifts,
        // every recipe that uses it must shift too. Without this, the
        // dashboard's gross-margin numbers and the "missing cost" warnings
        // drift away from reality between receipts.
        const affectedProducts = await tx.bomItem.findMany({
          where:  { rawMaterialId, product: { tenantId } },
          select: { productId: true },
          distinct: ['productId'],
        });
        for (const { productId } of affectedProducts) {
          const allBom = await tx.bomItem.findMany({
            where:  { productId },
            select: {
              quantity:    true,
              rawMaterial: { select: { costPrice: true } },
            },
          });
          const newProductCost = allBom.reduce(
            (sum, b) => sum + (b.rawMaterial?.costPrice != null ? Number(b.rawMaterial.costPrice) : 0) * Number(b.quantity),
            0,
          );
          await tx.product.update({
            where: { id: productId },
            data:  { costPrice: new Prisma.Decimal(newProductCost.toFixed(4)) },
          });
        }
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
            expirationDate:      dto.expirationDate ? new Date(dto.expirationDate) : null,
            purchaseOrderItemId: dto.purchaseOrderItemId ?? null,
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
