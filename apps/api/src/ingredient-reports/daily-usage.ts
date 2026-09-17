import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PH_TIMEZONE } from '@repo/shared-types';
import { HOLDING_STATUSES } from '../orders/held-usage';
import { loadLineRecipes, RecipeRawMaterial } from '../orders/line-recipes';
import { UsagePerUnit } from '../orders/recipe-usage';
import { stillWaiting } from '../orders/waste';

/**
 * What left the shelf, day by day, and why.
 *
 * A cafe's staff write a daily "ingredients used" sheet by hand. This is that
 * sheet, worked out from what the till, the kitchen screens, the prep log and
 * the write-offs recorded -- so it has to count every way an ingredient leaves,
 * the same way the stock book does:
 *
 *   sold / wasted  Order lines, through the one shared recipe walk (size
 *                  recipe, add-on ingredients, multipliers, oat milk netting
 *                  out dairy). A line used at the sale counts on the day of the
 *                  sale, all of it: neither a void nor a refund ever gives an
 *                  ingredient back (orders.service void() and refundItem() only
 *                  ever put a SHELF item back). A line that waited at a kitchen
 *                  or bar screen counts on the day it was marked ready, with the
 *                  units that confirm recorded; one never marked ready used
 *                  nothing. Made, then voided or refunded, is "wasted" -- it
 *                  still left the shelf, it just was not sold.
 *   intoPreps      What each batch of syrup, sauce or dough took, from its
 *                  SUB_RECIPE_BATCH record, on the day the batch was made.
 *   writtenOff     Spoiled or dropped stock, from the write-off's marker lot
 *                  row -- written for every write-off, including the ones for
 *                  an ingredient with no cost, which get no accounting event.
 *
 * Days are Manila business days (UTC+8, no daylight saving).
 */

type Db = Pick<
  Prisma.TransactionClient,
  'order' | 'orderItem' | 'accountingEvent' | 'rawMaterialLot' | 'rawMaterial' | 'bomItem' | 'variantBomItem' | 'modifierOption'
>;

export interface UsageRow {
  rawMaterialId: string;
  name: string;
  unit: string;
  /** The ingredient's cost now; `value` is priced at it. */
  costPrice: number;
  sold: number;
  wasted: number;
  intoPreps: number;
  writtenOff: number;
  total: number;
  /** All of `total`, preps included: this ingredient did leave its own shelf. The day's `totals.value` leaves preps out. */
  value: number;
}

/** Pesos, not quantities: grams of sugar and millilitres of milk do not add up. */
export interface UsageTotals {
  soldValue: number;
  wastedValue: number;
  /** What went into preps. Not in `value`: that stock became the prep, still on the shelf. */
  intoPrepsValue: number;
  writtenOffValue: number;
  /** What left stock: sold + wasted + written off. Leaves out `intoPrepsValue`, which would count a prep's ingredients twice. */
  value: number;
}

export interface UsageDay {
  /** YYYY-MM-DD, Manila. */
  day: string;
  /** Most valuable first. */
  rows: UsageRow[];
  totals: UsageTotals;
  /** Units sold that day still waiting at a kitchen or bar screen: nothing used for them yet. */
  stillBeingMade: number;
}

export interface DailyUsage {
  from: string;
  to: string;
  branchId: string | null;
  /** Only days something happened on, oldest first. */
  days: UsageDay[];
  /** The whole range, per ingredient, most valuable first. */
  rows: UsageRow[];
  totals: UsageTotals;
  stillBeingMade: number;
}

/**
 * Orders whose made lines used ingredients. VOIDED is in on purpose: a void
 * puts a shelf item back but never an ingredient, so what was made for a
 * voided order still left the shelf. OPEN orders never took anything.
 */
const USED_STATUSES = ['PAID', 'COMPLETED', 'RETURNED', 'VOIDED'] as const;

/** Postgres parameter limits make very large IN () lists unwise. */
const ORDER_CHUNK = 500;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How much older than the line's usagePostedAt a confirm record may be and
 * still count as that confirm. The stamp comes from the app's clock and the
 * record's createdAt from the database's, so they can disagree by a little;
 * a record left over from an un-bumped confirm is hours older.
 */
const CONFIRM_SLACK_MS = 60_000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

const MANILA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD of an instant, in the shop's day. */
export function manilaDayOf(at: Date): string {
  return MANILA_DAY.format(at);
}

