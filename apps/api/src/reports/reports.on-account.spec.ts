import { ReportsService } from './reports.service';

/**
 * A sale on account (CHARGE) carries no payment at the till. The day's ways
 * of paying must still add up to the day's sales, so what is still to collect
 * shows as "CHARGE" -- and it is not money received, so it is neither cash nor
 * non-cash revenue.
 */
describe('A day with sales on account', () => {
  const DAY = '2026-10-13';
  const order = (id: string, total: number, invoiceType: string, payments: Array<{ method: string; amount: number }>) => ({
    id, status: 'COMPLETED', invoiceType, totalAmount: total,
    paidAt: new Date(`${DAY}T10:00:00+08:00`), completedAt: new Date(`${DAY}T10:00:00+08:00`),
    payments,
    items: [{ id: `${id}-0`, productId: 'p0', productName: 'Spark plug', quantity: 1, lineTotal: total, costPrice: 0, refundedQty: 0 }],
  });

  function build(orders: any[]) {
    const prisma: any = {
      order: { findMany: jest.fn(({ where }: any) => Promise.resolve(orders.filter((o) => (where.status?.in ?? [o.status]).includes(o.status)))) },
      orderItemRefund: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ businessType: 'RETAIL' }) },
    };
    return new ReportsService(prisma) as any;
  }

  it('shows what is still to collect as CHARGE, and the methods add up to the sales', async () => {
    const svc = build([
      order('cash', 1000, 'CASH_SALE', [{ method: 'CASH', amount: 1000 }]),
      order('gcash', 3500, 'CASH_SALE', [{ method: 'GCASH_BUSINESS', amount: 3500 }]),
      order('utang', 3000, 'CHARGE', []),
      order('half-paid', 2000, 'CHARGE', [{ method: 'CASH', amount: 500 }]),
    ]);
    const day = await svc.getDaily('t1', 'b1', DAY);
    const charge = day.byPaymentMethod.find((p: any) => p.method === 'CHARGE');
    expect(charge).toEqual({ method: 'CHARGE', totalAmount: 4500, orderCount: 2 });
    const sum = day.byPaymentMethod.reduce((s: number, p: any) => s + p.totalAmount, 0);
    expect(sum).toBe(day.totalRevenue);
    expect(day.cashRevenue).toBe(1500);
    expect(day.nonCashRevenue).toBe(3500);
  });

  it('a shop with no sales on account shows no CHARGE line', async () => {
    const svc = build([order('cash', 1000, 'CASH_SALE', [{ method: 'CASH', amount: 1000 }])]);
    const day = await svc.getDaily('t1', 'b1', DAY);
    expect(day.byPaymentMethod.map((p: any) => p.method)).toEqual(['CASH']);
  });
});
