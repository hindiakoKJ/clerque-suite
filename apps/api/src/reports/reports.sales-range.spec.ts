import { ReportsService, UNPOSTED_BILL_STATUSES, UNPOSTED_INVOICE_STATUSES } from './reports.service';

/**
 * The Sales Report's tiles and the rows under them are one sum.
 *
 * On a month with a few refund-then-void corrections the tiles read negative
 * gross profit and a negative average sale while every row underneath was
 * positive: the refunds of voided orders were taken off sales those orders
 * were never part of, and the rows ignored refunds altogether.
 */
describe('Sales report over a range', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';

  const order = (o: { id: string; status: string; total: number; day: string; cost?: number }) => ({
    id: o.id,
    status: o.status,
    totalAmount: o.total,
    vatAmount: 0,
    paidAt: new Date(`${o.day}T10:00:00+08:00`),
    createdAt: new Date(`${o.day}T10:00:00+08:00`),
    payments: [{ method: 'CASH', amount: o.total }],
    items: [{
      id: `${o.id}-0`, productId: 'p0', productName: 'Latte',
      quantity: 1, lineTotal: o.total, costPrice: o.cost ?? 0,
    }],
  });

  function build(opts: { orders: any[]; refunds?: Array<{ amount: number; day: string; orderStatus: string }> }) {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue(opts.orders) },
      orderItemRefund: {
        // Honours the status filter the way the database would, so the test
        // fails if the service stops asking for it.
        findMany: jest.fn(({ where }: any) => {
          const notStatus = where.orderItem?.order?.status?.not;
          return Promise.resolve(
            (opts.refunds ?? [])
              .filter((r) => !notStatus || r.orderStatus !== notStatus)
              .map((r) => ({ refundAmount: r.amount, createdAt: new Date(`${r.day}T11:00:00+08:00`) })),
          );
        }),
      },
    };
    return { svc: new ReportsService(prisma), prisma };
  }

  it('does not take a voided order\'s refunds off sales it was never part of', async () => {
    const { svc, prisma } = build({
      orders: [
        order({ id: 'ok',    status: 'COMPLETED', total: 300, day: '2026-09-10', cost: 100 }),
        order({ id: 'wrong', status: 'VOIDED',    total: 500, day: '2026-09-10' }),
      ],
      // The wrong order was refunded line by line, then voided.
      refunds: [{ amount: 500, day: '2026-09-10', orderStatus: 'VOIDED' }],
    });
    const r = await svc.getSalesRange(TENANT, BRANCH, '2026-09-01', '2026-09-30');

    expect(prisma.orderItemRefund.findMany.mock.calls[0][0].where.orderItem.order.status).toEqual({ not: 'VOIDED' });
    expect(r.totals.totalRevenue).toBe(300);
    expect(r.totals.refundTotal).toBe(0);
    expect(r.totals.netSales).toBe(300);
    expect(r.totals.grossProfit).toBe(200);
    expect(r.totals.avgOrderValue).toBe(300);
    expect(r.totals.voidCount).toBe(1);
  });

  it('makes the rows add up to the tiles, refunds included', async () => {
    const { svc } = build({
      orders: [
        order({ id: 'a', status: 'COMPLETED', total: 200, day: '2026-09-10', cost: 60 }),
        order({ id: 'b', status: 'PAID',      total: 200, day: '2026-09-11', cost: 60 }),
      ],
      refunds: [
        { amount: 50, day: '2026-09-11', orderStatus: 'COMPLETED' },
        // Handed back on a day with no sale of its own: still gets a row.
        { amount: 30, day: '2026-09-12', orderStatus: 'COMPLETED' },
      ],
    });
    const r = await svc.getSalesRange(TENANT, BRANCH, '2026-09-01', '2026-09-30');

    expect(r.totals.refundTotal).toBe(80);
    expect(r.totals.netSales).toBe(320);
    expect(r.totals.grossProfit).toBe(200);           // 320 kept less 120 cost
    expect(r.totals.avgOrderValue).toBe(160);

    expect(r.byDay.map((d: any) => d.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    expect(r.byDay.map((d: any) => d.grossProfit)).toEqual([140, 90, -30]);
    const sum = (k: string) => r.byDay.reduce((s: number, d: any) => s + d[k], 0);
    expect(sum('grossProfit')).toBe(r.totals.grossProfit);
    expect(sum('refundTotal')).toBe(r.totals.refundTotal);
    expect(sum('totalRevenue')).toBe(r.totals.totalRevenue);
  });
});

/**
 * The Unified Report answered 400 for every range: it filtered bills and
 * invoices on status 'VOID', which neither enum has (it is VOIDED), and the
 * `as any` beside it kept the compiler from saying so.
 */
