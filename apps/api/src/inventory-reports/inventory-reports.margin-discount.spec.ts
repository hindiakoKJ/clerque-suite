import { InventoryReportsService } from './inventory-reports.service';

/**
 * The per-product margin report and the Senior/PWD 20%.
 *
 * The till sends each line's lineTotal before an order discount; the senior's
 * 20% (or a cashier's discount) is only in the order's totalAmount. Reading
 * lineTotal as revenue counted every senior's discount as margin. Each line
 * now counts its share of what the order kept, net of VAT.
 */
describe('Margin report: order discounts and VAT', () => {
  const TENANT = 't1';

  interface Line { product: string; qty: number; lineTotal: number; cost: number; refunded?: number }
  interface Order { id: string; totalAmount: number; vatAmount?: number; lines: Line[] }

  function build(orders: Order[]) {
    const rows = orders.flatMap((o) => o.lines.map((l, n) => ({
      id: `${o.id}-${n}`,
      orderId: o.id,
      productId: l.product, productName: l.product,
      quantity: l.qty, refundedQty: l.refunded ?? 0,
      lineTotal: l.lineTotal, costPrice: l.cost,
      usageOnReady: false, usagePostedAt: null,
      order: { totalAmount: o.totalAmount, vatAmount: o.vatAmount ?? 0 },
    })));
    const prisma: any = { orderItem: { findMany: jest.fn().mockResolvedValue(rows) } };
    return { svc: new InventoryReportsService(prisma), prisma };
  }
  const byProduct = async (orders: Order[]) => {
    const out = await build(orders).svc.margin(TENANT, '2026-09-01', '2026-09-30');
    return Object.fromEntries(out.map((r) => [r.productId, r]));
  };

  it("takes a senior's 20% off the revenue and the margin of the items it was given on", async () => {
    // Latte 150 + Cookie 100, one each, senior 20% on both: the customer paid 200.
    const rows = await byProduct([{
      id: 'o1', totalAmount: 200,
      lines: [
        { product: 'Latte',  qty: 1, lineTotal: 150, cost: 40 },
        { product: 'Cookie', qty: 1, lineTotal: 100, cost: 30 },
      ],
    }]);
    expect(rows.Latte.revenue).toBe(120);
    expect(rows.Latte.grossMargin).toBe(80);          // was 110 with the 20% counted as profit
    expect(rows.Cookie.revenue).toBe(80);
    expect(rows.Cookie.grossMargin).toBe(50);
    expect(rows.Latte.revenue + rows.Cookie.revenue).toBe(200);   // what was paid
  });

  it('is unchanged for an order with no discount', async () => {
    const rows = await byProduct([{ id: 'o1', totalAmount: 300, lines: [{ product: 'Latte', qty: 2, lineTotal: 300, cost: 40 }] }]);
    expect(rows.Latte.revenue).toBe(300);
    expect(rows.Latte.grossMargin).toBe(220);
  });

  it('reads the right order for each line when two orders are in the window', async () => {
    const rows = await byProduct([
      { id: 'full',   totalAmount: 150, lines: [{ product: 'Latte', qty: 1, lineTotal: 150, cost: 40 }] },
      { id: 'senior', totalAmount: 120, lines: [{ product: 'Latte', qty: 1, lineTotal: 150, cost: 40 }] },
    ]);
    expect(rows.Latte.revenue).toBe(270);
    expect(rows.Latte.grossMargin).toBe(190);
  });

  it('leaves VAT out of revenue for a VAT-registered shop', async () => {
    const rows = await byProduct([{ id: 'o1', totalAmount: 112, vatAmount: 12, lines: [{ product: 'Latte', qty: 1, lineTotal: 112, cost: 40 }] }]);
    expect(rows.Latte.revenue).toBeCloseTo(100, 6);
  });

  it('still counts only the units not refunded', async () => {
    // 2 × 150 with a ₱60 discount on the order; one of the two refunded.
    const rows = await byProduct([{ id: 'o1', totalAmount: 240, lines: [{ product: 'Latte', qty: 2, lineTotal: 300, cost: 40, refunded: 1 }] }]);
    expect(rows.Latte.qtySold).toBe(1);
    expect(rows.Latte.revenue).toBe(120);
    expect(rows.Latte.cogs).toBe(40);
  });

  it("asks for each line's order totals", async () => {
    const { svc, prisma } = build([]);
    await svc.margin(TENANT, '2026-09-01', '2026-09-30');
    const { select } = prisma.orderItem.findMany.mock.calls[0][0];
    expect(select.orderId).toBe(true);
    expect(select.order).toEqual({ select: { totalAmount: true, vatAmount: true } });
  });
});
