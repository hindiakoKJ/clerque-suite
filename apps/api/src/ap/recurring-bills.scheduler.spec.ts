/**
 * Sprint 22 — Scheduler spec for the recurring-AP materializer. Mirror of
 * the AR scheduler spec.
 */
import { RecurringBillsScheduler } from './recurring-bills.scheduler';

function makePrisma() {
  return {
    recurringBillTemplate: { findMany: jest.fn(), update: jest.fn() },
    aPBill:                { create: jest.fn() },
    $transaction:          jest.fn(),
  } as const;
}

describe('RecurringBillsScheduler.materializeDue', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let numbering: { next: jest.Mock };
  let scheduler: RecurringBillsScheduler;

  beforeEach(() => {
    prisma    = makePrisma();
    numbering = { next: jest.fn().mockResolvedValue('BILL-2026-0001') };
    (prisma as any).$transaction = jest.fn(async (cb: any) => cb(prisma));
    scheduler = new RecurringBillsScheduler(prisma as any, numbering as any);
  });

  it('creates one DRAFT child bill, copies WHT fields, advances nextRunAt', async () => {
    const dueDate = new Date('2026-05-15T00:00:00.000Z');
    prisma.recurringBillTemplate.findMany.mockResolvedValue([{
      id: 'tpl-1', tenantId: 'tenant-1', branchId: null,
      templateNumber: 'RB-2026-0001', name: 'Office rent',
      vendorId: 'vendor-1', frequency: 'MONTHLY', dayOfPeriod: 15,
      startDate: dueDate, endDate: null,
      termsDays: 30, nextRunAt: dueDate,
      subtotal: 10000, vatAmount: 1200, whtAmount: 500, whtAtcCode: 'WI160',
      totalAmount: 11200,
      description: null, notes: null, createdById: 'user-1',
      lines: [{ accountId: 'acc-rent', description: 'Rent', quantity: 1, unitPrice: 10000, taxAmount: 1200, lineTotal: 11200 }],
    }]);

    const result = await scheduler.materializeDue(new Date('2026-05-15T01:05:00.000Z'));
    expect(result).toEqual({ materialized: 1, completed: 0, failed: 0 });

    expect(prisma.aPBill.create).toHaveBeenCalledTimes(1);
    const args = prisma.aPBill.create.mock.calls[0][0];
    expect(args.data.status).toBe('DRAFT');
    expect(args.data.recurringTemplateId).toBe('tpl-1');
    expect(args.data.billNumber).toBe('BILL-2026-0001');
    expect(args.data.vendorId).toBe('vendor-1');
    expect(Number(args.data.whtAmount)).toBe(500);
    expect(args.data.whtAtcCode).toBe('WI160');
    // balanceAmount = total - wht = 11200 - 500 = 10700
    expect(Number(args.data.balanceAmount)).toBe(10700);

    const upd = prisma.recurringBillTemplate.update.mock.calls[0][0];
    expect(upd.data.nextRunAt.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(upd.data.status).toBe('ACTIVE');
  });
});
