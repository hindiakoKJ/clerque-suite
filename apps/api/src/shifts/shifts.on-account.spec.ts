import { ShiftsService, cashKeptBy } from './shifts.service';

/**
 * A sale on account (utang) puts nothing in the drawer.
 *
 * Expected cash read every sale's total less its GCash/Maya/QR payments as
 * cash. A CHARGE sale has no payment at all, so its whole total counted as
 * cash: a ₱300 utang made the drawer expect ₱300 that was never handed over,
 * the cashier came up "short" at closing, and the count booked a made-up
 * shortage as an expense.
 */
describe('ShiftsService — sales on account and the drawer', () => {
  const OPENED = new Date('2026-10-13T00:00:00Z');

  function build(orders: any[]) {
    const prisma: any = {
      order: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(where?.shiftId === null ? [] : orders)),
      },
      shiftCashOut: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
      orderItemRefund: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new ShiftsService(prisma, { log: jest.fn() } as any, { generateZRead: jest.fn() } as any) as any;
    const shift = {
      id: 's1', tenantId: 't1', branchId: 'b1', cashierId: 'u1', openingCash: 1000, openedAt: OPENED, closedAt: null,
      closingCashDeclared: null, closingCashExpected: null, variance: null, notes: null,
    };
    return { svc, shift };
  }

  it('a ₱300 sale on account adds nothing to expected cash', async () => {
    const { svc, shift } = build([
      { id: 'o1', status: 'COMPLETED', invoiceType: 'CASH_SALE', totalAmount: 500, payments: [{ method: 'CASH', amount: 500 }] },
      { id: 'o2', status: 'COMPLETED', invoiceType: 'CHARGE', totalAmount: 300, payments: [] },
    ]);
    const s = await svc.buildSummary(shift);
    expect(s.cashSales).toBe(500);
    expect(s.expectedCash).toBe(1500);
  });

  it('cash kept: a paid sale is its total less non-cash; on account, only the cash actually taken', () => {
    expect(cashKeptBy({ invoiceType: 'CASH_SALE', totalAmount: 368, payments: [{ method: 'CASH', amount: 500 }] })).toBe(368);
    expect(cashKeptBy({ invoiceType: 'CASH_SALE', totalAmount: 500, payments: [{ method: 'GCASH_BUSINESS', amount: 200 }, { method: 'CASH', amount: 300 }] })).toBe(300);
    expect(cashKeptBy({ invoiceType: null, totalAmount: 180, payments: [{ method: 'CASH', amount: 180 }] })).toBe(180);
    expect(cashKeptBy({ invoiceType: 'CHARGE', totalAmount: 300, payments: [] })).toBe(0);
    expect(cashKeptBy({ invoiceType: 'CHARGE', totalAmount: 300, payments: [{ method: 'CASH', amount: 100 }] })).toBe(100);
  });
});
