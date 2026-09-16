import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { drainLots, recipeKey } from './recipe-usage';
import { loadLineRecipes } from './line-recipes';
import { HOLDING_STATUSES, WAITING_LINE } from './held-usage';
import { queueBehindSales } from './order-lock';

/**
 * The moment a waiting line's ingredients are used.
 *
 * Owner's rule: a recipe item that waits at a kitchen or bar screen takes its
 * ingredients off stock, and its cost of goods into the books, when it is
 * marked ready -- by a bump, a serve, or the 02:30 nightly confirm for a ticket
 * nobody tapped. Everything else about the sale (revenue, the shelf item, the
 * payment) happened at the till.
 *
 * Same arithmetic as the sale: the recipe of the saved line (size and add-ons)
 * times what is left of it after refunds; stock taken by a relative decrement
 * and floored at zero; lot layers drained when the shop costs FIFO or the
 * ingredient is lot-tracked; the cost by the sale's waterfall. The cost is
 * dated to the SALE (completedAt = paidAt), so a day's revenue and its cost stay
 * in the same day and month however late the tap comes.
 *
 * Everything the confirm took is written on its COGS event -- the ingredients,
 * the lots, the cost -- because an un-bump has to give back exactly that and
 * nothing else records it.
 */

export type ConfirmTrigger = 'READY' | 'NIGHTLY';

/**
 * USAGE_ON_READY=off stops NEW lines from waiting; lines already waiting still
 * confirm. The switch is thrown in a hurry during an incident, so the usual ways
 * of writing "no" all count.
 */
