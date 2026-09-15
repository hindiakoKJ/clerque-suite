import { InventoryReportsService } from './inventory-reports.service';

/**
 * Tickets still waiting at a kitchen or bar screen.
 *
 * A recipe line that waits at a screen takes its ingredients only when it is
 * marked ready. Until then the milk is still on the books, but it is already
 * promised -- and its cost is not booked yet, only guessed at the till.
 *
 *   variance   -- the waiting ticket is in expected use (it was sold), so the
 *                 actual figure has to be the book less what it holds, or every
 *                 open ticket reads as milk that should have gone and had not.
 *   depletion  -- the stock a forecast divides is what is left to sell.
 *   margin     -- a line with no booked cost stays out of cost and margin and
 *                 is reported as cost pending.
 */
describe('Inventory reports and tickets still waiting at a screen', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const OTHER  = 'b2';
  const MILK   = { id: 'milk', name: 'Fresh Milk', unit: 'ml', lotsTracked: true };
  const LATTE  = 'latte';

  interface Line {
    id: string; branch?: string; status?: string; qty: number; refunded?: number;
    waiting?: boolean; confirmedAt?: Date; lineTotal?: number; costPrice?: number | null;
  }

  function build(opts: {
    lines?: Line[];
    onHand?: Record<string, number>;          // branchId -> ml of milk
    counts?: Array<{ countedQty: number; postedAt: string }>;
  } = {}) {
    const rows = (opts.lines ?? []).map((l) => ({
      id: l.id,
      productId: LATTE, productName: 'Latte', variantId: null, modifiers: [],
      quantity: l.qty, refundedQty: l.refunded ?? 0,
      lineTotal: l.lineTotal ?? 150 * l.qty,
      costPrice: l.costPrice === undefined ? 40 : l.costPrice,
      usageOnReady: l.waiting === true || l.confirmedAt != null,
      usagePostedAt: l.confirmedAt ?? null,
      order: { branchId: l.branch ?? BRANCH, status: l.status ?? 'COMPLETED', createdAt: new Date('2026-09-04T02:00:00Z') },
    }));
    const branchMatches = (want: any, got: string) =>
      want == null || (typeof want === 'string' ? want === got : (want.in ?? []).includes(got));

    const prisma: any = {
      rawMaterial: { findMany: jest.fn().mockResolvedValue([MILK]) },
      cycleCountLine: {
        findMany: jest.fn().mockResolvedValue((opts.counts ?? []).map((c) => ({
          rawMaterialId: MILK.id, countedQty: c.countedQty,
          count: { postedAt: new Date(c.postedAt), countNumber: 'CC-2026-000001' },
        }))),
      },
      rawMaterialInventory: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(
          Object.entries(opts.onHand ?? {})
            .filter(([b]) => branchMatches(where.branchId, b))
            .map(([, quantity]) => ({ rawMaterialId: MILK.id, quantity })),
        )),
      },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]) },
      // Honours what the reports and the hold ask for: waiting or not, status, branch.
      orderItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(rows.filter((r) =>
          (where.usageOnReady === undefined || r.usageOnReady === where.usageOnReady)
          && (where.usagePostedAt !== null || r.usagePostedAt === null)
          && (where.order?.status?.in ?? [r.order.status]).includes(r.order.status)
          && branchMatches(where.order?.branchId, r.order.branchId),
        ))),
      },
      bomItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(
          [{ productId: LATTE, rawMaterialId: MILK.id, quantity: 200, rawMaterial: { name: MILK.name, unit: 'ml', costPrice: 0.1, lotsTracked: true } }]
            .filter((b) => (where.productId?.in ?? [b.productId]).includes(b.productId))
            .filter((b) => (where.rawMaterialId?.in ?? [b.rawMaterialId]).includes(b.rawMaterialId)),
        )),
      },
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new InventoryReportsService(prisma);
  }

  // ─────────────────────────────── variance ───────────────────────────────

  describe('variance', () => {
    const COUNTED = [{ countedQty: 10_000, postedAt: '2026-09-01T02:00:00Z' }];
    const variance = (svc: InventoryReportsService) => svc.variance(TENANT, BRANCH, '2026-09-01', '2026-09-30').then((r) => r[0]);

    it('takes what a ticket waiting at the branch holds off the actual figure', async () => {
      // Counted 10,000. 25 lattes made at the sale (5,000 off the books); 5 more
      // sold and waiting at the bar -- in expected use, still on the books.
      const milk = await variance(build({
        counts: COUNTED,
        lines: [{ id: 'made', qty: 25 }, { id: 'wait', qty: 5, waiting: true }],
        onHand: { [BRANCH]: 5_000 },
      }));
      expect(milk.expectedConsumption).toBe(6_000);
      expect(milk.expectedEndingQty).toBe(4_000);
      expect(milk.heldQty).toBe(1_000);
      expect(milk.actualEndingQty).toBe(4_000);   // 5,000 on the books less 1,000 held
      expect(milk.deltaQty).toBe(0);              // was +1,000: milk that "should have gone"
    });

    it('does not take off a ticket waiting at another branch, or on a voided order', async () => {
      const milk = await variance(build({
        counts: COUNTED,
        lines: [
          { id: 'made', qty: 30 },
          { id: 'elsewhere', qty: 5, waiting: true, branch: OTHER },
          { id: 'voided', qty: 5, waiting: true, status: 'VOIDED' },
        ],
        onHand: { [BRANCH]: 4_000, [OTHER]: 9_000 },
      }));
      expect(milk.heldQty).toBe(0);
      expect(milk.actualEndingQty).toBe(4_000);
      expect(milk.deltaQty).toBe(0);
    });

    it('reads the book figure when nothing is waiting', async () => {
      const milk = await variance(build({
        counts: COUNTED,
        lines: [{ id: 'made', qty: 30 }, { id: 'confirmed', qty: 2, confirmedAt: new Date('2026-09-04T02:10:00Z') }],
        onHand: { [BRANCH]: 3_600 },
      }));
      expect(milk.heldQty).toBe(0);
      expect(milk.actualEndingQty).toBe(3_600);
      expect(milk.expectedEndingQty).toBe(3_600);
      expect(milk.deltaQty).toBe(0);
    });

    it('does not show a shortage the ready tap would not make', async () => {
      // 300 on the books, 1,000 held: the tap floors the book at zero, so does this.
      const milk = await variance(build({
        lines: [{ id: 'wait', qty: 5, waiting: true }],
        onHand: { [BRANCH]: 300 },
      }));
      expect(milk.actualEndingQty).toBe(0);
    });
  });

  // ─────────────────────────────── depletion ───────────────────────────────

  describe('depletion forecast', () => {
    it('divides what is left once a ticket waiting at the branch has its milk', async () => {
      // 30 lattes in 30 days = 200 ml a day. 3,000 on the books, 1,000 of it held.
      const [milk] = await build({
        lines: [{ id: 'made', qty: 25 }, { id: 'wait', qty: 5, waiting: true }],
        onHand: { [BRANCH]: 3_000 },
      }).depletionForecast(TENANT, BRANCH);
      expect(milk.heldQty).toBe(1_000);
      expect(milk.currentStock).toBe(2_000);
      expect(milk.daysUntilStockout).toBe(10);
    });

    it('does not count a ticket waiting at another branch, or on a voided order', async () => {
      const [milk] = await build({
        lines: [
          { id: 'made', qty: 30 },
          { id: 'elsewhere', qty: 5, waiting: true, branch: OTHER },
          { id: 'voided', qty: 5, waiting: true, status: 'VOIDED' },
        ],
        onHand: { [BRANCH]: 3_000 },
      }).depletionForecast(TENANT, BRANCH);
      expect(milk.heldQty).toBe(0);
      expect(milk.currentStock).toBe(3_000);
      expect(milk.daysUntilStockout).toBe(15);
    });

    it('is unchanged when nothing is waiting', async () => {
      const [milk] = await build({ lines: [{ id: 'made', qty: 30 }], onHand: { [BRANCH]: 3_000 } })
        .depletionForecast(TENANT, BRANCH);
      expect(milk.currentStock).toBe(3_000);
      expect(milk.daysUntilStockout).toBe(15);
    });
  });

  // ──────────────────────────────── margin ────────────────────────────────

  describe('margin', () => {
    const margin = (svc: InventoryReportsService) => svc.margin(TENANT, '2026-09-01', '2026-09-30').then((r) => r[0]);

    it('leaves a waiting line out of cost and margin and says its cost is pending', async () => {
      const latte = await margin(build({
        lines: [
          { id: 'made', qty: 2, lineTotal: 300, costPrice: 40 },
          { id: 'wait', qty: 1, lineTotal: 150, costPrice: 40, waiting: true },   // 40 is only the till's guess
        ],
      }));
      expect(latte.qtySold).toBe(3);
      expect(latte.revenue).toBe(450);          // sold is sold
      expect(latte.cogs).toBe(80);              // booked cost only
      expect(latte.grossMargin).toBe(220);      // 300 costed revenue - 80
      expect(latte.marginPct).toBeCloseTo(73.33, 2);
      expect(latte.costPendingQty).toBe(1);
      expect(latte.costPendingRevenue).toBe(150);
    });

    it('has no margin to show while every line of a product is still waiting', async () => {
      const latte = await margin(build({ lines: [{ id: 'wait', qty: 2, waiting: true, costPrice: null }] }));
      expect(latte.cogs).toBe(0);
      expect(latte.grossMargin).toBe(0);
      expect(latte.marginPct).toBeNull();
      expect(latte.costPendingQty).toBe(2);
    });

    it('does not report a voided order\'s waiting line as pending', async () => {
      const rows = await build({
        lines: [{ id: 'made', qty: 2, lineTotal: 300 }, { id: 'voided', qty: 1, waiting: true, status: 'VOIDED' }],
      }).margin(TENANT, '2026-09-01', '2026-09-30');
      expect(rows[0].costPendingQty).toBe(0);
      expect(rows[0].revenue).toBe(300);
    });

    it('costs a line that waited once it is marked ready, as before', async () => {
      const latte = await margin(build({
        lines: [
          { id: 'made', qty: 2, lineTotal: 300, costPrice: 40 },
          { id: 'confirmed', qty: 1, lineTotal: 150, costPrice: 45, confirmedAt: new Date('2026-09-04T02:10:00Z') },
        ],
      }));
      expect(latte.cogs).toBe(125);
      expect(latte.grossMargin).toBe(325);
      expect(latte.marginPct).toBeCloseTo((325 / 450) * 100, 6);
      expect(latte.costPendingQty).toBe(0);
      expect(latte.costPendingRevenue).toBe(0);
    });
  });
});
