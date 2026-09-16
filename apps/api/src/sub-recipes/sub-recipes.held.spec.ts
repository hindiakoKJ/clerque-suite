import { rotationFromBoard } from '@repo/shared-types';
import { SubRecipesService } from './sub-recipes.service';

/**
 * The prep board and the batch screen, with plates still waiting at a screen.
 *
 * Under the deduct-on-ready rule a plate sold and still waiting at the kitchen
 * screen takes its sauce when it is marked ready, so until then the book still
 * counts it. The board decides from that number -- whether the tub is below
 * par, what the rotation says, how many plates are left -- and a batch is
 * refused or allowed by it. Both read what is free: the book less what waiting
 * tickets hold. The batch's own writes and its cost blend stay on the book.
 *
 * The fake database honours what the hold query asks for (tenant, branch,
 * order status, a line still waiting), so a ticket at another branch, on a
 * voided order or already marked ready is left out the way Postgres leaves it
 * out.
 */

const TENANT = 't1';
const BRANCH = 'b1';
const OTHER_BRANCH = 'b2';

type Ticket = {
  branchId: string;
  status: 'PAID' | 'COMPLETED' | 'VOIDED' | 'OPEN';
  productId: string;
  quantity: number;
  /** Already marked ready: its ingredients are off the book. */
  confirmed?: boolean;
};

/** What one of each dish or drink uses. */
const RECIPES: Record<string, Array<{ rawMaterialId: string; quantity: number }>> = {
  'p-spaghetti': [{ rawMaterialId: 'sauce', quantity: 200 }],
  'p-salad':     [{ rawMaterialId: 'tom', quantity: 300 }],
  'p-cookie':    [{ rawMaterialId: 'rm-sugar', quantity: 500 }],
  'p-latte':     [{ rawMaterialId: 'rm-syrup', quantity: 30 }],
};

function waitingTickets(tickets: Ticket[]) {
  return {
    findMany: jest.fn(({ where }: any) => Promise.resolve(tickets
      .filter((t) => where.usageOnReady === true && where.usagePostedAt === null && !t.confirmed
        && where.order.tenantId === TENANT
        && (where.order.status.in as string[]).includes(t.status)
        && (!where.order.branchId || (where.order.branchId.in as string[]).includes(t.branchId)))
      .map((t) => ({
        productId: t.productId, variantId: null, quantity: t.quantity, refundedQty: 0, modifiers: [],
        order: { branchId: t.branchId },
      })))),
  };
}

/**
 * One table, two questions: the recipes of waiting lines (asked by product),
 * and which dishes use a prep (asked by ingredient).
 */
function bomItems(usedBy: any[]) {
  return {
    findMany: jest.fn(({ where }: any) => Promise.resolve(where.productId
      ? (where.productId.in as string[]).flatMap((productId) => (RECIPES[productId] ?? []).map((l) => ({
          productId, rawMaterialId: l.rawMaterialId, quantity: l.quantity,
          rawMaterial: { name: l.rawMaterialId, unit: 'g', costPrice: null, lotsTracked: false },
        })))
      : usedBy)),
  };
}

const spaghetti = (n: number, over: Partial<Ticket> = {}): Ticket =>
  ({ branchId: BRANCH, status: 'PAID', productId: 'p-spaghetti', quantity: n, ...over });

