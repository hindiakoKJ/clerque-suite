import { BadRequestException } from '@nestjs/common';
import { isManilaDay, manilaDayOf, manilaDayStart, usedByDay } from './daily-usage';
import { IngredientReportsService } from './ingredient-reports.service';

/**
 * The daily "ingredients used" sheet has to match what the staff count by
 * hand, so it has to count every way an ingredient leaves the shelf the way
 * the stock book does: the size's recipe and the add-ons, poured-then-refunded
 * drinks, waiting tickets only once made (on the day made, with the units that
 * were made), prep batches, write-offs -- on Manila days.
 *
 * The fake database filters on the where clauses the real queries send, so a
 * wrong window or a wrong status list shows up here as a wrong number.
 */
describe('usedByDay -- what left the shelf, per Manila day', () => {
  const TENANT = 't1';
  const B1 = 'b1';
  const B2 = 'b2';
  const LATTE = 'p-latte';
  const LARGE = 'v-large';
  const OAT_SWAP = 'opt-oat';
  const VANILLA = 'opt-vanilla';
  const MILK = 'rm-milk';
  const BEANS = 'rm-beans';
  const OAT = 'rm-oat';
  const SYRUP = 'rm-vanilla';
  const SUGAR = 'rm-sugar';
  const CREAM = 'rm-cream';

  /** An instant written as Manila wall-clock time. */
  const ph = (wall: string) => new Date(`${wall}+08:00`);
  const DAY15 = { from: manilaDayStart('2026-09-15'), to: manilaDayStart('2026-09-16') };
  const DAY16 = { from: manilaDayStart('2026-09-16'), to: manilaDayStart('2026-09-17') };

  interface Line {
    qty: number; refunded?: number; variant?: string; options?: string[];
    /** Waited at a screen. */
    waiting?: boolean;
    /** Marked ready at this instant. */
    readyAt?: Date;
  }
  interface Order { id: string; status?: string; branch?: string; paidAt: Date; lines: Line[] }
  interface Cogs { orderId: string; lineId: string; units: number; trigger?: 'READY' | 'NIGHTLY'; createdAt: Date }

  function build(data: {
    orders?: Order[];
    cogs?: Cogs[];
    batches?: Array<{ branch?: string; madeAt?: Date; createdAt: Date; consumed: Array<{ id: string; qty: number }> }>;
    lots?: Array<{ rm: string; qty: number; at: Date; branch?: string; unitCost?: number }>;
    onHand?: Array<{ rm: string; qty: number; branch?: string }>;
  }) {
    const orders = (data.orders ?? []).map((o) => ({
      id: o.id, tenantId: TENANT, branchId: o.branch ?? B1, status: o.status ?? 'COMPLETED',
      deletedAt: null, paidAt: o.paidAt, createdAt: o.paidAt,
    }));
    const items = (data.orders ?? []).flatMap((o) => o.lines.map((l, n) => ({
      id: `${o.id}-${n}`, orderId: o.id, productId: LATTE, variantId: l.variant ?? null,
      modifiers: (l.options ?? []).map((modifierOptionId) => ({ modifierOptionId })),
      quantity: l.qty, refundedQty: l.refunded ?? 0,
      usageOnReady: l.waiting === true || l.readyAt != null,
      usagePostedAt: l.readyAt ?? null,
    })));
    const events = [
      ...(data.cogs ?? []).map((c) => ({
        tenantId: TENANT, type: 'COGS', orderId: c.orderId, createdAt: c.createdAt,
        payload: { orderId: c.orderId, orderItemId: c.lineId, units: c.units, trigger: c.trigger ?? 'READY', lines: [] },
      })),
      ...(data.batches ?? []).map((b) => ({
        tenantId: TENANT, type: 'INVENTORY_ADJUSTMENT', orderId: null, createdAt: b.createdAt,
        payload: {
          kind: 'SUB_RECIPE_BATCH', rawMaterialId: 'rm-syrup', branchId: b.branch ?? B1,
          madeAt: (b.madeAt ?? b.createdAt).toISOString(),
          consumed: b.consumed.map((c) => ({ rawMaterialId: c.id, name: c.id, unit: 'g', quantity: c.qty, unitCost: 0 })),
        },
      })),
    ];
    const lots = (data.lots ?? []).map((l, n) => ({
      id: `lot-${n}`, tenantId: TENANT, branchId: l.branch ?? B1, rawMaterialId: l.rm,
      qtyReceived: l.qty, qtyRemaining: Math.max(l.qty, 0), unitCost: l.unitCost ?? 0, receivedAt: l.at,
    }));
    const RAW: Record<string, { name: string; unit: string; costPrice: number | null }> = {
      [MILK]:  { name: 'Milk', unit: 'ml', costPrice: 0.1 },
      [BEANS]: { name: 'Beans', unit: 'g', costPrice: 1.8 },
      [OAT]:   { name: 'Oat milk', unit: 'ml', costPrice: 0.2 },
      [SYRUP]: { name: 'Vanilla syrup', unit: 'ml', costPrice: 0.5 },
      [SUGAR]: { name: 'Sugar', unit: 'g', costPrice: 0.085 },
      [CREAM]: { name: 'Cream', unit: 'ml', costPrice: null },
    };
    const raw = (id: string) => ({ ...RAW[id], lotsTracked: false });

    const time = (x: any) => (x instanceof Date ? x.getTime() : Number(x));
    const matches = (value: any, cond: any): boolean => {
      if (cond === undefined) return true;
      if (cond === null) return value == null;
      if (cond instanceof Date || typeof cond !== 'object') return time(value) === time(cond) || value === cond;
      if ('in' in cond) return cond.in.includes(value);
      if ('not' in cond) return value !== cond.not;
      if (value == null) return false;
      const v = time(value);
      return (cond.gte === undefined || v >= time(cond.gte))
        && (cond.gt === undefined || v > time(cond.gt))
        && (cond.lt === undefined || v < time(cond.lt))
        && (cond.lte === undefined || v <= time(cond.lte));
    };
    const whereOrder = (o: any, w: any = {}): boolean => Object.entries(w).every(([k, c]: [string, any]) =>
      k === 'OR' ? c.some((alt: any) => whereOrder(o, alt)) : matches(o[k], c));
    const orderOf = (id: string) => orders.find((o) => o.id === id)!;
    const itemsOf = (orderId: string) => items.filter((i) => i.orderId === orderId);

    const prisma: any = {
      order: {
        findMany: jest.fn(async ({ where }: any) => orders
          .filter((o) => whereOrder(o, where))
          .map((o) => ({ ...o, items: itemsOf(o.id) }))),
      },
      orderItem: {
        findMany: jest.fn(async ({ where }: any) => items
          .filter((i) => matches(i.usageOnReady, where.usageOnReady) && matches(i.usagePostedAt, where.usagePostedAt))
          .filter((i) => whereOrder(orderOf(i.orderId), where.order))
          .map((i) => ({ ...i, order: orderOf(i.orderId) }))),
      },
      accountingEvent: {
        findMany: jest.fn(async ({ where }: any) => events
          .filter((e) => matches(e.tenantId, where.tenantId) && matches(e.type, where.type))
          .filter((e) => matches(e.orderId, where.orderId) && matches(e.createdAt, where.createdAt))
          .filter((e) => !where.payload || (e.payload as any)[where.payload.path[0]] === where.payload.equals)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
      },
      rawMaterialLot: {
        findMany: jest.fn(async ({ where }: any) => lots.filter((l) =>
          matches(l.tenantId, where.tenantId) && matches(l.qtyReceived, where.qtyReceived)
          && matches(l.receivedAt, where.receivedAt) && matches(l.branchId, where.branchId))),
      },
      rawMaterial: {
        findMany: jest.fn(async ({ where }: any) => Object.entries(RAW)
          .filter(([id]) => matches(id, where.id))
          .map(([id, r]) => ({ id, ...r, lowStockAlert: null }))),
      },
      rawMaterialInventory: {
        findMany: jest.fn(async ({ where }: any) => (data.onHand ?? [])
          .map((h) => ({ branchId: h.branch ?? B1, rawMaterialId: h.rm, quantity: h.qty }))
          .filter((h) => matches(h.branchId, where.branchId))),
      },
      // Latte: 200 ml milk, 18 g beans. A Large has its own recipe: 300 ml, 27 g.
      bomItem: {
        findMany: jest.fn(async ({ where }: any) => (where.productId.in.includes(LATTE) ? [
          { productId: LATTE, rawMaterialId: MILK, quantity: 200, rawMaterial: raw(MILK) },
          { productId: LATTE, rawMaterialId: BEANS, quantity: 18, rawMaterial: raw(BEANS) },
        ] : [])),
      },
      variantBomItem: {
        findMany: jest.fn(async ({ where }: any) => (where.variantId.in.includes(LARGE) ? [
          { variantId: LARGE, rawMaterialId: MILK, quantity: 300, rawMaterial: raw(MILK) },
          { variantId: LARGE, rawMaterialId: BEANS, quantity: 27, rawMaterial: raw(BEANS) },
        ] : [])),
      },
      // Oat milk instead of dairy: takes the dairy off, puts 280 ml oat on. Vanilla adds 15 ml syrup.
      modifierOption: {
        findMany: jest.fn(async ({ where }: any) => [
          { id: OAT_SWAP, recipeMultiplier: null, ingredients: [
            { rawMaterialId: MILK, quantity: -300, rawMaterial: raw(MILK) },
            { rawMaterialId: OAT, quantity: 280, rawMaterial: raw(OAT) },
          ] },
          { id: VANILLA, recipeMultiplier: null, ingredients: [{ rawMaterialId: SYRUP, quantity: 15, rawMaterial: raw(SYRUP) }] },
        ].filter((o) => where.id.in.includes(o.id))),
      },
    };
    return prisma;
  }

  const rowOf = (rows: any[], id: string) => rows.find((r) => r.rawMaterialId === id);
  const dayOf = (usage: any, day: string) => usage.days.find((d: any) => d.day === day);

  // ─────────────────────────────── order lines ───────────────────────────────

  it('counts a size recipe and its add-ons, with oat milk taking the dairy off', async () => {
    const db = build({ orders: [
      { id: 'reg', paidAt: ph('2026-09-15T09:00:00'), lines: [{ qty: 1 }] },
      { id: 'big', paidAt: ph('2026-09-15T09:05:00'), lines: [{ qty: 2, variant: LARGE, options: [OAT_SWAP, VANILLA] }] },
    ] });
    const { rows } = await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to);

    expect(rowOf(rows, MILK).sold).toBe(200);            // the Regular only: the Larges' 600 ml were swapped out
    expect(rowOf(rows, BEANS).sold).toBe(18 + 2 * 27);   // the Large recipe, not the Regular's 18 g
    expect(rowOf(rows, OAT).sold).toBe(560);
    expect(rowOf(rows, SYRUP).sold).toBe(30);
    // One batched recipe walk for every line, not one per line.
    expect(db.bomItem.findMany).toHaveBeenCalledTimes(1);
  });

  it('still counts a refunded drink: its milk was poured, so the refunded one is wasted, not returned', async () => {
    const db = build({ orders: [{ id: 'o', paidAt: ph('2026-09-15T10:00:00'), lines: [{ qty: 2, refunded: 1 }] }] });
    const milk = rowOf((await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to)).rows, MILK);

    expect(milk).toMatchObject({ sold: 200, wasted: 200, total: 400, value: 40 });
  });

  it('counts every made line of a voided order as wasted', async () => {
    const db = build({ orders: [{ id: 'o', status: 'VOIDED', paidAt: ph('2026-09-15T10:00:00'), lines: [{ qty: 2 }] }] });
    const milk = rowOf((await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to)).rows, MILK);

    expect(milk).toMatchObject({ sold: 0, wasted: 400, total: 400 });
  });

  it('does not count a voided line that was still waiting at the bar -- it was never made', async () => {
    const db = build({ orders: [{ id: 'o', status: 'VOIDED', paidAt: ph('2026-09-15T10:00:00'), lines: [{ qty: 3, waiting: true }] }] });
    const usage = await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to);

    expect(usage.rows).toEqual([]);
    expect(usage.stillBeingMade).toBe(0);   // and it will never be made
  });

  it('reports a line still waiting as still being made, using nothing yet', async () => {
    const db = build({ orders: [{ id: 'o', status: 'PAID', paidAt: ph('2026-09-15T20:00:00'), lines: [{ qty: 3, refunded: 1, waiting: true }] }] });
    const usage = await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to);

    expect(usage.rows).toEqual([]);
    expect(dayOf(usage, '2026-09-15').stillBeingMade).toBe(2);
  });

  it('counts a waiting line on the day it was made, with the units its confirm recorded', async () => {
    /*
      Sold at 23:50 on the 15th, 3 ordered, 1 refunded while it waited, made
      at 00:10 on the 16th. An earlier confirm (un-bumped) recorded 3; the
      newest recorded 2. It used 2 lattes' milk, on the 16th.
    */
    const db = build({
      orders: [{ id: 'late', status: 'COMPLETED', paidAt: ph('2026-09-15T23:50:00'), lines: [{ qty: 3, refunded: 1, readyAt: ph('2026-09-16T00:10:00') }] }],
      cogs: [
        { orderId: 'late', lineId: 'late-0', units: 3, createdAt: ph('2026-09-15T23:55:00') },
        { orderId: 'late', lineId: 'late-0', units: 2, createdAt: ph('2026-09-16T00:10:00') },
      ],
    });

    expect((await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to)).rows).toEqual([]);
    const on16 = await usedByDay(db, TENANT, B1, DAY16.from, DAY16.to);
    expect(rowOf(on16.rows, MILK)).toMatchObject({ sold: 400, wasted: 0 });
  });

  it('counts a waiting line refunded after it was made as wasted', async () => {
    const db = build({
      orders: [{ id: 'o', paidAt: ph('2026-09-15T10:00:00'), lines: [{ qty: 2, refunded: 1, readyAt: ph('2026-09-15T10:04:00') }] }],
      cogs: [{ orderId: 'o', lineId: 'o-0', units: 2, createdAt: ph('2026-09-15T10:04:00') }],
    });
    const milk = rowOf((await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to)).rows, MILK);

    expect(milk).toMatchObject({ sold: 200, wasted: 200, total: 400 });
  });

  describe('a confirm record left behind by an un-bump', () => {
    /*
      Bumped (record: 1 made), un-bumped -- the milk goes back, the record
      stays -- then refunded in full while it waited again. The nightly job
      confirms it with 0 units and writes no record. That old record must not
      turn a drink nobody made into 200 ml wasted.
    */
    it('does not count a drink bumped, un-bumped, refunded and confirmed empty by the nightly job', async () => {
      const db = build({
        orders: [{ id: 'o', status: 'COMPLETED', paidAt: ph('2026-09-15T10:00:00'), lines: [{ qty: 1, refunded: 1, readyAt: ph('2026-09-16T02:30:00') }] }],
        cogs: [{ orderId: 'o', lineId: 'o-0', units: 1, trigger: 'READY', createdAt: ph('2026-09-15T10:05:00') }],
      });

      expect((await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to)).rows).toEqual([]);
      expect((await usedByDay(db, TENANT, B1, DAY16.from, DAY16.to)).rows).toEqual([]);
    });

    it('does not put that phantom waste back on the sale day when the old record was the nightly job\'s', async () => {
      // Sold on the 14th, confirmed by the 02:30 job on the 15th, un-bumped, refunded, confirmed empty on the 16th.
      const db = build({
        orders: [{ id: 'o', status: 'COMPLETED', paidAt: ph('2026-09-14T20:00:00'), lines: [{ qty: 1, refunded: 1, readyAt: ph('2026-09-16T02:30:00') }] }],
        cogs: [{ orderId: 'o', lineId: 'o-0', units: 1, trigger: 'NIGHTLY', createdAt: ph('2026-09-15T02:30:05') }],
      });

      expect((await usedByDay(db, TENANT, B1, manilaDayStart('2026-09-14'), DAY16.to)).rows).toEqual([]);
    });

    it('still reads the confirm\'s own record when the database clock is a few seconds behind the stamp', async () => {
      // Made 2, one refunded after: 1 sold, 1 wasted. Without the record it would read as 1 sold, 0 wasted.
      const db = build({
        orders: [{ id: 'o', paidAt: ph('2026-09-15T10:00:00'), lines: [{ qty: 2, refunded: 1, readyAt: ph('2026-09-15T10:04:30') }] }],
        cogs: [{ orderId: 'o', lineId: 'o-0', units: 2, createdAt: ph('2026-09-15T10:04:00') }],
      });

      expect(rowOf((await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to)).rows, MILK)).toMatchObject({ sold: 200, wasted: 200 });
    });
  });

  it('counts a line the nightly job confirmed on the day it was sold, not the morning after', async () => {
    const db = build({
      orders: [{ id: 'o', paidAt: ph('2026-09-15T20:00:00'), lines: [{ qty: 1, readyAt: ph('2026-09-16T02:30:00') }] }],
      cogs: [{ orderId: 'o', lineId: 'o-0', units: 1, trigger: 'NIGHTLY', createdAt: ph('2026-09-16T02:30:00') }],
    });

    expect(rowOf((await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to)).rows, MILK).sold).toBe(200);
    expect((await usedByDay(db, TENANT, B1, DAY16.from, DAY16.to)).rows).toEqual([]);
  });

  // ─────────────────────────── preps and write-offs ──────────────────────────

  it('counts what a prep batch took, on the day it was made even when recorded the next morning', async () => {
    const db = build({ batches: [
      { madeAt: ph('2026-09-15T22:00:00'), createdAt: ph('2026-09-16T08:00:00'), consumed: [{ id: SUGAR, qty: 1200 }] },
      { createdAt: ph('2026-09-15T14:00:00'), consumed: [{ id: SUGAR, qty: 600 }] },
      { branch: B2, createdAt: ph('2026-09-15T14:00:00'), consumed: [{ id: SUGAR, qty: 5000 }] },
    ] });
    const on15 = await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to);

    expect(rowOf(on15.rows, SUGAR)).toMatchObject({ intoPreps: 1800, sold: 0, total: 1800, value: 153 });
    expect((await usedByDay(db, TENANT, B1, DAY16.from, DAY16.to)).rows).toEqual([]);
  });

  it('counts write-offs from their marker rows, including an ingredient with no cost', async () => {
    const db = build({ lots: [
      { rm: MILK, qty: -500, at: ph('2026-09-15T10:00:00'), unitCost: 0.1 },
      { rm: CREAM, qty: -100, at: ph('2026-09-15T11:00:00') },   // no cost: no accounting event was ever written
      { rm: MILK, qty: 10_000, at: ph('2026-09-15T07:00:00'), unitCost: 0.1 },   // a delivery, not a write-off
    ] });
    const { rows } = await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to);

    expect(rowOf(rows, MILK)).toMatchObject({ writtenOff: 500, total: 500, value: 50 });
    expect(rowOf(rows, CREAM)).toMatchObject({ writtenOff: 100, total: 100, value: 0 });
  });

  // ──────────────────────────────── the day ─────────────────────────────────

  it('splits days at Manila midnight: 23:30 and 00:30 are different days (both the 15th in UTC)', async () => {
    const db = build({ orders: [
      { id: 'before', paidAt: ph('2026-09-15T23:30:00'), lines: [{ qty: 1 }] },
      { id: 'after',  paidAt: ph('2026-09-16T00:30:00'), lines: [{ qty: 2 }] },
    ] });
    const usage = await usedByDay(db, TENANT, B1, DAY15.from, DAY16.to);

    expect(usage.days.map((d) => d.day)).toEqual(['2026-09-15', '2026-09-16']);
    expect(rowOf(dayOf(usage, '2026-09-15').rows, MILK).sold).toBe(200);
    expect(rowOf(dayOf(usage, '2026-09-16').rows, MILK).sold).toBe(400);
    expect(rowOf(usage.rows, MILK).sold).toBe(600);
    // One day's window keeps its own.
    expect(rowOf((await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to)).rows, MILK).sold).toBe(200);
  });

  it('keeps to the branch asked for, and takes every branch when none is', async () => {
    const db = build({ orders: [
      { id: 'here',  paidAt: ph('2026-09-15T09:00:00'), lines: [{ qty: 1 }] },
      { id: 'there', branch: B2, paidAt: ph('2026-09-15T09:00:00'), lines: [{ qty: 4 }] },
    ] });

    expect(rowOf((await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to)).rows, MILK).total).toBe(200);
    expect(rowOf((await usedByDay(db, TENANT, null, DAY15.from, DAY15.to)).rows, MILK).total).toBe(1000);
  });

  it('adds the day up in pesos at today\'s cost, most valuable ingredient first', async () => {
    const db = build({
      orders: [{ id: 'o', paidAt: ph('2026-09-15T09:00:00'), lines: [{ qty: 2, refunded: 1 }] }],
      batches: [{ createdAt: ph('2026-09-15T14:00:00'), consumed: [{ id: SUGAR, qty: 1000 }] }],
      lots: [{ rm: MILK, qty: -100, at: ph('2026-09-15T10:00:00') }],
    });
    const day = dayOf(await usedByDay(db, TENANT, B1, DAY15.from, DAY15.to), '2026-09-15');

    // Beans 36 g x 1.80 = 64.80; milk 500 ml x 0.10 = 50; sugar 1,000 g x 0.085 = 85.
    expect(day.rows.map((r: any) => r.rawMaterialId)).toEqual([SUGAR, BEANS, MILK]);
    /*
      The sugar row keeps its 85 (it did leave the sugar shelf), but the day's
      value does not: that sugar is syrup on the shelf now, counted again when
      the syrup is used. 52.40 + 52.40 + 10 = 114.80, not 199.80.
    */
    expect(rowOf(day.rows, SUGAR)).toMatchObject({ intoPreps: 1000, value: 85 });
    expect(day.totals).toEqual({ soldValue: 52.4, wastedValue: 52.4, intoPrepsValue: 85, writtenOffValue: 10, value: 114.8 });
  });

  it('reads a Manila day, and refuses one that is not a real date', () => {
    expect(manilaDayOf(new Date('2026-09-15T16:30:00Z'))).toBe('2026-09-16');
    expect(manilaDayStart('2026-09-16').toISOString()).toBe('2026-09-15T16:00:00.000Z');
    expect(isManilaDay('2026-09-16')).toBe(true);
    expect(isManilaDay('2026-02-30')).toBe(false);
    expect(isManilaDay('16/09/2026')).toBe(false);
  });

  // ───────────────────────────────── service ─────────────────────────────────

  describe('IngredientReportsService', () => {
    it('usedOn gives one day\'s rows, most valuable first', async () => {
      const svc = new IngredientReportsService(build({
        orders: [
          { id: 'o15', paidAt: ph('2026-09-15T09:00:00'), lines: [{ qty: 1 }] },
          { id: 'o16', paidAt: ph('2026-09-16T09:00:00'), lines: [{ qty: 5 }] },
        ],
      }));
      const rows = await svc.usedOn(TENANT, B1, '2026-09-15');

      expect(rows.map((r) => [r.name, r.total, r.value])).toEqual([['Beans', 18, 32.4], ['Milk', 200, 20]]);
      expect(await svc.usedOn(TENANT, B1, '2026-09-14')).toEqual([]);
      expect((await svc.usageForDay(TENANT, B1, '2026-09-14')).stillBeingMade).toBe(0);
    });

    it('usedOn refuses a day not written YYYY-MM-DD', async () => {
      const svc = new IngredientReportsService(build({}));
      await expect(svc.usedOn(TENANT, B1, 'yesterday')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('the ingredient report\'s consumption is the total used, split by why, over whole Manila days', async () => {
      const svc = new IngredientReportsService(build({
        orders: [
          { id: 'early', paidAt: ph('2026-09-15T00:30:00'), lines: [{ qty: 2, refunded: 1, variant: LARGE }] },
          { id: 'late',  paidAt: ph('2026-09-16T23:30:00'), lines: [{ qty: 1 }] },
          { id: 'next',  paidAt: ph('2026-09-17T00:30:00'), lines: [{ qty: 9 }] },
        ],
        lots: [{ rm: MILK, qty: -100, at: ph('2026-09-16T12:00:00') }],
        onHand: [{ rm: MILK, qty: 5_000 }],
      }));
      const rep: any = await svc.getAggregatedReport(TENANT, { from: '2026-09-15', to: '2026-09-16', branchId: B1 });
      const milk = rep.rows.find((r: any) => r.id === MILK);

      // 00:30 on the 15th and 23:30 on the 16th are in; 00:30 on the 17th is not.
      expect(milk).toMatchObject({ soldQty: 500, wastedQty: 300, intoPrepsQty: 0, writtenOffQty: 100, consumptionQty: 900 });
      expect(milk.consumptionValue).toBeCloseTo(90);
      expect(milk.openingQty).toBe(5_900);
      expect(rep.days).toBe(2);
      expect(rep.from).toBe('2026-09-14T16:00:00.000Z');
      expect(rep.totals.wastedValue + rep.totals.soldValue + rep.totals.writtenOffValue).toBeCloseTo(rep.totals.consumptionValue);
    });

    it('the ingredient report\'s consumption total leaves out what went into preps, but each row keeps it', async () => {
      const svc = new IngredientReportsService(build({
        orders: [{ id: 'o', paidAt: ph('2026-09-15T09:00:00'), lines: [{ qty: 1 }] }],
        batches: [{ createdAt: ph('2026-09-15T14:00:00'), consumed: [{ id: SUGAR, qty: 1200 }] }],
        onHand: [{ rm: SUGAR, qty: 10_000 }],
      }));
      const rep: any = await svc.getAggregatedReport(TENANT, { from: '2026-09-15', to: '2026-09-15', branchId: B1 });
      const sugar = rep.rows.find((r: any) => r.id === SUGAR);

      // The sugar did leave the sugar shelf: its row, and the opening worked back from it, keep the 1,200 g.
      expect(sugar).toMatchObject({ intoPrepsQty: 1200, consumptionQty: 1200, openingQty: 11_200 });
      expect(sugar.consumptionValue).toBeCloseTo(102);
      // It became syrup still on the shelf, so the peso total does not count it: milk 20 + beans 32.40 only.
      expect(rep.totals.intoPrepsValue).toBeCloseTo(102);
      expect(rep.totals.consumptionValue).toBeCloseTo(52.4);
      expect(rep.totals.soldValue + rep.totals.wastedValue + rep.totals.writtenOffValue).toBeCloseTo(rep.totals.consumptionValue);
    });

    describe('usageForWindow -- one sheet from one closing to the next', () => {
      /*
        A cafe closing at 01:00: the sheet sent at 01:00 on the 17th covers
        01:00 on the 16th up to then, so the 00:30 latte after midnight is on
        it. usageForDay cuts at midnight and would miss it.
      */
      const WINDOW = { from: ph('2026-09-16T01:00:00'), to: ph('2026-09-17T01:00:00') };
      const svcFor = () => new IngredientReportsService(build({
        orders: [
          { id: 'too-early', paidAt: ph('2026-09-16T00:30:00'), lines: [{ qty: 7 }] },          // last night's sheet
          { id: 'evening',   paidAt: ph('2026-09-16T21:30:00'), lines: [{ qty: 1 }] },
          { id: 'after-12',  paidAt: ph('2026-09-17T00:30:00'), lines: [{ qty: 2 }] },
          { id: 'waiting',   status: 'PAID', paidAt: ph('2026-09-17T00:45:00'), lines: [{ qty: 3, waiting: true }] },
          { id: 'too-late',  paidAt: ph('2026-09-17T01:00:00'), lines: [{ qty: 9 }] },          // tomorrow's sheet
        ],
        batches: [{ createdAt: ph('2026-09-17T00:10:00'), consumed: [{ id: SUGAR, qty: 1000 }] }],
      }));

      it('counts both sides of midnight under the one label, and nothing outside the window', async () => {
        const sheet = await svcFor().usageForWindow(TENANT, B1, '2026-09-16', WINDOW.from, WINDOW.to);

        expect(sheet.day).toBe('2026-09-16');
        expect(rowOf(sheet.rows, MILK)).toMatchObject({ sold: 600, total: 600 });   // 21:30 x1 and 00:30 x2
        expect(rowOf(sheet.rows, SUGAR)).toMatchObject({ intoPreps: 1000 });        // made at 00:10
        expect(sheet.stillBeingMade).toBe(3);                                         // rung at 00:45, still at the bar
        // Milk 60 + beans 97.20; the sugar went into syrup, so it is not in the value.
        expect(sheet.totals).toEqual({ soldValue: 157.2, wastedValue: 0, intoPrepsValue: 85, writtenOffValue: 0, value: 157.2 });
        expect(sheet.rows.map((r) => r.rawMaterialId)).toEqual([BEANS, SUGAR, MILK]);
      });

      it('is not the calendar day: usageForDay still cuts at midnight', async () => {
        const svc = svcFor();
        expect(rowOf((await svc.usageForDay(TENANT, B1, '2026-09-16')).rows, MILK).sold).toBe(1600);   // 00:30 x7 + 21:30 x1
        expect(rowOf((await svc.usageForWindow(TENANT, B1, '2026-09-16', WINDOW.from, WINDOW.to)).rows, MILK).sold).toBe(600);
      });

      it('gives an empty sheet for a quiet window, and refuses a label that is not a real date', async () => {
        const svc = svcFor();
        const quiet = await svc.usageForWindow(TENANT, B1, '2026-09-10', ph('2026-09-10T01:00:00'), ph('2026-09-11T01:00:00'));
        expect(quiet).toEqual({
          day: '2026-09-10', rows: [], stillBeingMade: 0,
          totals: { soldValue: 0, wastedValue: 0, intoPrepsValue: 0, writtenOffValue: 0, value: 0 },
        });
        await expect(svc.usageForWindow(TENANT, B1, 'tonight', WINDOW.from, WINDOW.to)).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });
});
