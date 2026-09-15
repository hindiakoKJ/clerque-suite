import { IngredientReportsService } from './ingredient-reports.service';

/**
 * The ingredient report and tickets still waiting at a kitchen or bar screen.
 *
 * A waiting recipe line takes its ingredients only when it is marked ready.
 * While it waits:
 *   - it has used nothing, so it is not consumption (and counting it threw the
 *     derived opening figure off by what it holds);
 *   - its milk is still on the books, so closing stock stays the book figure --
 *     the same number the stock screen and the valuation show;
 *   - but that milk is promised, so days of cover and the low-stock flag are
 *     read from closing less what is held.
 */
describe('Ingredient report and tickets still waiting at a screen', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const OTHER  = 'b2';
  const MILK   = 'rm-milk';
  const LATTE  = 'p-latte';

  interface Order {
    id: string; branch?: string; status?: string;
    lines: Array<{ qty: number; waiting?: boolean; confirmedAt?: Date }>;
  }

  function build(opts: { orders?: Order[]; onHand?: Record<string, number> } = {}) {
    const orders = (opts.orders ?? []).map((o) => ({
      id: o.id,
      orderNumber: `ORD-${o.id}`,
      branchId: o.branch ?? BRANCH,
      status: o.status ?? 'COMPLETED',
      paidAt: new Date('2026-09-10T02:00:00Z'),
      completedAt: new Date('2026-09-10T02:05:00Z'),
      items: o.lines.map((l) => ({
        productId: LATTE, variantId: null, modifiers: [], product: { name: 'Latte' },
        quantity: l.qty, refundedQty: 0,
        usageOnReady: l.waiting === true || l.confirmedAt != null,
        usagePostedAt: l.confirmedAt ?? null,
      })),
    }));
    const branchMatches = (want: any, got: string) =>
      want == null || (typeof want === 'string' ? want === got : (want.in ?? []).includes(got));
    const statusMatches = (want: any, got: string) => (want?.in ?? [got]).includes(got);

    const prisma: any = {
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue([{ id: MILK, name: 'Milk', unit: 'ml', costPrice: 0.1, lowStockAlert: 2_500 }]),
        findFirst: jest.fn().mockResolvedValue({ id: MILK, name: 'Milk', unit: 'ml', costPrice: 0.1 }),
      },
      rawMaterialInventory: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(
          Object.entries(opts.onHand ?? {})
            .filter(([b]) => branchMatches(where.branchId, b))
            .map(([branchId, quantity]) => ({ branchId, rawMaterialId: MILK, quantity })),
        )),
      },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]) },
      order: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(
          orders.filter((o) => statusMatches(where.status, o.status) && branchMatches(where.branchId, o.branchId)),
        )),
      },
      // The hold's query: waiting lines of live orders at the branches asked.
      orderItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(
          orders
            .filter((o) => statusMatches(where.order.status, o.status) && branchMatches(where.order.branchId, o.branchId))
            .flatMap((o) => o.items
              .filter((i) => i.usageOnReady === where.usageOnReady && i.usagePostedAt === where.usagePostedAt)
              .map((i) => ({ ...i, order: { branchId: o.branchId } }))),
        )),
      },
      bomItem: {
        findMany: jest.fn().mockResolvedValue([
          { productId: LATTE, rawMaterialId: MILK, quantity: 200, rawMaterial: { name: 'Milk', unit: 'ml', costPrice: 0.1, lotsTracked: false } },
        ]),
      },
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      accountingEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new IngredientReportsService(prisma);
  }

  const MADE_30 = Array.from({ length: 30 }, (_, n) => ({ id: `made-${n}`, lines: [{ qty: 1 }] }));
  const RANGE = { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' };   // 30 days
  const milkOf = (rep: any) => rep.rows.find((r: any) => r.id === MILK);

  // ─────────────────────────── aggregated report ───────────────────────────

  describe('aggregated report', () => {
    it('reads cover and low stock from what a ticket waiting at the branch leaves', async () => {
      // 30 lattes made at the sale (6,000 ml, 200 a day); 5 more waiting at the bar.
      const milk = milkOf(await build({
        orders: [...MADE_30, { id: 'wait', lines: [{ qty: 5, waiting: true }] }],
        onHand: { [BRANCH]: 3_000 },
      }).getAggregatedReport(TENANT, { ...RANGE, branchId: BRANCH }));

      expect(milk.consumptionQty).toBe(6_000);   // the waiting 5 have used nothing
      expect(milk.closingQty).toBe(3_000);       // the book figure
      expect(milk.closingValue).toBe(300);
      expect(milk.openingQty).toBe(9_000);       // 3,000 - 0 bought + 6,000 used
      expect(milk.heldQty).toBe(1_000);
      expect(milk.availableQty).toBe(2_000);
      expect(milk.daysOfStock).toBe(10);         // 2,000 / 200, not 3,000 / 200
      expect(milk.isLowStock).toBe(true);        // 2,000 is under the 2,500 alert; 3,000 is not
    });

    it('does not count a ticket waiting at another branch, or on a voided order', async () => {
      const milk = milkOf(await build({
        orders: [
          ...MADE_30,
          { id: 'elsewhere', branch: OTHER, lines: [{ qty: 5, waiting: true }] },
          { id: 'voided', status: 'VOIDED', lines: [{ qty: 5, waiting: true }] },
        ],
        onHand: { [BRANCH]: 3_000, [OTHER]: 5_000 },
      }).getAggregatedReport(TENANT, { ...RANGE, branchId: BRANCH }));

      expect(milk.heldQty).toBe(0);
      expect(milk.availableQty).toBe(3_000);
      expect(milk.daysOfStock).toBe(15);
      expect(milk.isLowStock).toBe(false);
    });

    it('holds for every branch when no branch is asked', async () => {
      const milk = milkOf(await build({
        orders: [...MADE_30, { id: 'elsewhere', branch: OTHER, lines: [{ qty: 5, waiting: true }] }],
        onHand: { [BRANCH]: 3_000, [OTHER]: 5_000 },
      }).getAggregatedReport(TENANT, RANGE));

      expect(milk.closingQty).toBe(8_000);
      expect(milk.heldQty).toBe(1_000);
      expect(milk.availableQty).toBe(7_000);
    });

    it('counts a line that waited once it is marked ready', async () => {
      const milk = milkOf(await build({
        orders: [...MADE_30, { id: 'bumped', lines: [{ qty: 5, confirmedAt: new Date('2026-09-10T02:04:00Z') }] }],
        onHand: { [BRANCH]: 2_000 },
      }).getAggregatedReport(TENANT, { ...RANGE, branchId: BRANCH }));

      expect(milk.consumptionQty).toBe(7_000);
      expect(milk.heldQty).toBe(0);
    });

    it('is unchanged when nothing is waiting', async () => {
      const milk = milkOf(await build({ orders: MADE_30, onHand: { [BRANCH]: 3_000 } })
        .getAggregatedReport(TENANT, { ...RANGE, branchId: BRANCH }));

      expect(milk.consumptionQty).toBe(6_000);
      expect(milk.closingQty).toBe(3_000);
      expect(milk.heldQty).toBe(0);
      expect(milk.availableQty).toBe(3_000);
      expect(milk.daysOfStock).toBe(15);
      expect(milk.isLowStock).toBe(false);
    });
  });

  // ─────────────────────────────── movements ───────────────────────────────

  describe('movements', () => {
    const consumption = (out: any) => out.movements.filter((m: any) => m.kind === 'CONSUMPTION');

    it('leaves a waiting line out of what the order consumed', async () => {
      const out = await build({
        orders: [{ id: 'mixed', lines: [{ qty: 2 }, { qty: 1, waiting: true }] }],
      }).getMovements(TENANT, MILK, { branchId: BRANCH });

      expect(consumption(out)).toHaveLength(1);
      expect(consumption(out)[0].quantity).toBe(-400);
      expect(consumption(out)[0].reference).toBe('2× Latte');
    });

    it('shows no consumption for an order whose only line is still waiting', async () => {
      const out = await build({ orders: [{ id: 'wait', lines: [{ qty: 3, waiting: true }] }] })
        .getMovements(TENANT, MILK, { branchId: BRANCH });
      expect(consumption(out)).toHaveLength(0);
    });

    it('is unchanged for lines used at the sale or marked ready', async () => {
      const out = await build({
        orders: [{ id: 'done', lines: [{ qty: 2 }, { qty: 1, confirmedAt: new Date('2026-09-10T02:04:00Z') }] }],
      }).getMovements(TENANT, MILK, { branchId: BRANCH });
      expect(consumption(out)[0].quantity).toBe(-600);
    });
  });
});