describe('SubRecipesService.list — plates waiting at a screen hold their sauce', () => {
  const KITCHEN = { id: 'st-k', name: 'Kitchen', kind: 'KITCHEN' };

  // 2,000 g of ready sauce, par 1,000 g, made from 1,200 g of tomato a batch.
  const SAUCE = {
    id: 'sauce', name: 'Spag Sauce READY', unit: 'g', costPrice: 0.227, batchYield: 2000,
    lowStockAlert: 1000,
    inventory: [{ quantity: 2000 }],
    subRecipeItems: [
      { quantity: 1200, rawMaterial: { id: 'tom', name: 'Tomato', unit: 'g', costPrice: 0.12 } },
    ],
  };
  const USED_BY = [{
    rawMaterialId: 'sauce', quantity: 200,
    product: { id: 'p-spaghetti', name: 'Spaghetti', category: { id: 'c', name: 'Pasta', station: KITCHEN } },
  }];

  function build(tickets: Ticket[]) {
    const prisma: any = {
      rawMaterial: { findMany: jest.fn().mockResolvedValue([SAUCE]) },
      bomItem: bomItems(USED_BY),
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      orderItem: waitingTickets(tickets),
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([
          { rawMaterialId: 'sauce', quantity: 2000 },
          { rawMaterialId: 'tom', quantity: 6000 },
        ]),
      },
      station: {
        findFirst: jest.fn().mockResolvedValue({ ...KITCHEN, branchId: BRANCH }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH, name: 'Main' }) },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { svc: new SubRecipesService(prisma) as any, prisma };
  }

  const sauceOf = (rows: any[]) => rows.find((r) => r.id === 'sauce');

  it('with nothing waiting, reads exactly the book', async () => {
    const { svc } = build([]);
    const row = sauceOf(await svc.list(TENANT, BRANCH));
    expect(row).toMatchObject({ onHand: 2000, heldQty: 0, belowPar: false, batches: 5, batchesWithPrep: 5 });
    expect(row.serves[0].servingsLeft).toBe(10);
    expect(row.components[0]).toMatchObject({ rawMaterialId: 'tom', onHand: 6000, heldQty: 0 });
  });

  it('takes the sauce five waiting plates hold off what is left to serve from', async () => {
    // 5 x 200 g = 1,000 g still on the books, already sold.
    const { svc, prisma } = build([spaghetti(5)]);
    const row = sauceOf(await svc.list(TENANT, BRANCH));
    expect(row.onHand).toBe(1000);
    expect(row.heldQty).toBe(1000);
    expect(row.belowPar).toBe(true);                // 1,000 <= par 1,000
    expect(row.serves[0].servingsLeft).toBe(5);     // not 10
    // Asked for this branch and this shop only.
    const where = prisma.orderItem.findMany.mock.calls[0][0].where;
    expect(where.order).toMatchObject({ tenantId: TENANT, branchId: { in: [BRANCH] } });
  });

  it('turns the rotation from OK to top up, because it decides from the same figure', async () => {
    const before = rotationFromBoard(await build([]).svc.list(TENANT, BRANCH));
    const after  = rotationFromBoard(await build([spaghetti(5)]).svc.list(TENANT, BRANCH));
    expect(before[0]).toMatchObject({ state: 'OK', ready: { onHand: 2000, par: 1000 } });
    expect(after[0]).toMatchObject({ state: 'TOP_UP', ready: { onHand: 1000, par: 1000 } });
  });

  it('takes held tomato off a component, and off the batches it allows', async () => {
    // 10 salads x 300 g = 3,000 g of the 6,000 g is promised: two batches, not five.
    const { svc } = build([{ branchId: BRANCH, status: 'PAID', productId: 'p-salad', quantity: 10 }]);
    const row = sauceOf(await svc.list(TENANT, BRANCH));
    expect(row.components[0]).toMatchObject({ rawMaterialId: 'tom', onHand: 3000, heldQty: 3000 });
    expect(row.batches).toBe(2);
    expect(row.batchesWithPrep).toBe(2);
    expect(row.onHand).toBe(2000);                  // the sauce itself is not held
  });

  it('never reads below zero when more is held than the book shows', async () => {
    const { svc } = build([spaghetti(15)]);         // 3,000 g held of 2,000 g
    const row = sauceOf(await svc.list(TENANT, BRANCH));
    expect(row.onHand).toBe(0);
    expect(row.heldQty).toBe(3000);
    expect(row.serves[0].servingsLeft).toBe(0);
  });

  it('is not lowered by plates waiting at another branch', async () => {
    const none  = await build([]).svc.list(TENANT, BRANCH);
    const other = await build([spaghetti(5, { branchId: OTHER_BRANCH })]).svc.list(TENANT, BRANCH);
    expect(other).toEqual(none);
  });

  it('is not lowered by a voided order, or by a plate already marked ready', async () => {
    const none      = await build([]).svc.list(TENANT, BRANCH);
    const voided    = await build([spaghetti(5, { status: 'VOIDED' })]).svc.list(TENANT, BRANCH);
    const confirmed = await build([spaghetti(5, { confirmed: true })]).svc.list(TENANT, BRANCH);
    expect(voided).toEqual(none);
    expect(confirmed).toEqual(none);
  });

  it('shows the station screen the same free figure, and what to do about it', async () => {
    const at = new Date('2026-09-15T02:00:00Z');
    const none = await build([]).svc.stationPrep(TENANT, KITCHEN.id, BRANCH, at);
    const held = await build([spaghetti(5)]).svc.stationPrep(TENANT, KITCHEN.id, BRANCH, at);
    expect(none.rows[0]).toMatchObject({ onHand: 2000, status: 'OK' });
    expect(held.rows[0]).toMatchObject({ onHand: 1000, status: 'DO_NOW' });
  });
});