const SWITCHED_OFF = ['off', 'false', '0', 'no', 'disabled'];
export function usageOnReadyEnabled(): boolean {
  return !SWITCHED_OFF.includes((process.env.USAGE_ON_READY ?? '').trim().toLowerCase());
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** YYYY-MM-DD of an instant in Manila (UTC+8, no daylight saving). */
export function manilaDay(d: Date): string {
  const ph = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${ph.getUTCFullYear()}-${String(ph.getUTCMonth() + 1).padStart(2, '0')}-${String(ph.getUTCDate()).padStart(2, '0')}`;
}

export interface ConfirmPayload {
  orderId: string;
  orderItemId: string;
  branchId: string;
  completedAt: string;
  overheadRate: number;
  trigger: ConfirmTrigger;
  lineKey: string;
  /** Units used: the line's quantity less refunds at the moment of the confirm. */
  units: number;
  /** False while recipe deduction was paused: cost booked, stock untouched (Recipe Catch-Up takes it later). */
  stockTaken: boolean;
  ingredients: Array<{ rawMaterialId: string; qty: number }>;
  lots: Array<{ rawMaterialId: string; lotId: string; qty: number; unitCost: number }>;
  lines: Array<{
    productId: string; orderItemId: string; lineKey: string; quantity: number;
    unitCost: number; totalCost: number; directCost: number; overhead: number; costMethod: string;
  }>;
}

/**
 * Take a waiting line's ingredients and book its cost. Once: guarded on
 * usagePostedAt, so a second tablet, a serve after a bump, or the nightly job
 * after a tap does nothing. Call inside the order's lock. Returns true when
 * this call was the confirm.
 */
export async function confirmLineUsage(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderItemId: string,
  opts: { actorId: string | null; trigger: ConfirmTrigger; now?: Date },
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const item = await tx.orderItem.findFirst({
    where:  { id: orderItemId, order: { tenantId } },
    select: {
      id: true, orderId: true, productId: true, variantId: true, quantity: true, refundedQty: true, costPrice: true,
      usageOnReady: true, usagePostedAt: true, ingredientsDeductedAt: true,
      modifiers: { select: { modifierOptionId: true } },
      product:   { select: { inventoryMode: true } },
      order:     { select: { branchId: true, paidAt: true, createdAt: true, status: true } },
    },
  });
  if (!item || !item.usageOnReady || item.usagePostedAt) return false;
  // A voided order's waiting line is never made: nothing is used, nothing is wasted.
  if (!(HOLDING_STATUSES as readonly string[]).includes(item.order.status)) return false;

  const flipped = await tx.orderItem.updateMany({
    where: { id: item.id, ...WAITING_LINE },
    data:  { usagePostedAt: now, readyById: opts.actorId },
  });
  if (flipped.count !== 1) return false;

  const units = round4(Number(item.quantity) - Number(item.refundedQty));
  if (units <= 0) return true;   // refunded in full while it waited: nothing to use

  const tenant = await tx.tenant.findUnique({
    where:  { id: tenantId },
    select: { valuationMethod: true, businessType: true, inventoryMode: true, recipeDeductionPausedAt: true, overheadRatePerUnit: true },
  });
  const useFifo = tenant?.valuationMethod === 'FIFO';
  /*
    Stock is not touched while deduction is paused (Recipe Catch-Up takes it
    later), nor when Catch-Up already took it for this line -- a line un-bumped
    after such a replay must not take its ingredients a second time.
  */
  const paused = tenant?.recipeDeductionPausedAt != null || item.ingredientsDeductedAt != null;
  const branchId = item.order.branchId;
  const usage = (await loadLineRecipes(tx, tenantId, [item]))(item);

  const ingredients: ConfirmPayload['ingredients'] = [];
  const lots: ConfirmPayload['lots'] = [];
  let recipeUnitCost = 0;
  if (!paused) await queueBehindSales(tx, tenantId);

  for (const u of usage) {
    const consume = round4(u.perUnit * units);
    if (!paused) {
      // No stock row means nothing on the shelf to take -- the cost is still known (below).
      const row = await tx.rawMaterialInventory.findUnique({
        where:  { branchId_rawMaterialId: { branchId, rawMaterialId: u.rawMaterialId } },
        select: { quantity: true },
      });
      const take = row ? round4(Math.min(consume, Math.max(Number(row.quantity), 0))) : 0;
      if (take > 0) {
        await tx.rawMaterialInventory.updateMany({
          where: { branchId, rawMaterialId: u.rawMaterialId },
          data:  { quantity: { decrement: new Prisma.Decimal(take) } },
        });
        /*
          A relative take cannot clamp itself: a write that landed between the
          read above and this one (a write-off, an offline sale allowed below
          zero) can leave the row under zero. Floor it, and record only what
          really came off -- an un-bump gives back exactly the recorded amount,
          and giving back more would put stock on the book that is not there.
        */
        const after = await tx.rawMaterialInventory.findUnique({
          where:  { branchId_rawMaterialId: { branchId, rawMaterialId: u.rawMaterialId } },
          select: { quantity: true },
        });
        const under = after ? Math.min(Number(after.quantity), 0) : 0;
        if (under < 0) {
          await tx.rawMaterialInventory.updateMany({
            where: { branchId, rawMaterialId: u.rawMaterialId, quantity: { lt: 0 } },
            data:  { quantity: new Prisma.Decimal(0) },
          });
        }
        const taken = round4(Math.max(0, take + under));
        if (taken > 0) ingredients.push({ rawMaterialId: u.rawMaterialId, qty: taken });
      }
    }
    const lotsTracked = u.rawMaterial?.lotsTracked === true;
    const wac = u.rawMaterial?.costPrice != null ? Number(u.rawMaterial.costPrice) : 0;
    if ((useFifo || lotsTracked) && !paused) {
      const drained = await drainLots(tx, { branchId, rawMaterialId: u.rawMaterialId }, consume, lotsTracked);
      for (const l of drained.lots) lots.push({ rawMaterialId: u.rawMaterialId, ...l });
      // Layers that ran out are costed at the running average, as the sale does, so the cost is never short.
      const shortfall = Math.max(0, consume - drained.qty);
      recipeUnitCost += (drained.cost + shortfall * wac) / units;
    } else {
      recipeUnitCost += u.perUnit * wac;
    }
  }

  // The sale's waterfall, less the shelf-lot step (the shelf item was taken at the sale).
  const costFromRecipe = item.product?.inventoryMode === 'RECIPE_BASED' || tenant?.inventoryMode === 'RECIPE_BASED';
  let unitCost: number | null = null;
  let costMethod = 'SNAPSHOT';
  if (costFromRecipe && usage.length > 0) {
    unitCost = recipeUnitCost;
    costMethod = useFifo ? 'RECIPE_FIFO' : 'RECIPE_WAC';
  } else {
    const inv = await tx.inventoryItem.findFirst({
      where:  { tenantId, branchId, productId: item.productId },
      select: { avgCost: true },
    });
    if (inv?.avgCost != null) { unitCost = Number(inv.avgCost); costMethod = 'WAC'; }
    else if (item.costPrice != null) { unitCost = Number(item.costPrice); costMethod = 'SNAPSHOT'; }
  }

  const overheadRate = tenant?.businessType === 'MANUFACTURING' && tenant.overheadRatePerUnit != null
    ? Number(tenant.overheadRatePerUnit) : 0;
  const overhead = overheadRate * units;
  const lineKey = recipeKey(item.productId, item.variantId, item.modifiers.map((m) => m.modifierOptionId));
  const lines: ConfirmPayload['lines'] = unitCost == null ? [] : [{
    productId:   item.productId,
    orderItemId: item.id,
    lineKey,
    quantity:    units,
    unitCost,
    totalCost:   round2(units * unitCost + overhead),
    directCost:  round2(units * unitCost),
    overhead:    round2(overhead),
    costMethod,
  }];

  const payload: ConfirmPayload = {
    orderId:     item.orderId,
    orderItemId: item.id,
    branchId,
    completedAt: (item.order.paidAt ?? item.order.createdAt).toISOString(),
    overheadRate,
    trigger:     opts.trigger,
    lineKey,
    units,
    stockTaken:  !paused,
    ingredients,
    lots,
    lines,
  };
  await tx.accountingEvent.create({
    data: { tenantId, orderId: item.orderId, type: 'COGS', status: 'PENDING', payload: payload as unknown as Prisma.JsonObject },
  });

  await tx.orderItem.update({
    where: { id: item.id },
    data:  {
      ...(unitCost != null ? { costPrice: new Prisma.Decimal(unitCost) } : {}),
      // Left empty while paused, so Recipe Catch-Up still replays the stock later.
      ...(!paused && usage.length > 0 ? { ingredientsDeductedAt: now } : {}),
    },
  });
  return true;
}

/**
 * Give back what a confirm took, for an un-bump.
 *
 * Only the same Manila day as the confirm, only while the sale's period is
 * open, and only if nothing on the line was refunded since: a refund after
 * the item was made is waste, and handing its ingredients back would undo the
 * waste. Refuses in words otherwise. Call inside the order's lock.
 */
export async function returnLineUsage(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderItemId: string,
  now = new Date(),
): Promise<boolean> {
  const item = await tx.orderItem.findFirst({
    where:  { id: orderItemId, order: { tenantId } },
    select: {
      id: true, orderId: true, quantity: true, refundedQty: true, usageOnReady: true, usagePostedAt: true, ingredientsDeductedAt: true,
      order: { select: { branchId: true, paidAt: true, createdAt: true } },
    },
  });
  if (!item || !item.usageOnReady || !item.usagePostedAt) return false;

  if (manilaDay(item.usagePostedAt) !== manilaDay(now)) {
    throw new BadRequestException('This item was counted as made on an earlier day, so it cannot be un-bumped. Void or refund it instead.');
  }
  const soldAt = item.order.paidAt ?? item.order.createdAt;
  // The journal dates by the Manila day at UTC midnight; ask the same question it will.
  const saleDay = new Date(manilaDay(soldAt));
  const closed = await tx.accountingPeriod.findFirst({
    where:  { tenantId, status: 'CLOSED', startDate: { lte: saleDay }, endDate: { gte: saleDay } },
    select: { name: true },
  });
  if (closed) {
    throw new BadRequestException(`The books for "${closed.name}" are closed, so this item cannot be un-bumped.`);
  }

  const events = await tx.accountingEvent.findMany({
    where:   { orderId: item.orderId, type: 'COGS' },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, payload: true },
  });
  const confirm = events.find((e) => (e.payload as unknown as Partial<ConfirmPayload> | null)?.orderItemId === item.id);
  const record = confirm?.payload as unknown as ConfirmPayload | undefined;

  if (record) {
    const unitsNow = round4(Number(item.quantity) - Number(item.refundedQty));
    if (round4(Number(record.units)) !== unitsNow) {
      throw new BadRequestException('Part of this item was refunded after it was made, so it cannot be un-bumped.');
    }
    /*
      Counted as made while deduction was paused, then Recipe Catch-Up took its
      ingredients. The confirm took nothing, so it has nothing to give back --
      yet the un-bumped line would wait again and hold that milk a second time,
      and a void would then return nothing for what Catch-Up took.
    */
    if (!record.stockTaken && item.ingredientsDeductedAt != null) {
      throw new BadRequestException('Its ingredients were already taken by Recipe Catch-Up, so it cannot be un-bumped. Void or refund it instead.');
    }
    if (record.stockTaken) {
      await queueBehindSales(tx, tenantId);
      for (const ing of record.ingredients ?? []) {
        await tx.rawMaterialInventory.updateMany({
          where: { branchId: item.order.branchId, rawMaterialId: ing.rawMaterialId },
          data:  { quantity: { increment: new Prisma.Decimal(ing.qty) } },
        });
      }
      for (const lot of record.lots ?? []) {
        await tx.rawMaterialLot.updateMany({
          where: { id: lot.lotId },
          data:  { qtyRemaining: { increment: new Prisma.Decimal(lot.qty) } },
        });
      }
    }
    const lines = record.lines ?? [];
    if (lines.reduce((t, l) => t + Number(l.totalCost), 0) > 0) {
      await tx.accountingEvent.create({
        data: {
          tenantId, orderId: item.orderId, type: 'COGS_ADJUSTMENT', status: 'PENDING',
          payload: {
            kind: 'USAGE_RETURNED',
            orderId: item.orderId,
            orderItemId: item.id,
            confirmEventId: confirm!.id,
            completedAt: soldAt.toISOString(),
            lines,
          } as unknown as Prisma.JsonObject,
        },
      });
    }
  }

  await tx.orderItem.update({
    where: { id: item.id },
    data:  {
      usagePostedAt: null,
      readyById: null,
      ...(record?.stockTaken ? { ingredientsDeductedAt: null } : {}),
    },
  });
  return true;
}