/** When a Manila day starts. Manila keeps no daylight saving, so a day always starts at 00:00+08:00. */
export function manilaDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`);
}

/** A real calendar day written YYYY-MM-DD (not 2026-02-30). */
export function isManilaDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const start = manilaDayStart(day);
  return !Number.isNaN(start.getTime()) && manilaDayOf(start) === day;
}

type Reason = 'sold' | 'wasted' | 'intoPreps' | 'writtenOff';
type Parts = Record<Reason, number>;
type Meta = { name: string; unit: string; costPrice: number | null };

type SavedLine = {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: Prisma.Decimal | number;
  refundedQty: Prisma.Decimal | number;
  usageOnReady: boolean;
  usagePostedAt: Date | null;
  modifiers: Array<{ modifierOptionId: string | null }>;
  order: { id: string; status: string; paidAt: Date | null; createdAt: Date };
};

const LINE_SELECT = {
  id: true, productId: true, variantId: true, quantity: true, refundedQty: true,
  usageOnReady: true, usagePostedAt: true,
  modifiers: { select: { modifierOptionId: true } },
} as const;

export async function usedByDay(
  db: Db,
  tenantId: string,
  branchId: string | null,
  /** Inclusive. */
  from: Date,
  /** Exclusive, so back-to-back days never count an instant twice. */
  to: Date,
): Promise<DailyUsage> {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException('The report dates are not valid dates.');
  }
  const inRange = (at: Date) => at.getTime() >= from.getTime() && at.getTime() < to.getTime();
  const branch = branchId ? { branchId } : {};

  const byDay = new Map<string, Map<string, Parts>>();
  const waitingByDay = new Map<string, number>();
  const meta = new Map<string, Meta>();
  const add = (day: string, rawMaterialId: string, reason: Reason, qty: number) => {
    if (!(qty > 0)) return;
    const perRm = byDay.get(day) ?? new Map<string, Parts>();
    const parts = perRm.get(rawMaterialId) ?? { sold: 0, wasted: 0, intoPreps: 0, writtenOff: 0 };
    parts[reason] += qty;
    perRm.set(rawMaterialId, parts);
    byDay.set(day, perRm);
  };
  const remember = (rawMaterialId: string, m: { name?: unknown; unit?: unknown; costPrice?: unknown } | null | undefined) => {
    if (meta.has(rawMaterialId) || !m) return;
    meta.set(rawMaterialId, {
      name:      typeof m.name === 'string' ? m.name : 'Ingredient',
      unit:      typeof m.unit === 'string' ? m.unit : '',
      costPrice: m.costPrice != null ? Number(m.costPrice) : null,
    });
  };

  if (to.getTime() > from.getTime()) {
    /*
      1. Order lines.

      Orders SOLD in range give the lines used at the sale, the lines still
      waiting (reported, not counted), and waiting lines the nightly job
      confirmed after the range ended. Lines MARKED READY in range can belong
      to an order sold the day before, so they are read on their own.
    */
    const orders = await db.order.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: [...USED_STATUSES] },
        ...branch,
        OR: [
          { paidAt: { gte: from, lt: to } },
          { paidAt: null, createdAt: { gte: from, lt: to } },
        ],
      },
      select: { id: true, status: true, paidAt: true, createdAt: true, items: { select: LINE_SELECT } },
    });
    const readied = await db.orderItem.findMany({
      where: {
        usageOnReady:  true,
        usagePostedAt: { gte: from, lt: to },
        order: { tenantId, deletedAt: null, status: { in: [...USED_STATUSES] }, ...branch },
      },
      select: { ...LINE_SELECT, order: { select: { id: true, status: true, paidAt: true, createdAt: true } } },
    });

    const atSale: SavedLine[] = [];
    const confirmed = new Map<string, SavedLine>();
    for (const o of orders) {
      const order = { id: o.id, status: o.status, paidAt: o.paidAt, createdAt: o.createdAt };
      for (const item of o.items) {
        const line: SavedLine = { ...item, order };
        if (!item.usageOnReady) atSale.push(line);
        else if (!stillWaiting(item)) confirmed.set(item.id, line);
        else if ((HOLDING_STATUSES as readonly string[]).includes(o.status)) {
          // Nothing used for it yet. Said, so a count taken before it is made is not a surprise.
          const units = Number(item.quantity) - Number(item.refundedQty);
          if (units > 1e-9) {
            const day = manilaDayOf(o.paidAt ?? o.createdAt);
            waitingByDay.set(day, round4((waitingByDay.get(day) ?? 0) + units));
          }
        }
      }
    }
    for (const item of readied) confirmed.set(item.id, item);

    /*
      What each confirm recorded: the units it used (the line less refunds at
      that moment -- units refunded while it waited used nothing) and whether
      a person marked it ready or the nightly job did. Newest first, so a line
      un-bumped and bumped again reads its latest confirm.
    */
    const confirmOf = new Map<string, { units?: unknown; trigger?: unknown; at: Date }>();
    const orderIds = [...new Set([...confirmed.values()].map((l) => l.order.id))];
    for (let i = 0; i < orderIds.length; i += ORDER_CHUNK) {
      const events = await db.accountingEvent.findMany({
        where:   { tenantId, type: 'COGS', orderId: { in: orderIds.slice(i, i + ORDER_CHUNK) } },
        orderBy: { createdAt: 'desc' },
        select:  { payload: true, createdAt: true },
      });
      for (const e of events) {
        const p = e.payload as { orderItemId?: unknown; units?: unknown; trigger?: unknown } | null;
        if (typeof p?.orderItemId === 'string' && !confirmOf.has(p.orderItemId)) confirmOf.set(p.orderItemId, { ...p, at: e.createdAt });
      }
    }

    // One batched recipe walk for every line, the same walk the sale and the ready tap use.
    const usageOf = await loadLineRecipes(db, tenantId, [...atSale, ...confirmed.values()]);
    const addLine = (day: string, usage: Array<UsagePerUnit<RecipeRawMaterial>>, soldUnits: number, wastedUnits: number) => {
      for (const u of usage) {
        remember(u.rawMaterialId, u.rawMaterial);
        add(day, u.rawMaterialId, 'sold', u.perUnit * soldUnits);
        add(day, u.rawMaterialId, 'wasted', u.perUnit * wastedUnits);
      }
    };

    for (const line of atSale) {
      const units = Number(line.quantity);
      if (!(units > 0)) continue;
      // All of a voided line is waste; of a kept line, what was refunded.
      const wasted = line.order.status === 'VOIDED' ? units : clamp(Number(line.refundedQty), 0, units);
      addLine(manilaDayOf(line.order.paidAt ?? line.order.createdAt), usageOf(line), units - wasted, wasted);
    }

    for (const line of confirmed.values()) {
      /*
        Only the record of the line's CURRENT confirm counts. The confirm
        stamps usagePostedAt before it writes its record, so that record is
        never older than the stamp. An older one belongs to a confirm an
        un-bump took back -- the un-bump gives the ingredients back but leaves
        the record -- and a line refunded in full while it waited again is
        confirmed with no record at all. Reading the old record there would
        count a drink that was never made as wasted.
      */
      const newest = confirmOf.get(line.id);
      const record = newest && line.usagePostedAt
        && newest.at.getTime() >= line.usagePostedAt.getTime() - CONFIRM_SLACK_MS
        ? newest
        : undefined;
      const recorded = Number(record?.units);
      // No record of this confirm (refunded in full while it waited, or written before records were kept): what is left of the line.
      const units = record && Number.isFinite(recorded)
        ? recorded
        : Math.max(0, Number(line.quantity) - Number(line.refundedQty));
      if (!(units > 0)) continue;
      /*
        The day it was made. A tap is the moment it was made. The nightly job
        confirms at 02:30 what nobody tapped the day before -- those drinks
        were made on the day they were sold, and counting them the next
        morning would put yesterday's milk on today's sheet.
      */
      const soldAt = line.order.paidAt ?? line.order.createdAt;
      const madeAt = record?.trigger === 'NIGHTLY' ? soldAt : (line.usagePostedAt ?? soldAt);
      if (!inRange(madeAt)) continue;
      // Refunds before the confirm are already outside `units`; only the ones after it were made and wasted.
      const refundedSince = Number(line.refundedQty) - (Number(line.quantity) - units);
      const wasted = line.order.status === 'VOIDED' ? units : clamp(refundedSince, 0, units);
      addLine(manilaDayOf(madeAt), usageOf(line), units - wasted, wasted);
    }

    /*
      2. Preparations. Dated by when the batch was made, which the cook can
      set earlier than when it was recorded -- so a batch made in range may be
      recorded after it, never before (a batch dated ahead of when it was
      recorded is the one case this misses).
    */
    const batches = await db.accountingEvent.findMany({
      where: {
        tenantId,
        type: 'INVENTORY_ADJUSTMENT',
        createdAt: { gte: from },
        payload: { path: ['kind'], equals: 'SUB_RECIPE_BATCH' },
      },
      select: { createdAt: true, payload: true },
    });
    for (const ev of batches) {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p || p['kind'] !== 'SUB_RECIPE_BATCH') continue;
      if (branchId && p['branchId'] && p['branchId'] !== branchId) continue;
      const stated = typeof p['madeAt'] === 'string' ? new Date(p['madeAt']) : null;
      const madeAt = stated && !Number.isNaN(stated.getTime()) ? stated : ev.createdAt;
      if (!inRange(madeAt)) continue;
      const day = manilaDayOf(madeAt);
      for (const c of (Array.isArray(p['consumed']) ? p['consumed'] : []) as Array<Record<string, unknown>>) {
        const id = String(c['rawMaterialId'] ?? '');
        if (!id) continue;
        remember(id, { name: c['name'], unit: c['unit'] });
        add(day, id, 'intoPreps', Number(c['quantity'] ?? 0));
      }
    }

    // 3. Write-offs: the marker lot row, negative because stock left.
    const writeOffs = await db.rawMaterialLot.findMany({
      where:  { tenantId, qtyReceived: { lt: 0 }, receivedAt: { gte: from, lt: to }, ...branch },
      select: { rawMaterialId: true, qtyReceived: true, receivedAt: true },
    });
    for (const w of writeOffs) {
      add(manilaDayOf(w.receivedAt), w.rawMaterialId, 'writtenOff', -Number(w.qtyReceived));
    }
  }

  // Names and today's cost, read once. What the walk or the batch said is the fallback.
  const ids = [...new Set([...byDay.values()].flatMap((d) => [...d.keys()]))];
  const found = ids.length
    ? await db.rawMaterial.findMany({
        where:  { tenantId, id: { in: ids } },
        select: { id: true, name: true, unit: true, costPrice: true },
      })
    : [];
  const current = new Map(found.map((r) => [r.id, r]));

  const rowOf = (rawMaterialId: string, parts: Parts): UsageRow => {
    const rm = current.get(rawMaterialId);
    const known = meta.get(rawMaterialId);
    const costPrice = rm ? Number(rm.costPrice ?? 0) : Number(known?.costPrice ?? 0);
    const sold = round4(parts.sold);
    const wasted = round4(parts.wasted);
    const intoPreps = round4(parts.intoPreps);
    const writtenOff = round4(parts.writtenOff);
    const total = round4(sold + wasted + intoPreps + writtenOff);
    return {
      rawMaterialId,
      name: rm?.name ?? known?.name ?? 'Ingredient',
      unit: rm?.unit ?? known?.unit ?? '',
      costPrice,
      sold, wasted, intoPreps, writtenOff, total,
      value: round2(total * costPrice),
    };
  };
  const byValue = (a: UsageRow, b: UsageRow) => b.value - a.value || b.total - a.total || a.name.localeCompare(b.name);
  const totalsOf = (rows: UsageRow[]): UsageTotals => ({
    soldValue:       round2(rows.reduce((t, r) => t + r.sold * r.costPrice, 0)),
    wastedValue:     round2(rows.reduce((t, r) => t + r.wasted * r.costPrice, 0)),
    intoPrepsValue:  round2(rows.reduce((t, r) => t + r.intoPreps * r.costPrice, 0)),
    writtenOffValue: round2(rows.reduce((t, r) => t + r.writtenOff * r.costPrice, 0)),
    /*
      What left stock, in pesos. Sugar stirred into syrup is not in it: the
      syrup still holds that value on the shelf, and it is counted when the
      syrup is sold, wasted or written off. Adding both would count it twice.
    */
    value:           round2(rows.reduce((t, r) => t + (r.sold + r.wasted + r.writtenOff) * r.costPrice, 0)),
  });

  const whole = new Map<string, Parts>();
  const dayKeys = [...new Set([...byDay.keys(), ...waitingByDay.keys()])].sort();
  const days: UsageDay[] = dayKeys.map((day) => {
    const perRm = byDay.get(day) ?? new Map<string, Parts>();
    for (const [id, parts] of perRm) {
      const sum = whole.get(id) ?? { sold: 0, wasted: 0, intoPreps: 0, writtenOff: 0 };
      for (const k of Object.keys(parts) as Reason[]) sum[k] += parts[k];
      whole.set(id, sum);
    }
    const rows = [...perRm].map(([id, parts]) => rowOf(id, parts)).sort(byValue);
    return { day, rows, totals: totalsOf(rows), stillBeingMade: waitingByDay.get(day) ?? 0 };
  });
  const rows = [...whole].map(([id, parts]) => rowOf(id, parts)).sort(byValue);

  return {
    from: from.toISOString(),
    to:   to.toISOString(),
    branchId,
    days,
    rows,
    totals: totalsOf(rows),
    stillBeingMade: round4(days.reduce((t, d) => t + d.stillBeingMade, 0)),
  };
}
