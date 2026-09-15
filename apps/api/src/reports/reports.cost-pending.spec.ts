import { ReportsService } from './reports.service';

/**
 * Cost pending: lines still waiting at a kitchen or bar screen.
 *
 * A recipe line that waits at a screen books its cost of goods when it is
 * marked ready, from the recipe and stock as they are then. The cost printed
 * on the line until that moment is only the till's guess. So the daily, range
 * and all-branch reports leave that guess out of cost and gross profit, and
 * say how many lines -- and how much of the revenue -- are still waiting for
 * their cost. Revenue itself does not move: the sale happened at the till.
 */
describe('Reports: cost pending for lines still waiting at a screen', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const OTHER  = 'b2';
  const DAY    = '2026-09-12';

  interface Line { qty?: number; lineTotal: number; cost?: number | null; waiting?: boolean; confirmedAt?: Date }

  const order = (o: { id: string; status?: string; branch?: string; lines: Line[] }) => {
    const total = o.lines.reduce((s, l) => s + l.lineTotal, 0);
    return {
      id: o.id,
      branchId: o.branch ?? BRANCH,
      status: o.status ?? 'COMPLETED',
      totalAmount: total,
      vatAmount: 0,
      paidAt: new Date(`${DAY}T10:00:00+08:00`),
      completedAt: new Date(`${DAY}T10:05:00+08:00`),
      createdAt: new Date(`${DAY}T10:00:00+08:00`),
      payments: [{ method: 'CASH', amount: total }],
      items: o.lines.map((l, n) => ({
        id: `${o.id}-${n}`, productId: `p${n}`, productName: 'Latte',
        quantity: l.qty ?? 1, lineTotal: l.lineTotal,
        costPrice: l.cost === undefined ? 40 : l.cost,
        refundedQty: 0,
        usageOnReady: l.waiting === true || l.confirmedAt != null,
        usagePostedAt: l.confirmedAt ?? null,
      })),
    };
  };

  function build(orders: any[]) {
    const prisma: any = {
      order: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(
          orders.filter((o) => (where.status?.in ?? [o.status]).includes(o.status) && (!where.branchId || where.branchId === o.branchId)),
        )),
      },
      orderItemRefund: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ businessType: 'FOOD_BEVERAGE' }) },
      branch: { findMany: jest.fn().mockResolvedValue([{ id: BRANCH, name: 'Main' }, { id: OTHER, name: 'Mall' }]) },
      aPBill: { findMany: jest.fn().mockResolvedValue([]) },
      aRInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new ReportsService(prisma);
  }

  const MADE    = { lineTotal: 150, cost: 40 };
  const WAITING = { lineTotal: 150, cost: 40, waiting: true };   // 40 is the till's guess

  // ───────────────────────────────── daily ─────────────────────────────────

  describe('daily report', () => {
    it('leaves a waiting line\'s cost out of COGS and gross profit, and reports it as pending', async () => {
      const day = await build([order({ id: 'a', lines: [MADE, WAITING] })]).getDaily(TENANT, BRANCH, DAY);
      expect(day.totalRevenue).toBe(300);                              // revenue does not move
      expect(day.totalCogs).toBe(40);
      expect(day.grossProfit).toBe(260);
      expect(day.costPending).toEqual({ lineCount: 1, revenue: 150 });
      expect(day.itemsMissingCost).toEqual({ lineCount: 0, revenueLeak: 0 });
    });

    it('calls a waiting line with no cost on it pending, not missing', async () => {
      const day = await build([order({ id: 'a', lines: [{ ...WAITING, cost: null }] })]).getDaily(TENANT, BRANCH, DAY);
      expect(day.costPending.lineCount).toBe(1);
      expect(day.itemsMissingCost.lineCount).toBe(0);
    });

    it('does not report a voided order\'s waiting line as pending', async () => {
      const day = await build([
        order({ id: 'a', lines: [MADE] }),
        order({ id: 'v', status: 'VOIDED', lines: [WAITING] }),
      ]).getDaily(TENANT, BRANCH, DAY);
      expect(day.costPending).toEqual({ lineCount: 0, revenue: 0 });
      expect(day.totalCogs).toBe(40);
    });

    it('costs a line that waited once it is marked ready', async () => {
      const day = await build([
        order({ id: 'a', lines: [MADE, { lineTotal: 150, cost: 45, confirmedAt: new Date(`${DAY}T10:04:00+08:00`) }] }),
      ]).getDaily(TENANT, BRANCH, DAY);
      expect(day.totalCogs).toBe(85);
      expect(day.grossProfit).toBe(215);
      expect(day.costPending).toEqual({ lineCount: 0, revenue: 0 });
    });

    it('is unchanged when nothing is waiting', async () => {
      const day = await build([order({ id: 'a', lines: [MADE, MADE] })]).getDaily(TENANT, BRANCH, DAY);
      expect(day.totalRevenue).toBe(300);
      expect(day.totalCogs).toBe(80);
      expect(day.grossProfit).toBe(220);
      expect(day.costPending).toEqual({ lineCount: 0, revenue: 0 });
    });
  });

  // ───────────────────────────────── range ─────────────────────────────────

  describe('sales over a date range', () => {
    it('leaves a waiting line out of cost and gross profit, in the totals and on its day', async () => {
      const out = await build([
        order({ id: 'a', lines: [MADE, WAITING] }),
        order({ id: 'v', status: 'VOIDED', lines: [WAITING] }),
      ]).getSalesRange(TENANT, BRANCH, DAY, DAY);

      expect(out.totals.totalRevenue).toBe(300);
      expect(out.totals.totalCogs).toBe(40);
      expect(out.totals.grossProfit).toBe(260);
      expect(out.totals.costPending).toEqual({ lineCount: 1, revenue: 150 });   // the voided one is not
      expect(out.byDay[0].totalCogs).toBe(40);
      expect(out.byDay[0].grossProfit).toBe(260);
      expect(out.byDay[0].costPending).toEqual({ lineCount: 1, revenue: 150 });
    });

    it('is unchanged when nothing is waiting', async () => {
      const out = await build([order({ id: 'a', lines: [MADE, MADE] })]).getSalesRange(TENANT, BRANCH, DAY, DAY);
      expect(out.totals.totalCogs).toBe(80);
      expect(out.totals.grossProfit).toBe(220);
      expect(out.totals.costPending).toEqual({ lineCount: 0, revenue: 0 });
    });
  });

  // ─────────────────────────────── all-branch ───────────────────────────────

  describe('all-branch report', () => {
    it('reports the waiting line against its own branch only', async () => {
      const out = await build([
        order({ id: 'a', branch: BRANCH, lines: [MADE, WAITING] }),
        order({ id: 'b', branch: OTHER,  lines: [MADE, MADE] }),
        order({ id: 'v', branch: OTHER,  status: 'VOIDED', lines: [WAITING] }),
      ]).getUnifiedReport(TENANT, DAY, DAY);

      const main = out.branches.find((b) => b.branchId === BRANCH)!;
      const mall = out.branches.find((b) => b.branchId === OTHER)!;
      expect(main.revenue).toBe(300);
      expect(main.cogs).toBe(40);
      expect(main.grossProfit).toBe(260);
      expect(main.costPending).toEqual({ lineCount: 1, revenue: 150 });
      expect(mall.cogs).toBe(80);                                           // unchanged: nothing waiting there
      expect(mall.costPending).toEqual({ lineCount: 0, revenue: 0 });        // nor from its voided order
      expect(out.totals.cogs).toBe(120);
      expect(out.totals.costPending).toEqual({ lineCount: 1, revenue: 150 });
    });
  });
});
