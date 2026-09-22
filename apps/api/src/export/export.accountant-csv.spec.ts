/**
 * Accountant Export CSV — the file used to work out percentage tax.
 *
 * Before: a COMPLETED order whose only item was fully refunded was listed at
 * full value with no refund column, so the file's total sat above the POS
 * revenue in the books (₱1,456 in the file, ₱1,296 in the ledger).
 */
import { ExportService } from './export.service';

type Order = ReturnType<typeof order>;

function order(orderNumber: string, total: number, refunds: number[] = [], method = 'CASH') {
  const at = new Date('2026-09-05T02:00:00Z');
  return {
    orderNumber, paidAt: at, completedAt: at, createdAt: at,
    subtotal: total, discountAmount: 0, vatAmount: 0, totalAmount: total,
    payments: [{ method, amount: total }],
    items: [{ refunds: refunds.map((refundAmount) => ({ refundAmount })) }],
  };
}

function build(orders: Order[]) {
  const prisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Cafe Carolina', taxStatus: 'NON_VAT' }) },
    order:  { findMany: jest.fn().mockResolvedValue(orders) },
  };
  const none = {} as never;
  const svc = new ExportService(
    prisma as never, none, none, none, none, none, none, none, none, none, none, none, none, none,
  );
  return { svc, prisma };
}

/** Split a csvCell-quoted line into its cells. */
const cells = (line: string) => line.slice(1, -1).split('","');

async function run(orders: Order[], from?: string, to?: string) {
  const { svc, prisma } = build(orders);
  const csv = await svc.exportAccountantCsv('t1', from, to);
  const lines = csv.split('\n');
  const headerLine = lines.find((l) => l.includes('"Total Amount"'))!;
  const header = cells(headerLine);
  const col = (name: string) => header.indexOf(name);
  const rowOf = (orderNumber: string) => cells(lines.find((l) => l.startsWith(`"${orderNumber}"`))!);
  const totals = cells(lines.find((l) => l.startsWith('"TOTALS ('))!);
  return { csv, header, col, rowOf, totals, prisma };
}

describe('ExportService.exportAccountantCsv — refunds', () => {
  it('shows what was refunded and nets it out, per order and in the total', async () => {
    const { header, col, rowOf, totals } = await run([
      order('ORD-2026-000003', 80, [80]),      // fully refunded
      order('ORD-2026-000004', 100),           // untouched
      order('ORD-2026-000005', 120, [40], 'GCASH_PERSONAL'), // one item refunded
    ]);

    expect(header).toEqual(expect.arrayContaining(['Total Amount', 'Refunded', 'Net Sales']));

    const refunded = rowOf('ORD-2026-000003');
    expect(refunded[col('Total Amount')]).toBe('80.00');
    expect(refunded[col('Refunded')]).toBe('80.00');
    expect(refunded[col('Net Sales')]).toBe('0.00');

    const partial = rowOf('ORD-2026-000005');
    expect(partial[col('Refunded')]).toBe('40.00');
    expect(partial[col('Net Sales')]).toBe('80.00');

    expect(rowOf('ORD-2026-000004')[col('Net Sales')]).toBe('100.00');

    // 80 + 100 + 120 gross, 120 refunded, 180 net — the figure that agrees with 4010.
    expect(totals[col('Total Amount')]).toBe('300.00');
    expect(totals[col('Refunded')]).toBe('120.00');
    expect(totals[col('Net Sales')]).toBe('180.00');
  });

  it('asks the database for the refunds and for PAID as well as COMPLETED orders in the paid-at range', async () => {
    const { prisma } = await run([], '2026-09-01', '2026-09-21');
    const arg = prisma.order.findMany.mock.calls[0][0];
    expect(arg.include.items).toBeDefined();
    expect(arg.where.status).toEqual({ in: ['PAID', 'COMPLETED'] });
    expect(arg.where.paidAt.gte).toEqual(new Date('2026-09-01T00:00:00+08:00'));
    expect(arg.where.paidAt.lte).toEqual(new Date('2026-09-21T23:59:59.999+08:00'));
  });

  it('explains the two new columns in plain words at the top of the file', async () => {
    const { csv } = await run([]);
    expect(csv).toContain('Refunded = money given back on that sale. Net Sales = Total Amount less Refunded.');
  });
});
