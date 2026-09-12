import { ReportsService } from './reports.service';

/**
 * Three receipts, one sale.
 *
 * A cashier rings a drink, prints it, notices the wrong size, voids it, and
 * rings it again. Three pieces of paper crossed the counter. One drink was
 * sold. A day's figures that count the paper report twice the transactions
 * and half the average sale, and the owner plans staffing and prices off both.
 *
 * The second half of the same problem is money handed back. A refund in this
 * system writes a refund row and leaves the order's total alone -- correct for
 * the receipt, which really did ring up that much, and a trap for any report
 * that reads the total and stops there. A sale refunded in full still read as
 * a full sale all day.
 */
describe('A day of sales, counted honestly', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const DAY    = '2026-09-12';

  const order = (o: {
    id: string; status: string; total: number; paidAt?: string;
    items?: Array<{ qty: number; lineTotal: number; cost?: number; refundedQty?: number }>;
    payments?: Array<{ method: string; amount: number }>;
  }) => ({
    id: o.id,
    status: o.status,
    totalAmount: o.total,
    paidAt: new Date(o.paidAt ?? `${DAY}T10:00:00+08:00`),
    completedAt: new Date(o.paidAt ?? `${DAY}T10:00:00+08:00`),
    payments: (o.payments ?? [{ method: 'CASH', amount: o.total }]).map((p) => ({ ...p })),
    items: (o.items ?? [{ qty: 1, lineTotal: o.total }]).map((i, n) => ({
      id: `${o.id}-${n}`, productId: `p${n}`, productName: 'Latte',
      quantity: i.qty, lineTotal: i.lineTotal,
      costPrice: i.cost ?? 0, refundedQty: i.refundedQty ?? 0,
    })),
  });

  function build(opts: { orders: any[]; refunds?: number[] } = { orders: [] }) {
    const queries: any[] = [];
    const prisma: any = {
      order: {
        findMany: jest.fn(({ where }: any) => {
          queries.push(where);
          const allowed: string[] = where.status?.in ?? [];
          return Promise.resolve(opts.orders.filter((o) => allowed.length === 0 || allowed.includes(o.status)));
        }),
      },
      orderItemRefund: {
        findMany: jest.fn(() => Promise.resolve((opts.refunds ?? []).map((amount) => ({ refundAmount: amount, createdAt: new Date(`${DAY}T11:00:00+08:00`) })))),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ businessType: 'FOOD_BEVERAGE' }) },
    };
    const svc = new ReportsService(prisma) as any;
    return { svc, prisma, queries };
  }

  it('counts the sale once and the void not at all', async () => {
    const { svc } = build({
      orders: [
        order({ id: 'wrong',     status: 'VOIDED',    total: 150 }),
        order({ id: 'corrected', status: 'COMPLETED', total: 180 }),
      ],
    });
    const day = await svc.getDaily(TENANT, BRANCH, DAY);
    expect(day.totalOrders).toBe(1);
    expect(day.totalRevenue).toBe(180);
    expect(day.avgOrderValue).toBe(180);
  });

  it('still says how many were voided, instead of always saying none', async () => {
    // The tile read zero whatever happened at the till: the query asked only
    // for paid orders, and the count was taken from what came back.
    const { svc } = build({
      orders: [
        order({ id: 'v1', status: 'VOIDED',    total: 150 }),
        order({ id: 'v2', status: 'VOIDED',    total: 90 }),
        order({ id: 'ok', status: 'COMPLETED', total: 180 }),
      ],
    });
    const day = await svc.getDaily(TENANT, BRANCH, DAY);
    expect(day.voidCount).toBe(2);
    expect(day.totalRevenue).toBe(180);
  });

  it('takes money handed back out of the day, and out of the average', async () => {
    const { svc } = build({
      orders: [
        order({ id: 'a', status: 'COMPLETED', total: 200 }),
        order({ id: 'b', status: 'COMPLETED', total: 200 }),
      ],
      refunds: [200],
    });
    const day = await svc.getDaily(TENANT, BRANCH, DAY);
    expect(day.totalRevenue).toBe(400);    // what the receipts rang up
    expect(day.refundTotal).toBe(200);     // what went back
    expect(day.netSales).toBe(200);        // what the shop kept
    expect(day.totalOrders).toBe(2);
    expect(day.avgOrderValue).toBe(100);   // 200 kept over 2 sales
  });

  it('asks the database for the voids as well as the sales', async () => {
    const { svc, queries } = build({ orders: [] });
    await svc.getDaily(TENANT, BRANCH, DAY);
    expect(queries[0].status.in).toEqual(expect.arrayContaining(['PAID', 'COMPLETED', 'VOIDED']));
  });

  it('keeps a drink still being made in its own hour', async () => {
    // Keyed on completedAt alone, every paid-but-unfinished order fell out of
    // the hourly chart, so the busiest hour of a rush was missing from it.
    const { svc } = build({ orders: [order({ id: 'a', status: 'PAID', total: 120 })] });
    const day = await svc.getDaily(TENANT, BRANCH, DAY);
    const day2 = await svc.getDaily(TENANT, BRANCH, DAY);
    expect(day.byHour.reduce((s: number, h: any) => s + h.revenue, 0)).toBe(day.totalRevenue);
    expect(day2.byHour).toHaveLength(1);
  });
});
