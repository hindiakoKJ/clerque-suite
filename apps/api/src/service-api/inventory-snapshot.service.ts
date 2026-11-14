import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { usedByDay } from '../ingredient-reports/daily-usage';
import { wasLeftAlone } from '../warehouse/newer-count';
import { manilaDay, manilaIso, manilaWindow, qty4, requireDay, requireId } from './format';

/**
 * GET /service/inventory/snapshot -- everything an inventory reviewer needs
 * for one branch and one range of days, in one answer, read from the same
 * records the stock screens and the daily usage sheet read.
 *
 * Two kinds of item, as Clerque keeps them:
 *   raw      an ingredient or supply (RawMaterial, stock in RawMaterialInventory)
 *   product  a finished good with its own stock (InventoryItem; itemId is the product id)
 *
 * Movements, per kind:
 *   product  InventoryLog, as written (qtyBefore/qtyAfter included).
 *   raw      Clerque keeps no single log for ingredients; the timeline is
 *            rebuilt from what each movement leaves behind, like the
 *            ingredient movements report: positive lots (STOCK_IN, or
 *            TRANSFER_IN when the lot is a transfer's), a write-off's
 *            negative marker lot (WRITE_OFF), transfers sent (TRANSFER_OUT),
 *            posted counts' variances (COUNT) and what prep batches took
 *            (STOCK_OUT). qtyBefore/qtyAfter are null: nothing records them.
 *            What sales took is `usage`, per day, through the recipe walk.
 * Quantities are signed: + arrived on the shelf, - left it.
 *
 * Quantities on items and lots are what is on hand NOW; `asOf` says when
 * they were read. The range bounds the movements, usage, day balances and
 * counts.
 */

/** A range longer than this is refused: a quarter is the most a review needs. */
const MAX_DAYS = 93;
const DAY_MS = 24 * 60 * 60 * 1000;

type Kind = 'raw' | 'product';

export interface SnapshotMovement {
  id: string; itemId: string; kind: Kind; type: string;
  qty: string; qtyBefore: string | null; qtyAfter: string | null; unitCost: string | null;
  at: string; reason: string | null; reference: string | null; by: string | null;
}

@Injectable()
export class InventorySnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(tenantId: string, query: { branchId?: unknown; from?: unknown; to?: unknown }, now: Date = new Date()) {
    const branchId = requireId(query.branchId, 'branchId');
    const from = requireDay(query.from, 'from');
    const to = requireDay(query.to, 'to');
    if (to < from) throw new BadRequestException('to is before from.');
    const { start, end } = manilaWindow(from, to);
    if ((end.getTime() - start.getTime()) / DAY_MS > MAX_DAYS) {
      throw new BadRequestException(`Ask for at most ${MAX_DAYS} days at a time.`);
    }
    const inWindow = { gte: start, lt: end };