describe('Unified report', () => {
  function build(opts: { bills?: any[]; invoices?: any[]; orders?: any[]; refunds?: any[]; ingredients?: any[]; products?: any[] } = {}) {
    const prisma: any = {
      branch:        { findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Annex' }]) },
      order:         { findMany: jest.fn().mockResolvedValue(opts.orders ?? []) },
      aPBill:        { findMany: jest.fn().mockResolvedValue(opts.bills ?? []) },
      aRInvoice:     { findMany: jest.fn().mockResolvedValue(opts.invoices ?? []) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue(opts.products ?? []) },
      rawMaterialInventory: { findMany: jest.fn().mockResolvedValue(opts.ingredients ?? []) },
      orderItemRefund: { findMany: jest.fn().mockResolvedValue(opts.refunds ?? []) },
    };
    return { svc: new ReportsService(prisma), prisma };
  }

  const sale = (id: string, branchId: string, total: number, cost: number, status = 'COMPLETED') => ({
    id, branchId, status, totalAmount: total, paidAt: new Date('2026-09-10T10:00:00+08:00'),
    items: [{ quantity: 1, costPrice: cost, lineTotal: total, usageOnReady: false, usagePostedAt: null }],
  });

  it('gives the same gross profit as the Sales Report: refunds come off, a voided order\'s do not', async () => {
    const { svc, prisma } = build({
      orders: [sale('a', 'b1', 300, 100), sale('b', 'b1', 200, 50), sale('v', 'b1', 500, 0, 'VOIDED')],
      refunds: [{ refundAmount: 80, orderItem: { order: { branchId: 'b1' } } }],
    });
    const r = await svc.getUnifiedReport('t1', '2026-09-01', '2026-09-30');

    expect(prisma.orderItemRefund.findMany.mock.calls[0][0].where.orderItem.order.status).toEqual({ not: 'VOIDED' });
    const main = r.branches.find((b: any) => b.branchId === 'b1')!;
    expect(main.revenue).toBe(500);            // what was rung up; refunds shown beside it
    expect(main.refundTotal).toBe(80);
    expect(main.grossProfit).toBe(270);        // 500 - 80 handed back - 150 cost
    expect(main.avgOrderValue).toBe(210);      // 420 kept over 2 sales
    expect(r.totals.refundTotal).toBe(80);
    expect(r.totals.grossProfit).toBe(270);
    expect(r.totals.grossMargin).toBeCloseTo(270 / 420, 4);
  });

  it('counts ingredients and preps on the shelf in the stock value, not only boxed products', async () => {
    const { svc } = build({
      products:    [{ branchId: 'b1', quantity: 10, avgCost: 20, product: { costPrice: 25 } }],
      ingredients: [
        { branchId: 'b1', quantity: 2000, rawMaterial: { costPrice: 0.098 } },   // fresh milk, ml
        { branchId: 'b2', quantity: 1000, rawMaterial: { costPrice: 1.5 } },     // syrup, ml
        { branchId: 'b2', quantity: 50,   rawMaterial: { costPrice: null } },    // never priced: counts as 0
      ],
    });
    const r = await svc.getUnifiedReport('t1', '2026-09-01', '2026-09-30');
    expect(r.branches.find((b: any) => b.branchId === 'b1')!.inventoryValue).toBe(396);   // 200 + 196
    expect(r.branches.find((b: any) => b.branchId === 'b2')!.inventoryValue).toBe(1500);
    expect(r.totals.inventoryValue).toBe(1896);
  });

  it('filters bills and invoices on statuses the database really has', async () => {
    const { svc, prisma } = build();
    await svc.getUnifiedReport('t1', '2026-09-01', '2026-09-30');

    const billStatus    = prisma.aPBill.findMany.mock.calls[0][0].where.status;
    const invoiceStatus = prisma.aRInvoice.findMany.mock.calls[0][0].where.status;
    expect(billStatus).toEqual({ notIn: UNPOSTED_BILL_STATUSES });
    expect(invoiceStatus).toEqual({ notIn: UNPOSTED_INVOICE_STATUSES });
    // The word that broke it. Typed arrays now make this a compile error too.
    expect(UNPOSTED_BILL_STATUSES).toContain('VOIDED');
    expect(UNPOSTED_BILL_STATUSES).not.toContain('VOID');
    expect(UNPOSTED_INVOICE_STATUSES).toContain('VOIDED');
    expect(UNPOSTED_INVOICE_STATUSES).not.toContain('VOID');
  });

  it('lets a broken invoice query fail loudly instead of reading as no invoices', async () => {
    const { svc, prisma } = build();
    prisma.aRInvoice.findMany.mockRejectedValue(new Error('bad filter'));
    await expect(svc.getUnifiedReport('t1', '2026-09-01', '2026-09-30')).rejects.toThrow('bad filter');
  });

  it('counts a bill with no branch once in the totals, billed and unpaid alike', async () => {
    const { svc } = build({
      bills: [
        { branchId: 'b1', totalAmount: 1000, balanceAmount: 400 },
        { branchId: null, totalAmount: 500,  balanceAmount: 500 },
      ],
    });
    const r = await svc.getUnifiedReport('t1', '2026-09-01', '2026-09-30');
    // Two branches: the no-branch row used to be added once per branch to
    // "unpaid" (1,400) and never to "billed" (1,000).
    expect(r.totals.apBilled).toBe(1500);
    expect(r.totals.apOutstanding).toBe(900);
    expect(r.shared).toHaveLength(1);
  });
});
