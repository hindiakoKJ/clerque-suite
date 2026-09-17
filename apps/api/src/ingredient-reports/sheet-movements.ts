import { Prisma } from '@prisma/client';
import { loadLineRecipes } from '../orders/line-recipes';

/**
 * What moved a branch's stock between two closing balances, per item, sorted
 * into the columns of the paper sheet: In, Waste, Used.
 *
 * Every column is keyed on WRITE time -- when the stock row actually changed
 * (a lot's createdAt, a line's ingredientsDeductedAt or usagePostedAt, an
 * event's createdAt) -- never on a business date the cashier or cook can set
 * earlier. Saved balances are read at a moment, so only write times foot
 * against them. Whatever these readers can't name lands in the sheet's Adjust.
 *
 * The owner's rule for the kitchen and bar: work starts when an order is paid,
 * and a void or refund after that is settled between the cashier and the
 * kitchen by word of mouth. So Used is what sales took off the book, whatever
 * happened to the sale later, and Waste is write-offs only.
 *
 *   In     Every positive lot: receipts, Procure posts, purchase-order and
 *          transfer receipts, imports, prep batch output. Not the stock a
 *          cancelled transfer hands back (its reference ends -CANCELLED): the
 *          transfer out was never a column either, so both land in Adjust.
 *   Waste  Write-offs: the negative marker lot each one writes.
 *   Used   Lines used at the sale, through the same recipe walk the sale
 *          used; lines that waited at a kitchen or bar screen, by exactly what
 *          their confirm recorded taking; and what each prep batch took.
 *
 * Windows are half-open, [from, to), so back-to-back sheets never count an
 * instant twice. Amounts are in each item's own unit, to 4 decimal places.
 */

export interface SheetMovement {
  in: number;
  waste: number;
  used: number;
}

type Db = Pick<
  Prisma.TransactionClient,
  'rawMaterialLot' | 'orderItem' | 'accountingEvent' | 'bomItem' | 'variantBomItem' | 'modifierOption'
>;

/** Postgres parameter limits make very large IN () lists unwise. */
const ORDER_CHUNK = 500;

/**
 * A sale's line is stamped inside the sale's own transaction, a moment after
 * its order row is written. The bound lets the query use the orders' date
 * index; order_items has none on the stamp.
 */
const SALE_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * How much older than the line's usagePostedAt a confirm record may be and
 * still be that confirm (the app's clock stamps the line, the database's
 * clock the record). An older record belongs to a confirm an un-bump took back.
 */