    // The branch must be this tenant's. Another tenant's branch reads as
    // "not found", so a key cannot even learn that it exists.
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { id: true, name: true },
    });
    if (!branch) throw new NotFoundException('Branch not found.');

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, businessName: true, inventoryMode: true, valuationMethod: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    // ── Items ──────────────────────────────────────────────────────────────
    const [materials, onHand, products] = await Promise.all([
      this.prisma.rawMaterial.findMany({
        where: {
          tenantId,
          // Inactive ones only while this branch still holds some.
          OR: [{ isActive: true }, { inventory: { some: { branchId, quantity: { not: 0 } } } }],
        },
        select: {
          id: true, name: true, unit: true, category: true, costPrice: true,
          lowStockAlert: true, lotsTracked: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.rawMaterialInventory.findMany({
        where: { tenantId, branchId },
        select: { rawMaterialId: true, quantity: true },
      }),
      this.prisma.inventoryItem.findMany({
        where: { tenantId, branchId },
        select: {
          id: true, productId: true, quantity: true, avgCost: true, lowStockAlert: true, lotsTracked: true,
          product: {
            select: {
              name: true, sku: true, costPrice: true,
              category: { select: { name: true } },
              unitOfMeasure: { select: { abbreviation: true } },
            },
          },
        },
      }),
    ]);
    const qtyByMaterial = new Map(onHand.map((r) => [r.rawMaterialId, r.quantity]));

    const items = [
      ...materials.map((m) => ({
        kind: 'raw' as const,
        id: m.id,
        sku: null as string | null,
        name: m.name,
        uom: m.unit,
        qty: qty4(qtyByMaterial.get(m.id) ?? 0),
        avgCost: qty4(m.costPrice),
        lowStockAlert: qty4(m.lowStockAlert),
        category: m.category as string | null,
        lotsTracked: m.lotsTracked,
      })),
      ...products.map((p) => ({
        kind: 'product' as const,
        id: p.productId,
        sku: p.product?.sku ?? null,
        name: p.product?.name ?? 'Product',
        uom: p.product?.unitOfMeasure?.abbreviation ?? 'pc',
        qty: qty4(p.quantity),
        avgCost: qty4(p.avgCost ?? p.product?.costPrice ?? null),
        lowStockAlert: p.lowStockAlert != null ? qty4(p.lowStockAlert) : null,
        category: p.product?.category?.name ?? null,
        lotsTracked: p.lotsTracked,
      })),
    ];

    // ── Lots: still holding stock, or received in the range ────────────────
    const [rawLots, productLots] = await Promise.all([
      this.prisma.rawMaterialLot.findMany({
        where: {
          tenantId, branchId, qtyReceived: { gt: 0 },
          OR: [{ qtyRemaining: { gt: 0 } }, { receivedAt: inWindow }],
        },
        select: {
          rawMaterialId: true, qtyReceived: true, qtyRemaining: true, unitCost: true,
          receivedAt: true, expirationDate: true, referenceNumber: true,
        },
        orderBy: { receivedAt: 'asc' },
      }),
      this.prisma.inventoryLot.findMany({
        where: {
          tenantId, inventoryItem: { branchId }, qtyReceived: { gt: 0 },
          OR: [{ qtyRemaining: { gt: 0 } }, { receivedAt: inWindow }],
        },
        select: {
          qtyReceived: true, qtyRemaining: true, unitCost: true, receivedAt: true,
          expirationDate: true, referenceNumber: true, inventoryItem: { select: { productId: true } },
        },
        orderBy: { receivedAt: 'asc' },
      }),
    ]);
    const lots = [
      ...rawLots.map((l) => ({
        itemId: l.rawMaterialId, kind: 'raw' as const,
        qtyReceived: qty4(l.qtyReceived), qtyRemaining: qty4(l.qtyRemaining), unitCost: qty4(l.unitCost),
        receivedAt: manilaIso(l.receivedAt), expiresOn: manilaDay(l.expirationDate), reference: l.referenceNumber,
      })),
      ...productLots.map((l) => ({
        itemId: l.inventoryItem.productId, kind: 'product' as const,
        qtyReceived: qty4(l.qtyReceived), qtyRemaining: qty4(l.qtyRemaining), unitCost: qty4(l.unitCost),
        receivedAt: manilaIso(l.receivedAt), expiresOn: manilaDay(l.expirationDate), reference: l.referenceNumber,
      })),
    ];

    // ── Movements ──────────────────────────────────────────────────────────
    const movements = await this.movements(tenantId, branchId, start, end);

    // ── Usage: what the recipes say the day's orders took ──────────────────
    // Sold plus made-then-voided ("wasted" in the daily sheet): both left the
    // shelf through a recipe. Prep batches and write-offs are movements.
    const daily = await usedByDay(this.prisma, tenantId, branchId, start, end);
    const usage = daily.days.flatMap((d) =>
      d.rows
        .filter((r) => r.sold + r.wasted > 0)
        .map((r) => ({ itemId: r.rawMaterialId, day: d.day, expectedQty: qty4(new Prisma.Decimal(r.sold).plus(r.wasted)) })),
    );

    // ── Closing balances saved at each day's close ─────────────────────────
    const balances = await this.prisma.stockDayBalance.findMany({
      where: { tenantId, branchId, day: { gte: from, lte: to } },
      select: { rawMaterialId: true, day: true, endingQty: true, takenAt: true },
      orderBy: [{ day: 'asc' }, { rawMaterialId: 'asc' }],
    });
    const dayBalances = balances.map((b) => ({
      itemId: b.rawMaterialId, day: b.day, endingQty: qty4(b.endingQty),
      // Clerque does not record who saved a closing balance (the close job or a person).
      takenAt: manilaIso(b.takenAt), by: null as string | null,
    }));

    // ── Counts: opened, recorded or posted in the range, plus any still open ─
    const countRows = await this.prisma.cycleCount.findMany({
      where: {
        tenantId, branchId,
        OR: [{ createdAt: inWindow }, { postedAt: inWindow }, { status: { in: ['OPEN', 'RECORDED'] } }],
      },
      select: {
        id: true, countNumber: true, status: true, createdAt: true, postedAt: true,
        startedById: true, postedById: true,
        lines: { select: { rawMaterialId: true, expectedQty: true, countedQty: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const counts = countRows.map((c) => ({
      id: c.id, number: c.countNumber, status: c.status,
      openedAt: manilaIso(c.createdAt), postedAt: manilaIso(c.postedAt),
      startedBy: c.startedById, postedBy: c.postedById,
      lines: c.lines.map((l) => ({
        itemId: l.rawMaterialId, kind: 'raw' as const, systemQty: qty4(l.expectedQty), countedQty: qty4(l.countedQty),
      })),
    }));

    // ── What is already on order ───────────────────────────────────────────
    const pos = await this.prisma.purchaseOrder.findMany({
      where: { tenantId, branchId, status: { in: ['ORDERED', 'PARTIAL'] } },
      select: {
        id: true, poNumber: true, expectedAt: true, vendor: { select: { name: true } },
        items: { select: { rawMaterialId: true, productId: true, qtyOrdered: true, qtyReceived: true } },
      },
      orderBy: { orderDate: 'asc' },
    });
    const openPurchaseOrders = pos.map((po) => ({
      id: po.id, number: po.poNumber, supplier: po.vendor?.name ?? null, expectedOn: manilaDay(po.expectedAt),
      lines: po.items.map((i) => ({
        itemId: (i.rawMaterialId ?? i.productId) as string,
        kind: (i.rawMaterialId ? 'raw' : 'product') as Kind,
        qtyOrdered: qty4(i.qtyOrdered), qtyReceived: qty4(i.qtyReceived),
      })),
    }));

    /*
      A cafe buys through Procure's buy lists, not purchase orders: a request
      OPEN (being built), SENT (with the owner) or BOUGHT (on its way in) is
      stock already asked for. Not in the contract's example; added so a
      reorder suggestion does not ask a second time for what is coming.
    */
    const reqs = await this.prisma.purchaseRequest.findMany({
      where: { tenantId, branchId, status: { in: ['OPEN', 'SENT', 'BOUGHT'] } },
      select: {
        id: true, requestNumber: true, status: true, createdAt: true,
        lines: { select: { rawMaterialId: true, qtyRequested: true, receivedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const openPurchaseRequests = reqs.map((r) => ({
      id: r.id, number: r.requestNumber, status: r.status, openedAt: manilaIso(r.createdAt),
      lines: r.lines.map((l) => ({
        itemId: l.rawMaterialId, kind: 'raw' as const, qtyRequested: qty4(l.qtyRequested), received: l.receivedAt != null,
      })),
    }));

    // No supplier lead time is recorded anywhere in Clerque, so the
    // contract's `suppliersLeadDays` is left out rather than invented.
    return {
      tenant: { id: tenant.id, name: tenant.businessName ?? tenant.name },
      branch: { id: branch.id, name: branch.name },
      from, to,
      asOf: manilaIso(now),
      valuationMethod: tenant.valuationMethod,
      inventoryMode: tenant.inventoryMode,
      items, lots, movements, usage, dayBalances, counts,
      openPurchaseOrders, openPurchaseRequests,
    };
  }

  /** Every movement in [start, end), oldest first. See the class comment. */
  private async movements(tenantId: string, branchId: string, start: Date, end: Date): Promise<SnapshotMovement[]> {
    const inWindow = { gte: start, lt: end };
    const out: Array<SnapshotMovement & { atMs: number }> = [];
    const push = (m: Omit<SnapshotMovement, 'at'> & { atDate: Date }) => {
      const { atDate, ...rest } = m;
      out.push({ ...rest, at: manilaIso(atDate)!, atMs: atDate.getTime() });
    };

    // Finished goods: the inventory log, exactly as written.
    const logs = await this.prisma.inventoryLog.findMany({
      where: { tenantId, branchId, createdAt: inWindow },
      select: {
        id: true, productId: true, type: true, quantityBefore: true, quantityAfter: true,
        reason: true, note: true, referenceId: true, createdById: true, createdAt: true,
      },
    });
    for (const l of logs) {
      push({
        id: `log-${l.id}`, itemId: l.productId, kind: 'product', type: l.type,
        qty: qty4(new Prisma.Decimal(l.quantityAfter).minus(l.quantityBefore))!,
        qtyBefore: qty4(l.quantityBefore), qtyAfter: qty4(l.quantityAfter), unitCost: null,
        atDate: l.createdAt, reason: l.reason ?? l.note ?? null, reference: l.referenceId, by: l.createdById,
      });
    }

    // Ingredients: lots in (receipts, transfers in, preps made) and write-off markers.
    const lots = await this.prisma.rawMaterialLot.findMany({
      where: { tenantId, branchId, receivedAt: inWindow },
      select: { id: true, rawMaterialId: true, qtyReceived: true, unitCost: true, receivedAt: true, referenceNumber: true },
    });
    for (const l of lots) {
      const q = new Prisma.Decimal(l.qtyReceived);
      if (q.isZero()) continue;
      const ref = l.referenceNumber ?? '';
      const transfer = /^ST-\d{4}-\d+$/.test(ref);
      const cancelled = /^ST-\d{4}-\d+-CANCELLED$/.test(ref);
      push({
        id: `${q.isNegative() ? 'wo' : 'lot'}-${l.id}`, itemId: l.rawMaterialId, kind: 'raw',
        type: q.isNegative() ? 'WRITE_OFF' : transfer ? 'TRANSFER_IN' : cancelled ? 'ADJUSTMENT' : 'STOCK_IN',
        qty: qty4(q)!, qtyBefore: null, qtyAfter: null, unitCost: qty4(l.unitCost),
        atDate: l.receivedAt,
        reason: cancelled ? 'Cancelled transfer: stock back' : null,
        reference: l.referenceNumber, by: null,
      });
    }

    // Transfers sent from this branch.
    const sent = await this.prisma.stockTransfer.findMany({
      where: { tenantId, fromBranchId: branchId, sentAt: inWindow, status: { in: ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'] } },
      select: {
        id: true, transferNumber: true, sentAt: true, createdById: true,
        lines: { select: { id: true, rawMaterialId: true, quantity: true, unitCost: true } },
      },
    });
    for (const t of sent) {
      for (const line of t.lines) {
        push({
          id: `tro-${line.id}`, itemId: line.rawMaterialId, kind: 'raw', type: 'TRANSFER_OUT',
          qty: qty4(new Prisma.Decimal(line.quantity).negated())!, qtyBefore: null, qtyAfter: null,
          unitCost: qty4(line.unitCost), atDate: t.sentAt!, reason: null, reference: t.transferNumber, by: t.createdById,
        });
      }
    }

    // Posted counts: each line's variance, unless the post left it alone.
    const posted = await this.prisma.cycleCount.findMany({
      where: { tenantId, branchId, status: 'POSTED', postedAt: inWindow },
      select: {
        countNumber: true, postedAt: true, postedById: true,
        lines: { select: { id: true, rawMaterialId: true, varianceQty: true, notes: true } },
      },
    });
    for (const c of posted) {
      for (const line of c.lines) {
        const v = new Prisma.Decimal(line.varianceQty);
        if (v.isZero() || wasLeftAlone(line.notes)) continue;
        push({
          id: `cc-${line.id}`, itemId: line.rawMaterialId, kind: 'raw', type: 'COUNT',
          qty: qty4(v)!, qtyBefore: null, qtyAfter: null, unitCost: null,
          atDate: c.postedAt!, reason: 'Physical count', reference: c.countNumber, by: c.postedById,
        });
      }
    }

    // What prep batches (syrups, sauces, doughs) took from the shelf.
    const batches = await this.prisma.accountingEvent.findMany({
      where: {
        tenantId, type: 'INVENTORY_ADJUSTMENT', createdAt: { gte: start },
        payload: { path: ['kind'], equals: 'SUB_RECIPE_BATCH' },
      },
      select: { id: true, createdAt: true, payload: true },
    });
    for (const ev of batches) {
      const p = (ev.payload ?? {}) as Record<string, unknown>;
      if (p['branchId'] !== branchId) continue;
      const stated = typeof p['madeAt'] === 'string' ? new Date(p['madeAt']) : null;
      const madeAt = stated && !Number.isNaN(stated.getTime()) ? stated : ev.createdAt;
      if (madeAt.getTime() < start.getTime() || madeAt.getTime() >= end.getTime()) continue;
      const consumed = Array.isArray(p['consumed']) ? (p['consumed'] as Array<Record<string, unknown>>) : [];
      for (const c of consumed) {
        const took = Number(c?.['quantity'] ?? 0);
        if (!(took > 0) || typeof c['rawMaterialId'] !== 'string') continue;
        const unitCost = Number(c['unitCost']);
        push({
          id: `prep-${ev.id}-${c['rawMaterialId']}`, itemId: c['rawMaterialId'], kind: 'raw', type: 'STOCK_OUT',
          qty: qty4(-took)!, qtyBefore: null, qtyAfter: null,
          unitCost: Number.isFinite(unitCost) && unitCost > 0 ? qty4(unitCost) : null,
          atDate: madeAt, reason: `Prep batch: ${String(p['rawMaterialName'] ?? 'a prep')}`,
          reference: typeof p['referenceNumber'] === 'string' ? p['referenceNumber'] : null,
          by: typeof p['madeById'] === 'string' ? p['madeById'] : null,
        });
      }
    }

    out.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
    return out.map(({ atMs: _atMs, ...m }) => m);
  }
}
