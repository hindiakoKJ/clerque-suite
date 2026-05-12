/**
 * Sprint 22 — Scheduler spec for the recurring-AR materializer.
 *
 * Mocks the prisma client; asserts that:
 *   - one due ACTIVE template produces exactly one DRAFT ARInvoice create
 *   - the child's recurringTemplateId links back to the template
 *   - lines + totals are copied verbatim from the template
 *   - the template's nextRunAt advances by the frequency
 *   - status flips to COMPLETED when the new nextRunAt exceeds endDate
 */
import { RecurringInvoicesScheduler } from './recurring-invoices.scheduler';

function makePrisma() {
  return {
    recurringInvoiceTemplate: { findMany: jest.fn(), update: jest.fn() },
    aRInvoice:                { create: jest.fn() },
    $transaction:             jest.fn(),
  } as const;
}

describe('RecurringInvoicesScheduler.materializeDue', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let numbering: { next: jest.Mock };
  let scheduler: RecurringInvoicesScheduler;

  beforeEach(() => {
    prisma    = makePrisma();
    numbering = { next: jest.fn().mockResolvedValue('INV-2026-0001') };
    (prisma as any).$transaction = jest.fn(async (cb: any) => cb(prisma));
    scheduler = new RecurringInvoicesScheduler(prisma as any, numbering as any);
  });

  it('creates one DRAFT child and advances nextRunAt', async () => {
    const dueDate = new Date('2026-05-15T00:00:00.000Z');
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([{
      id: 'tpl-1', tenantId: 'tenant-1', branchId: null,
      templateNumber: 'RI-2026-0001', name: 'Retainer',
      customerId: 'cust-1', frequency: 'MONTHLY', dayOfPeriod: 15,
      startDate: dueDate, endDate: null,
      termsDays: 0, nextRunAt: dueDate,
      subtotal: 1000, vatAmount: 120, totalAmount: 1120,
      description: null, notes: null, createdById: 'user-1',
      lines: [
        { accountId: 'acc-rev', description: 'Retainer', quantity: 1, unitPrice: 1000, taxAmount: 120, lineTotal: 1120 },
      ],
    }]);

    const result = await scheduler.materializeDue(new Date('2026-05-15T01:05:00.000Z'));

    expect(result).toEqual({ materialized: 1, completed: 0, failed: 0 });
    expect(numbering.next).toHaveBeenCalledWith('tenant-1', 'AR_INVOICE', null, prisma);

    // Assert the SQL-level effect: ARInvoice.create called with correct fields.
    expect(prisma.aRInvoice.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.aRInvoice.create.mock.calls[0][0];
    expect(createArgs.data.status).toBe('DRAFT');
    expect(createArgs.data.recurringTemplateId).toBe('tpl-1');
    expect(createArgs.data.tenantId).toBe('tenant-1');
    expect(createArgs.data.invoiceNumber).toBe('INV-2026-0001');
    expect(createArgs.data.customerId).toBe('cust-1');
    expect(createArgs.data.invoiceDate.toISOString()).toBe(dueDate.toISOString());
    expect(Number(createArgs.data.totalAmount)).toBe(1120);
    expect(createArgs.data.lines.create).toHaveLength(1);
    expect(createArgs.data.lines.create[0].accountId).toBe('acc-rev');

    // And the template's nextRunAt advanced to June 15.
    expect(prisma.recurringInvoiceTemplate.update).toHaveBeenCalledTimes(1);
    const updateArgs = prisma.recurringInvoiceTemplate.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'tpl-1' });
    expect(updateArgs.data.nextRunAt.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(updateArgs.data.status).toBe('ACTIVE');
    expect(updateArgs.data.runCount).toEqual({ increment: 1 });
  });

  it('flips status to COMPLETED when next run exceeds endDate', async () => {
    const dueDate = new Date('2026-05-15T00:00:00.000Z');
    const endDate = new Date('2026-05-31T00:00:00.000Z');
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([{
      id: 'tpl-1', tenantId: 'tenant-1', branchId: null,
      templateNumber: 'RI-2026-0001', name: 'Final month',
      customerId: 'cust-1', frequency: 'MONTHLY', dayOfPeriod: 15,
      startDate: dueDate, endDate,
      termsDays: 0, nextRunAt: dueDate,
      subtotal: 100, vatAmount: 0, totalAmount: 100,
      description: null, notes: null, createdById: 'user-1',
      lines: [{ accountId: 'acc-rev', description: null, quantity: 1, unitPrice: 100, taxAmount: 0, lineTotal: 100 }],
    }]);

    const result = await scheduler.materializeDue(new Date('2026-05-15T01:05:00.000Z'));
    expect(result).toEqual({ materialized: 1, completed: 1, failed: 0 });

    const updateArgs = prisma.recurringInvoiceTemplate.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('COMPLETED');
  });

  it('isolates per-template failures so one bad row does not abort the loop', async () => {
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([
      {
        id: 'tpl-bad', tenantId: 'tenant-1', branchId: null,
        templateNumber: 'RI-X', name: 'Bad',
        customerId: 'cust-1', frequency: 'MONTHLY', dayOfPeriod: 15,
        startDate: new Date('2026-05-15'), endDate: null,
        termsDays: 0, nextRunAt: new Date('2026-05-15'),
        subtotal: 100, vatAmount: 0, totalAmount: 100,
        description: null, notes: null, createdById: 'user-1',
        lines: [{ accountId: 'acc-rev', description: null, quantity: 1, unitPrice: 100, taxAmount: 0, lineTotal: 100 }],
      },
      {
        id: 'tpl-good', tenantId: 'tenant-1', branchId: null,
        templateNumber: 'RI-Y', name: 'Good',
        customerId: 'cust-2', frequency: 'MONTHLY', dayOfPeriod: 1,
        startDate: new Date('2026-05-01'), endDate: null,
        termsDays: 0, nextRunAt: new Date('2026-05-01'),
        subtotal: 200, vatAmount: 0, totalAmount: 200,
        description: null, notes: null, createdById: 'user-1',
        lines: [{ accountId: 'acc-rev', description: null, quantity: 1, unitPrice: 200, taxAmount: 0, lineTotal: 200 }],
      },
    ]);
    // First $transaction call throws (bad row); second succeeds.
    let call = 0;
    (prisma as any).$transaction = jest.fn(async (cb: any) => {
      if (call++ === 0) throw new Error('boom');
      return cb(prisma);
    });

    const result = await scheduler.materializeDue(new Date('2026-05-15T01:05:00.000Z'));
    expect(result.failed).toBe(1);
    expect(result.materialized).toBe(1);
  });
});