const CONFIRM_SLACK_MS = 60_000;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function movementsInWindow(
  db: Db,
  tenantId: string,
  branchId: string,
  /** Inclusive. */
  from: Date,
  /** Exclusive. */
  to: Date,
): Promise<Map<string, SheetMovement>> {
  const moves = new Map<string, SheetMovement>();
  const add = (rawMaterialId: string, column: keyof SheetMovement, qty: number) => {
    if (!(qty > 0)) return;
    const m = moves.get(rawMaterialId) ?? { in: 0, waste: 0, used: 0 };
    m[column] += qty;
    moves.set(rawMaterialId, m);
  };
  if (!(to.getTime() > from.getTime())) return moves;

  // 1 and 2. Lots: positive ones are In, the write-off's negative marker is Waste.
  const lots = await db.rawMaterialLot.findMany({
    where:  { tenantId, branchId, createdAt: { gte: from, lt: to }, NOT: { qtyReceived: 0 } },
    select: { rawMaterialId: true, qtyReceived: true, referenceNumber: true },
  });
  for (const lot of lots) {
    const qty = Number(lot.qtyReceived);
    if (qty < 0) add(lot.rawMaterialId, 'waste', -qty);
    else if (!(lot.referenceNumber ?? '').endsWith('-CANCELLED')) add(lot.rawMaterialId, 'in', qty);
  }

  // 3. Lines used at the sale: the recipe of the saved line (size, add-ons) times its quantity.
  const atSale = await db.orderItem.findMany({
    where: {
      usageOnReady:          false,
      ingredientsDeductedAt: { gte: from, lt: to },
      order:                 { tenantId, branchId, createdAt: { gte: new Date(from.getTime() - SALE_LOOKBACK_MS) } },
    },
    select: { productId: true, variantId: true, quantity: true, modifiers: { select: { modifierOptionId: true } } },
  });
  if (atSale.length > 0) {
    const usageOf = await loadLineRecipes(db, tenantId, atSale);
    for (const line of atSale) {
      const units = Number(line.quantity);
      if (!(units > 0)) continue;
      for (const u of usageOf(line)) add(u.rawMaterialId, 'used', u.perUnit * units);
    }
  }

  // 4. Lines that waited at a screen: exactly what their confirm took, as its COGS record wrote it down.
  const confirmed = await db.orderItem.findMany({
    where:  { usageOnReady: true, usagePostedAt: { gte: from, lt: to }, order: { tenantId, branchId } },
    select: { id: true, orderId: true, usagePostedAt: true },
  });
  if (confirmed.length > 0) {
    const records = new Map<string, { at: Date; stockTaken: unknown; ingredients: Array<Record<string, unknown>> }>();
    const orderIds = [...new Set(confirmed.map((l) => l.orderId))];
    for (let i = 0; i < orderIds.length; i += ORDER_CHUNK) {
      // Newest first, so a line un-bumped and bumped again reads its latest confirm.
      const events = await db.accountingEvent.findMany({
        where:   { tenantId, type: 'COGS', orderId: { in: orderIds.slice(i, i + ORDER_CHUNK) } },
        orderBy: { createdAt: 'desc' },
        select:  { payload: true, createdAt: true },
      });
      for (const e of events) {
        const p = e.payload as { orderItemId?: unknown; stockTaken?: unknown; ingredients?: unknown } | null;
        if (typeof p?.orderItemId !== 'string' || records.has(p.orderItemId) || !Array.isArray(p.ingredients)) continue;
        records.set(p.orderItemId, { at: e.createdAt, stockTaken: p.stockTaken, ingredients: p.ingredients as Array<Record<string, unknown>> });
      }
    }
    for (const line of confirmed) {
      const record = records.get(line.id);
      // No record of THIS confirm (only an older one an un-bump gave back, or a line refunded in full while it waited): it took nothing.
      if (!record || !line.usagePostedAt || record.at.getTime() < line.usagePostedAt.getTime() - CONFIRM_SLACK_MS) continue;
      // Booked while recipe deduction was paused: the cost went in, the stock did not move.
      if (record.stockTaken === false) continue;
      for (const ing of record.ingredients) {
        if (typeof ing['rawMaterialId'] === 'string') add(ing['rawMaterialId'], 'used', Number(ing['qty'] ?? 0));
      }
    }
  }

  /*
    5. Into preps: what each batch took from its components. The prep's own
    output is In through its lot above, so moving stock from one level to the
    next is Used on the lower level and In on the upper one -- counted once.
  */
  const batches = await db.accountingEvent.findMany({
    where: {
      tenantId,
      type:      'INVENTORY_ADJUSTMENT',
      createdAt: { gte: from, lt: to },
      AND: [
        { payload: { path: ['kind'], equals: 'SUB_RECIPE_BATCH' } },
        { payload: { path: ['branchId'], equals: branchId } },
      ],
    },
    select: { payload: true },
  });
  for (const ev of batches) {
    const p = ev.payload as Record<string, unknown> | null;
    if (!p || p['kind'] !== 'SUB_RECIPE_BATCH' || p['branchId'] !== branchId) continue;
    for (const c of (Array.isArray(p['consumed']) ? p['consumed'] : []) as Array<Record<string, unknown>>) {
      if (typeof c['rawMaterialId'] === 'string') add(c['rawMaterialId'], 'used', Number(c['quantity'] ?? 0));
    }
  }

  for (const m of moves.values()) {
    m.in = round4(m.in);
    m.waste = round4(m.waste);
    m.used = round4(m.used);
  }
  return moves;
}