describe('SubRecipesService — batches, with tickets holding a component', () => {
  const SYRUP = 'rm-syrup';
  const cookies = (n: number, over: Partial<Ticket> = {}): Ticket =>
    ({ branchId: BRANCH, status: 'PAID', productId: 'p-cookie', quantity: n, ...over });

  function build(tickets: Ticket[], stock: Record<string, number> = {}) {
    const book: Record<string, number> = { 'rm-sugar': 8000, 'rm-water': 108000, ...stock };
    const balances: Record<string, number> = { ...book, [SYRUP]: 711 };
    const decrements: Record<string, number> = {};
    let newCost: number | null = null;

    const tx: any = {
      rawMaterialInventory: {
        update: jest.fn(({ where, data }: any) => {
          const id = where.branchId_rawMaterialId.rawMaterialId;
          decrements[id] = Number(data.quantity.decrement);
          balances[id] -= Number(data.quantity.decrement);
          return Promise.resolve({});
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        // The syrup's own book figure, read inside the transaction for the cost blend.
        findUnique: jest.fn().mockResolvedValue({ quantity: 711 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      rawMaterial: { update: jest.fn(({ data }: any) => { newCost = Number(data.costPrice); return Promise.resolve({}); }) },
      rawMaterialLot: {
        findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn().mockResolvedValue({}),
      },
      accountingEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: SYRUP, name: 'White Sugar Syrup', unit: 'ml', costPrice: 0.2, batchYield: 1130,
          subRecipeItems: [
            { id: 's1', quantity: 1000, rawMaterial: { id: 'rm-sugar', name: 'White Sugar', unit: 'g',  costPrice: 0.09  } },
            { id: 's2', quantity: 500,  rawMaterial: { id: 'rm-water', name: 'Water',       unit: 'ml', costPrice: 0.002 } },
          ],
        }),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue(Object.entries(book).map(([rawMaterialId, quantity]) => ({ rawMaterialId, quantity }))),
      },
      orderItem: waitingTickets(tickets),
      bomItem: bomItems([]),
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      station: { findMany: jest.fn().mockResolvedValue([]) },
      subRecipeItem: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    return { svc: new SubRecipesService(prisma) as any, prisma, decrements, cost: () => newCost };
  }

  const make = (svc: any, batches: number) => svc.makeBatch(TENANT, SYRUP, { branchId: BRANCH, batches }, 'u1');

  describe('how many could still be made', () => {
    it('with nothing waiting, is the book: 8 batches of sugar', async () => {
      const res = await build([]).svc.maxBatches(TENANT, SYRUP, BRANCH);
      expect(res).toEqual({ batches: 8, limitedBy: 'White Sugar', yieldPerBatch: 1130 });
    });

    it('leaves out the sugar six waiting cookies hold', async () => {
      // 6 x 500 g = 3,000 g promised: 5,000 g free is 5 batches.
      const res = await build([cookies(6)]).svc.maxBatches(TENANT, SYRUP, BRANCH);
      expect(res.batches).toBe(5);
      expect(res.limitedBy).toBe('White Sugar');
    });

    it('counts a served order whose line was never marked ready too', async () => {
      const res = await build([cookies(6, { status: 'COMPLETED' })]).svc.maxBatches(TENANT, SYRUP, BRANCH);
      expect(res.batches).toBe(5);
    });

    it('is not lowered by cookies waiting at another branch, or on a voided order', async () => {
      expect((await build([cookies(6, { branchId: OTHER_BRANCH })]).svc.maxBatches(TENANT, SYRUP, BRANCH)).batches).toBe(8);
      expect((await build([cookies(6, { status: 'VOIDED' })]).svc.maxBatches(TENANT, SYRUP, BRANCH)).batches).toBe(8);
    });
  });

  describe('recording a batch', () => {
    it('refuses sugar promised to waiting tickets, and says that is why', async () => {
      // 15 cookies hold 7,500 g of the 8,000 g: 500 g is free, a batch needs 1,000 g.
      const { svc, prisma } = build([cookies(15)]);
      const err = await make(svc, 1).catch((e: Error) => e);
      expect(err.message).toBe(
        'Not enough White Sugar: 1 batch(es) needs 1000 g, and there is 500 free -- another 7500 g is kept ' +
        'for tickets still waiting at a kitchen or bar screen. Receive more before recording this.',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('with nothing waiting, refuses and words it exactly as before', async () => {
      const { svc } = build([], { 'rm-sugar': 400 });
      await expect(make(svc, 1)).rejects.toThrow(
        'Not enough White Sugar: 1 batch(es) needs 1000 g, and there is 400. Receive more before recording this.',
      );
    });

    it('allows the batch when the same tickets are at another branch, or voided', async () => {
      await expect(make(build([cookies(15, { branchId: OTHER_BRANCH })]).svc, 1)).resolves.toMatchObject({ produced: 1130 });
      await expect(make(build([cookies(15, { status: 'VOIDED' })]).svc, 1)).resolves.toMatchObject({ produced: 1130 });
    });

    it('takes the batch off the book and blends cost on the book, whatever is held', async () => {
      // 3,000 g of sugar and 300 ml of syrup held; 3 batches need 3,000 g of the 5,000 g free.
      const { svc, decrements, cost } = build([cookies(6), { branchId: BRANCH, status: 'PAID', productId: 'p-latte', quantity: 10 }]);
      const res = await make(svc, 3);
      expect(decrements['rm-sugar']).toBe(3000);
      expect(res.quantityBefore).toBe(711);          // the syrup's book, not 711 - 300
      const unitCost = (3000 * 0.09 + 1500 * 0.002) / 3390;
      expect(cost()).toBeCloseTo((711 * 0.2 + 3390 * unitCost) / (711 + 3390), 9);
    });
  });
});
