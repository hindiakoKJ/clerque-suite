import { movementsInWindow } from './sheet-movements';

/**
 * In, Waste and Used between two closing balances.
 *
 * The fake database applies the where clauses the real queries send (tenant,
 * branch, the write-time window), and the recipe walk is the real one
 * (loadLineRecipes), so a wrong window, a wrong column or a wrong recipe shows
 * up here as a wrong number.
 *
 * The owner's rule: the kitchen starts when an order is paid, and a void or
 * refund after that is settled by word of mouth -- Used is what sales took off
 * the book whatever happened to the sale later, and Waste is write-offs only.
 */
describe('movementsInWindow -- the In, Waste and Used columns of the daily sheet', () => {
  const T = 't1';
  const B = 'b1';
  /** An instant written as Manila wall-clock time. */
  const ph = (wall: string) => new Date(`${wall}+08:00`);
  // The sheet for Sep 17 at a shop closing at 21:00: from the 16th's save to the 17th's.
  const FROM = ph('2026-09-16T21:30:05');
  const TO = ph('2026-09-17T21:30:05');

  const LATTE = 'p-latte';
  const LARGE = 'v-large';
  const VANILLA = 'opt-vanilla';
  const OAT_SWAP = 'opt-oat';
  const MILK = 'rm-milk';
  const BEANS = 'rm-beans';
  const OAT = 'rm-oat';
  const SYRUP = 'rm-syrup';
  const SUGAR = 'rm-sugar';
  const WATER = 'rm-water';
  const SYRUP_BOTTLE = 'rm-syrup-bottle';

  interface Line {
    id: string; orderId: string; qty: number; refunded?: number; variant?: string; options?: string[];
    /** Used at the sale, stamped at this instant. */
    deductedAt?: Date;
    /** Waited at a screen and was confirmed at this instant. */
    postedAt?: Date;
  }
  interface Order { id: string; branch?: string; tenant?: string; status?: string; createdAt: Date }
  interface Cogs { orderId: string; lineId: string; createdAt: Date; stockTaken?: boolean; ingredients: Array<{ rawMaterialId: string; qty: number }> }
  interface Batch { branch?: string; tenant?: string; createdAt: Date; consumed: Array<{ id: string; qty: number }> }
  interface Lot { rm: string; qty: number; createdAt: Date; ref?: string | null; branch?: string; tenant?: string }

  function build(data: { orders?: Order[]; lines?: Line[]; cogs?: Cogs[]; batches?: Batch[]; lots?: Lot[] }) {
    const orders = (data.orders ?? []).map((o) => ({ tenantId: o.tenant ?? T, branchId: o.branch ?? B, status: o.status ?? 'COMPLETED', ...o }));
    const lines = (data.lines ?? []).map((l) => ({
      id: l.id, orderId: l.orderId, productId: LATTE, variantId: l.variant ?? null, quantity: l.qty, refundedQty: l.refunded ?? 0,
      modifiers: (l.options ?? []).map((modifierOptionId) => ({ modifierOptionId })),
      usageOnReady: l.postedAt != null, usagePostedAt: l.postedAt ?? null, ingredientsDeductedAt: l.deductedAt ?? l.postedAt ?? null,
    }));
    const events = [
      ...(data.cogs ?? []).map((c) => ({
        tenantId: T, type: 'COGS', orderId: c.orderId, createdAt: c.createdAt,
        payload: { orderId: c.orderId, orderItemId: c.lineId, units: 1, stockTaken: c.stockTaken ?? true, ingredients: c.ingredients, lots: [], lines: [] },
      })),
      ...(data.batches ?? []).map((b) => ({
        tenantId: b.tenant ?? T, type: 'INVENTORY_ADJUSTMENT', orderId: null, createdAt: b.createdAt,
        payload: {
          kind: 'SUB_RECIPE_BATCH', rawMaterialId: SYRUP, branchId: b.branch ?? B,
          consumed: b.consumed.map((c) => ({ rawMaterialId: c.id, name: c.id, unit: 'g', quantity: c.qty, unitCost: 0 })),
        },
      })),
    ];
    const lots = (data.lots ?? []).map((l) => ({
      tenantId: l.tenant ?? T, branchId: l.branch ?? B, rawMaterialId: l.rm, qtyReceived: l.qty, referenceNumber: l.ref ?? null, createdAt: l.createdAt,
    }));

    // The recipes: a latte is 18 g beans + 200 ml milk; a Large has its own 24 g + 300 ml; vanilla adds 15 ml syrup; oat swaps the milk.
    const raw = { name: 'x', unit: 'g', costPrice: null, lotsTracked: false };
    const bom = [
      { productId: LATTE, rawMaterialId: BEANS, quantity: 18, rawMaterial: raw },
      { productId: LATTE, rawMaterialId: MILK, quantity: 200, rawMaterial: raw },
    ];
    const variantBom = [
      { variantId: LARGE, rawMaterialId: BEANS, quantity: 24, rawMaterial: raw },
      { variantId: LARGE, rawMaterialId: MILK, quantity: 300, rawMaterial: raw },
    ];
    const options = [
      { id: VANILLA, recipeMultiplier: null, ingredients: [{ rawMaterialId: SYRUP, quantity: 15, rawMaterial: raw }] },
      { id: OAT_SWAP, recipeMultiplier: null, ingredients: [{ rawMaterialId: MILK, quantity: -200, rawMaterial: raw }, { rawMaterialId: OAT, quantity: 200, rawMaterial: raw }] },
    ];

    const t = (x: any) => (x instanceof Date ? x.getTime() : x);
    const inRange = (value: any, cond: any) => cond === undefined || (value != null
      && (cond.gte === undefined || t(value) >= t(cond.gte)) && (cond.lt === undefined || t(value) < t(cond.lt)));
    const orderOf = (id: string) => orders.find((o) => o.id === id)!;
    const orderMatches = (o: any, w: any) => o.tenantId === w.tenantId && o.branchId === w.branchId && inRange(o.createdAt, w.createdAt);

    const prisma: any = {
      rawMaterialLot: {
        findMany: jest.fn(async ({ where }: any) => lots.filter((l) => l.tenantId === where.tenantId && l.branchId === where.branchId
          && inRange(l.createdAt, where.createdAt) && (where.NOT?.qtyReceived === undefined || l.qtyReceived !== where.NOT.qtyReceived))),
      },
      orderItem: {
        findMany: jest.fn(async ({ where }: any) => lines
          .filter((l) => l.usageOnReady === where.usageOnReady)
          .filter((l) => (where.ingredientsDeductedAt ? inRange(l.ingredientsDeductedAt, where.ingredientsDeductedAt) : true))
          .filter((l) => (where.usagePostedAt ? inRange(l.usagePostedAt, where.usagePostedAt) : true))
          .filter((l) => orderMatches(orderOf(l.orderId), where.order))),
      },
      accountingEvent: {
        findMany: jest.fn(async ({ where }: any) => events
          .filter((e) => e.tenantId === where.tenantId && e.type === where.type)
          .filter((e) => (where.orderId ? where.orderId.in.includes(e.orderId) : true))
          .filter((e) => inRange(e.createdAt, where.createdAt))
          .filter((e) => (where.AND ?? []).every((c: any) => (e.payload as any)[c.payload.path[0]] === c.payload.equals))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
      },
      bomItem: { findMany: jest.fn(async ({ where }: any) => bom.filter((b) => where.productId.in.includes(b.productId))) },
      variantBomItem: { findMany: jest.fn(async ({ where }: any) => variantBom.filter((b) => where.variantId.in.includes(b.variantId))) },
      modifierOption: { findMany: jest.fn(async ({ where }: any) => options.filter((o) => where.id.in.includes(o.id))) },
    };
    return prisma;
  }
  const read = (prisma: any, from = FROM, to = TO) => movementsInWindow(prisma, T, B, from, to);
  const obj = (m: Map<string, unknown>) => Object.fromEntries(m);

  it('a sale line stamped in the window is Used through its size\'s recipe and its add-ons, times its quantity', async () => {
    const prisma = build({
      orders: [{ id: 'o1', createdAt: ph('2026-09-17T10:00:00') }],
      lines: [
        { id: 'l1', orderId: 'o1', qty: 2, variant: LARGE, options: [VANILLA], deductedAt: ph('2026-09-17T10:00:01') },
        { id: 'l2', orderId: 'o1', qty: 1, options: [OAT_SWAP], deductedAt: ph('2026-09-17T10:00:01') },
      ],
    });
    expect(obj(await read(prisma))).toEqual({
      [BEANS]: { in: 0, waste: 0, used: 2 * 24 + 18 },
      [MILK]:  { in: 0, waste: 0, used: 2 * 300 },
      [SYRUP]: { in: 0, waste: 0, used: 2 * 15 },
      [OAT]:   { in: 0, waste: 0, used: 200 },
    });
  });

  it('a sale voided or refunded later still counts in Used: the kitchen already made it, and Waste is write-offs only', async () => {
    const prisma = build({
      orders: [{ id: 'o1', status: 'VOIDED', createdAt: ph('2026-09-17T10:00:00') }, { id: 'o2', createdAt: ph('2026-09-17T11:00:00') }],
      lines: [
        { id: 'l1', orderId: 'o1', qty: 1, deductedAt: ph('2026-09-17T10:00:01') },
        { id: 'l2', orderId: 'o2', qty: 2, refunded: 1, deductedAt: ph('2026-09-17T11:00:01') },
      ],
    });
    expect(obj(await read(prisma))).toEqual({
      [BEANS]: { in: 0, waste: 0, used: 54 },
      [MILK]:  { in: 0, waste: 0, used: 600 },
    });
  });

  it('a line that waited at a screen counts exactly what its confirm recorded taking, not the recipe', async () => {
    const prisma = build({
      orders: [{ id: 'o1', createdAt: ph('2026-09-17T09:00:00') }],
      lines: [{ id: 'l1', orderId: 'o1', qty: 1, variant: LARGE, postedAt: ph('2026-09-17T09:06:00') }],
      // The shelf had only 120 ml of milk left: the confirm floored and recorded what really came off.
      cogs: [{ orderId: 'o1', lineId: 'l1', createdAt: ph('2026-09-17T09:06:00'), ingredients: [{ rawMaterialId: BEANS, qty: 24 }, { rawMaterialId: MILK, qty: 120 }] }],
    });
    expect(obj(await read(prisma))).toEqual({ [BEANS]: { in: 0, waste: 0, used: 24 }, [MILK]: { in: 0, waste: 0, used: 120 } });
  });

  it('a waiting line the 02:30 job confirmed lands on the sheet after the closing save, when the stock really moved', async () => {
    const prisma = build({
      orders: [{ id: 'o1', createdAt: ph('2026-09-17T20:50:00') }],
      lines: [{ id: 'l1', orderId: 'o1', qty: 1, postedAt: ph('2026-09-18T02:30:00') }],
      cogs: [{ orderId: 'o1', lineId: 'l1', createdAt: ph('2026-09-18T02:30:00'), ingredients: [{ rawMaterialId: MILK, qty: 200 }] }],
    });
    expect((await read(prisma)).size).toBe(0);
    expect(obj(await read(prisma, TO, ph('2026-09-18T21:30:02')))).toEqual({ [MILK]: { in: 0, waste: 0, used: 200 } });
  });

  it('a confirm booked while deduction was paused (stockTaken false) adds nothing, nor does an old record an un-bump left behind', async () => {
    const prisma = build({
      orders: [{ id: 'o1', createdAt: ph('2026-09-17T09:00:00') }],
      lines: [
        { id: 'l1', orderId: 'o1', qty: 1, postedAt: ph('2026-09-17T09:06:00') },
        { id: 'l2', orderId: 'o1', qty: 1, postedAt: ph('2026-09-17T12:00:00') },
      ],
      cogs: [
        { orderId: 'o1', lineId: 'l1', createdAt: ph('2026-09-17T09:06:00'), stockTaken: false, ingredients: [{ rawMaterialId: MILK, qty: 200 }] },
        // l2 was confirmed at 09:10, un-bumped, and confirmed again at 12:00 with no record (refunded in full meanwhile).
        { orderId: 'o1', lineId: 'l2', createdAt: ph('2026-09-17T09:10:00'), ingredients: [{ rawMaterialId: MILK, qty: 200 }] },
      ],
    });
    expect((await read(prisma)).size).toBe(0);
  });

  it('a prep batch: its components are Used, and the prep itself comes In through its lot', async () => {
    const prisma = build({
      batches: [{ createdAt: ph('2026-09-17T08:00:00'), consumed: [{ id: SUGAR, qty: 1200 }, { id: WATER, qty: 1000 }] }],
      lots: [{ rm: SYRUP, qty: 2000, createdAt: ph('2026-09-17T08:00:00'), ref: null }],
    });
    expect(obj(await read(prisma))).toEqual({
      [SUGAR]: { in: 0, waste: 0, used: 1200 },
      [WATER]: { in: 0, waste: 0, used: 1000 },
      [SYRUP]: { in: 2000, waste: 0, used: 0 },
    });
  });

  it('moving a prep up a level is Used on the parked bottle and In on the one ready to use -- counted once', async () => {
    const prisma = build({
      batches: [{ createdAt: ph('2026-09-17T15:00:00'), consumed: [{ id: SYRUP, qty: 500 }] }],
      lots: [{ rm: SYRUP_BOTTLE, qty: 500, createdAt: ph('2026-09-17T15:00:00') }],
    });
    expect(obj(await read(prisma))).toEqual({
      [SYRUP]:        { in: 0, waste: 0, used: 500 },
      [SYRUP_BOTTLE]: { in: 500, waste: 0, used: 0 },
    });
  });

  it('a write-off\'s negative marker lot is Waste; a received lot with no reference is In; a cancelled transfer\'s return is not', async () => {
    const prisma = build({
      lots: [
        { rm: MILK, qty: -350.25, createdAt: ph('2026-09-17T20:00:00'), ref: 'WO-1' },
        { rm: MILK, qty: 4000, createdAt: ph('2026-09-17T07:00:00'), ref: null },
        { rm: BEANS, qty: 1000, createdAt: ph('2026-09-17T07:00:00'), ref: 'REQ-20260917-001' },
        { rm: BEANS, qty: 500, createdAt: ph('2026-09-17T13:00:00'), ref: 'TR-0003-CANCELLED' },
      ],
    });
    expect(obj(await read(prisma))).toEqual({
      [MILK]:  { in: 4000, waste: 350.25, used: 0 },
      [BEANS]: { in: 1000, waste: 0, used: 0 },
    });
  });

  it('asks only for sale lines on orders written in the last three days before the window', async () => {
    const prisma = build({});
    await read(prisma);
    const atSale = prisma.orderItem.findMany.mock.calls.map((c: any[]) => c[0].where).find((w: any) => w.usageOnReady === false);
    expect(atSale.order).toEqual({ tenantId: T, branchId: B, createdAt: { gte: new Date(FROM.getTime() - 3 * 24 * 60 * 60 * 1000) } });
  });

  it('another branch\'s and another shop\'s sales, batches and lots are left out', async () => {
    const prisma = build({
      orders: [{ id: 'o1', branch: 'b2', createdAt: ph('2026-09-17T10:00:00') }, { id: 'o2', tenant: 't2', createdAt: ph('2026-09-17T10:00:00') }],
      lines: [
        { id: 'l1', orderId: 'o1', qty: 1, deductedAt: ph('2026-09-17T10:00:01') },
        { id: 'l2', orderId: 'o2', qty: 1, deductedAt: ph('2026-09-17T10:00:01') },
      ],
      batches: [{ branch: 'b2', createdAt: ph('2026-09-17T08:00:00'), consumed: [{ id: SUGAR, qty: 1200 }] }],
      lots: [{ rm: MILK, qty: 4000, createdAt: ph('2026-09-17T07:00:00'), branch: 'b2' }, { rm: MILK, qty: 4000, createdAt: ph('2026-09-17T07:00:00'), tenant: 't2' }],
    });
    expect((await read(prisma)).size).toBe(0);
  });

  it('both edges are half-open: what happened at the save instant is on the next sheet, never both', async () => {
    const data = {
      orders: [{ id: 'o1', createdAt: ph('2026-09-16T21:30:00') }],
      lines: [
        { id: 'l1', orderId: 'o1', qty: 1, deductedAt: FROM },
        { id: 'l2', orderId: 'o1', qty: 1, deductedAt: TO },
      ],
      lots: [{ rm: MILK, qty: 1000, createdAt: FROM }, { rm: MILK, qty: 7, createdAt: TO }],
      batches: [{ createdAt: TO, consumed: [{ id: SUGAR, qty: 5 }] }],
    };
    expect(obj(await read(build(data)))).toEqual({ [BEANS]: { in: 0, waste: 0, used: 18 }, [MILK]: { in: 1000, waste: 0, used: 200 } });
    expect(obj(await read(build(data), TO, ph('2026-09-18T21:30:00')))).toEqual({
      [BEANS]: { in: 0, waste: 0, used: 18 }, [MILK]: { in: 7, waste: 0, used: 200 }, [SUGAR]: { in: 0, waste: 0, used: 5 },
    });
  });

  it('rounds each column to 4 decimal places, and an empty window reads nothing', async () => {
    const prisma = build({ lots: [{ rm: MILK, qty: 0.1, createdAt: ph('2026-09-17T07:00:00') }, { rm: MILK, qty: 0.2, createdAt: ph('2026-09-17T07:00:01') }] });
    expect((await read(prisma)).get(MILK)).toEqual({ in: 0.3, waste: 0, used: 0 });
    const empty = build({});
    expect((await read(empty, TO, TO)).size).toBe(0);
    expect(empty.rawMaterialLot.findMany).not.toHaveBeenCalled();
  });
});
