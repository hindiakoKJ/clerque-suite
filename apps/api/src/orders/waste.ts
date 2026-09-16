import { Prisma } from '@prisma/client';
import { recipeKey } from './recipe-usage';

/**
 * A made item that is voided or refunded is waste.
 *
 * Its ingredients were used and its cost booked -- at the sale, or when the
 * kitchen marked it ready. Nothing comes back, so the cost stays an expense,
 * but it is not a cost of something sold: it moves from 5010 Cost of goods
 * sold to 5070 Spoilage & Waste, at exactly what 5010 was debited for it.
 *
 * A line still waiting at a screen when it is voided or refunded was never
 * made: it used nothing, booked nothing, and wastes nothing.
 */

type CogsLine = { productId?: string; orderItemId?: string; lineKey?: string; quantity?: number | string; unitCost?: number; totalCost?: number; overhead?: number; costMethod?: string };
type CogsEvent = { payload: unknown };

export interface WasteItem {
  id: string;
  productId: string;
  variantId: string | null;
  costPrice: Prisma.Decimal | number | null;
  usageOnReady: boolean;
  usagePostedAt: Date | null;
  ingredientsDeductedAt: Date | null;
  modifiers?: Array<{ modifierOptionId: string | null }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every cost-of-goods entry of an order, newest first: the sale's, and one per line confirmed at the ready tap. */
export function orderCogsEvents(tx: Prisma.TransactionClient, orderId: string): Promise<CogsEvent[]> {
  return tx.accountingEvent.findMany({
    where:   { orderId, type: 'COGS' },
    orderBy: { createdAt: 'desc' },
    select:  { payload: true },
  });
}

function linesOf(e: CogsEvent): CogsLine[] {
  return ((e.payload as { lines?: CogsLine[] } | null)?.lines) ?? [];
}

/** Products of the order whose booked cost came from a recipe (credited raw materials, not 1050). */
export function recipeCostedProductIds(events: CogsEvent[]): Set<string> {
  return new Set(events.flatMap(linesOf).filter((l) => String(l.costMethod ?? '').startsWith('RECIPE')).map((l) => String(l.productId)));
}

/**
 * What 5010 was debited per unit of this line, and how: the line's own
 * confirm entry if it waited (newest, after any un-bump and re-bump), else the
 * sale's entry by the line's recipe key, else by product for an entry written
 * before keys were kept -- only when that product has one such line; with a
 * Regular and a Large of it the first line would be the wrong one, and the cost
 * written on the line itself is closer -- else the cost on the line.
 */
export function bookedUnitCost(events: CogsEvent[], item: WasteItem): { unitCost: number; costMethod: string } | null {
  const perUnit = (l: CogsLine) => {
    const qty = Number(l.quantity);
    const total = Number(l.totalCost);
    return qty > 0 && Number.isFinite(total) ? total / qty : Number(l.unitCost ?? 0);
  };
  const own = events.flatMap(linesOf).find((l) => l.orderItemId === item.id);
  if (own) return { unitCost: perUnit(own), costMethod: String(own.costMethod ?? '') };
  if (item.usageOnReady) return null;   // waited and never confirmed: nothing booked
  const key = recipeKey(item.productId, item.variantId, (item.modifiers ?? []).map((m) => m.modifierOptionId));
  const sale = events.flatMap(linesOf).filter((l) => !l.orderItemId);
  const legacy = sale.filter((l) => !l.lineKey && l.productId === item.productId);
  const byKey = sale.find((l) => l.lineKey === key) ?? (legacy.length === 1 || item.costPrice == null ? legacy[0] : undefined);
  if (byKey) return { unitCost: perUnit(byKey), costMethod: String(byKey.costMethod ?? '') };
  if (legacy.length > 1) return { unitCost: Number(item.costPrice), costMethod: String(legacy[0].costMethod ?? 'SNAPSHOT') };
  return item.costPrice != null ? { unitCost: Number(item.costPrice), costMethod: 'SNAPSHOT' } : null;
}

/** Waited at a screen and was never marked ready. */
export function stillWaiting(item: Pick<WasteItem, 'usageOnReady' | 'usagePostedAt'>): boolean {
  return item.usageOnReady && item.usagePostedAt == null;
}

/** Its ingredients were used: taken at the sale or at the ready tap, or costed from its recipe. */
export function wasMade(events: CogsEvent[], item: WasteItem): boolean {
  if (stillWaiting(item)) return false;
  if (item.usagePostedAt != null || item.ingredientsDeductedAt != null) return true;
  const booked = bookedUnitCost(events, item);
  return booked != null && booked.costMethod.startsWith('RECIPE');
}

/** One COGS_ADJUSTMENT WASTE entry for the made, un-restocked units of a void or a refund. Nothing when there is nothing to move. */
export async function recordWaste(
  tx: Prisma.TransactionClient,
  tenantId: string,
  order: { id: string; orderNumber: string },
  entries: Array<{ item: WasteItem; units: number }>,
  source: 'VOID' | 'REFUND',
  reason: string,
  events?: CogsEvent[],
): Promise<number> {
  const cogs = events ?? await orderCogsEvents(tx, order.id);
  const lines = entries
    .filter((e) => e.units > 0 && wasMade(cogs, e.item))
    .map((e) => {
      const booked = bookedUnitCost(cogs, e.item);
      return booked && booked.unitCost > 0 ? {
        productId:   e.item.productId,
        orderItemId: e.item.id,
        quantity:    e.units,
        unitCost:    booked.unitCost,
        totalCost:   round2(e.units * booked.unitCost),
        costMethod:  booked.costMethod,
      } : null;
    })
    .filter((l): l is NonNullable<typeof l> => l != null && l.totalCost > 0);
  if (lines.length === 0) return 0;
  await tx.accountingEvent.create({
    data: {
      tenantId, orderId: order.id, type: 'COGS_ADJUSTMENT', status: 'PENDING',
      payload: { kind: 'WASTE', source, orderId: order.id, orderNumber: order.orderNumber, reason, lines } as unknown as Prisma.JsonObject,
    },
  });
  return round2(lines.reduce((t, l) => t + l.totalCost, 0));
}
