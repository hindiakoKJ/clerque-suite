import { ReportsService, netShareOfLines } from './reports.service';

/**
 * Shift and day gross profit, and the Senior/PWD 20%.
 *
 * The till sends each line's lineTotal before an order discount; the senior's
 * 20% (or a cashier's discount) is only in the order's totalAmount. The day and
 * shift reports showed the discounted revenue next to a gross profit worked out
 * from the undiscounted lines, so every senior's 20% read as profit. The books
 * were right (the journal credits total less VAT); the screens were not.
 */
describe('Reports: gross profit after an order discount', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const DAY    = '2026-09-12';

  const order = (o: { id: string; total: number; vat?: number; lines: Array<{ qty: number; lineTotal: number; cost: number }> }) => ({
    id: o.id,
    branchId: BRANCH,
    status: 'COMPLETED',
    totalAmount: o.total,
    vatAmount: o.vat ?? 0,
    paidAt: new Date(`${DAY}T10:00:00+08:00`),
    completedAt: new Date(`${DAY}T10:05:00+08:00`),
    createdAt: new Date(`${DAY}T10:00:00+08:00`),
    payments: [{ method: 'CASH', amount: o.total }],
    items: o.lines.map((l, n) => ({
      id: `${o.id}-${n}`, productId: `p${n}`, productName: 'Latte',
      quantity: l.qty, lineTotal: l.lineTotal, costPrice: l.cost, refundedQty: 0,
      usageOnReady: false, usagePostedAt: null,
    })),
  });

  function build(orders: any[]) {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue(orders) },
      orderItemRefund: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ businessType: 'FOOD_BEVERAGE' }) },
    };
    return new ReportsService(prisma);
  }

  // Two lattes at 150 (cost 40 each). A senior gets 20% on one: 30 off, paid 270.
  const SENIOR = order({ id: 'sc', total: 270, lines: [{ qty: 2, lineTotal: 300, cost: 40 }] });

  it("the day's gross profit is what was paid less cost, not the price before the senior's 20%", async () => {
    const day = await build([SENIOR]).getDaily(TENANT, BRANCH, DAY);
    expect(day.totalRevenue).toBe(270);
    expect(day.totalCogs).toBe(80);
    expect(day.grossProfit).toBeCloseTo(190, 6);            // was 220
    expect(day.grossMargin).toBeCloseTo(190 / 270, 6);
  });

  it("a cashier's discount comes off gross profit the same way", async () => {
    const day = await build([
      order({ id: 'm', total: 225, lines: [{ qty: 1, lineTotal: 150, cost: 40 }, { qty: 1, lineTotal: 100, cost: 30 }] }),
    ]).getDaily(TENANT, BRANCH, DAY);
    expect(day.grossProfit).toBeCloseTo(225 - 70, 6);
  });

  it('is unchanged for orders with no order discount', async () => {
    const day = await build([order({ id: 'a', total: 300, lines: [{ qty: 2, lineTotal: 300, cost: 40 }] })]).getDaily(TENANT, BRANCH, DAY);
    expect(day.grossProfit).toBe(220);
  });

  it('still takes VAT out for a VAT-registered shop', async () => {
    const day = await build([order({ id: 'v', total: 112, vat: 12, lines: [{ qty: 1, lineTotal: 112, cost: 40 }] })]).getDaily(TENANT, BRANCH, DAY);
    expect(day.grossProfit).toBeCloseTo(60, 6);
  });

  it('a senior discount and VAT together: net is what was paid less VAT', async () => {
    const day = await build([order({ id: 'sv', total: 100, vat: 5, lines: [{ qty: 1, lineTotal: 112, cost: 40 }] })]).getDaily(TENANT, BRANCH, DAY);
    expect(day.grossProfit).toBeCloseTo(95 - 40, 6);
  });

  it('the sales range report agrees with the day report', async () => {
    const out = await build([SENIOR]).getSalesRange(TENANT, BRANCH, DAY, DAY);
    expect(out.totals.grossProfit).toBe(190);
  });

  describe('netShareOfLines', () => {
    it('is what each peso of the lines kept', () => {
      expect(netShareOfLines(270, 0, 300)).toBeCloseTo(0.9, 10);
      expect(netShareOfLines(112, 12, 112)).toBeCloseTo(100 / 112, 10);
    });
    it('is 0 for an order whose lines add up to nothing, never a division by zero', () => {
      expect(netShareOfLines(0, 0, 0)).toBe(0);
      expect(netShareOfLines(50, 0, 0)).toBe(0);
    });
    it('reads Prisma decimals and a missing VAT', () => {
      expect(netShareOfLines({ valueOf: () => 90 }, undefined, 100)).toBeCloseTo(0.9, 10);
    });
  });
});
