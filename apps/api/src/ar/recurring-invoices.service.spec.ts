/**
 * Sprint 22 — RecurringInvoicesService happy-path coverage.
 *
 *   1. create — ACTIVE template, nextRunAt = startDate, totals computed
 *   2. pause  — ACTIVE → PAUSED
 *   3. resume — PAUSED → ACTIVE; advances nextRunAt forward past now
 *   4. cancel — non-terminal → CANCELLED
 */
import { RecurringInvoicesService } from './recurring-invoices.service';

const TENANT = 'tenant-1';
const USER   = 'user-1';

function makePrisma() {
  return {
    customer: { findFirst: jest.fn() },
    account:  { count:     jest.fn() },
    recurringInvoiceTemplate: {
      findFirst:  jest.fn(),
      findUnique: jest.fn(),
      findMany:   jest.fn(),
      count:      jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
      updateMany: jest.fn(),
    },
    recurringInvoiceTemplateLine: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  } as const;
}

describe('RecurringInvoicesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let numbering: { next: jest.Mock };
  let svc: RecurringInvoicesService;

  beforeEach(() => {
    prisma    = makePrisma();
    numbering = { next: jest.fn().mockResolvedValue('RI-2026-0001') };
    (prisma as any).$transaction = jest.fn(async (cb: any) => cb(prisma));
    svc = new RecurringInvoicesService(prisma as any, numbering as any);
  });

  it('create — ACTIVE template with nextRunAt = startDate and computed totals', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.account.count.mockResolvedValue(1);
    prisma.recurringInvoiceTemplate.create.mockResolvedValue({
      id: 'tpl-1', templateNumber: 'RI-2026-0001', status: 'ACTIVE',
      frequency: 'MONTHLY', customerId: 'cust-1', name: 'Retainer',
    });

    await svc.create(TENANT, USER, {
      name: 'Retainer', customerId: 'cust-1',
      frequency: 'MONTHLY', dayOfPeriod: 15,
      startDate: '2026-06-15',
      lines: [{ accountId: 'acc-rev', unitPrice: 1000, taxAmount: 120, lineTotal: 1120 }],
    });

    const args = prisma.recurringInvoiceTemplate.create.mock.calls[0][0];
    expect(args.data.status).toBe('ACTIVE');
    expect(args.data.templateNumber).toBe('RI-2026-0001');
    expect(args.data.nextRunAt.toISOString()).toBe(new Date('2026-06-15').toISOString());
    expect(Number(args.data.subtotal)).toBe(1000);
    expect(Number(args.data.vatAmount)).toBe(120);
    expect(Number(args.data.totalAmount)).toBe(1120);
    expect(numbering.next).toHaveBeenCalledWith(TENANT, 'RECURRING_INVOICE', null, prisma);
  });

  it('create — rejects when endDate <= startDate', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.account.count.mockResolvedValue(1);

    await expect(svc.create(TENANT, USER, {
      name: 'Bad', customerId: 'cust-1',
      frequency: 'MONTHLY', dayOfPeriod: 1,
      startDate: '2026-06-15', endDate: '2026-06-01',
      lines: [{ accountId: 'acc-rev', unitPrice: 100, lineTotal: 100 }],
    })).rejects.toThrow(/endDate must be after startDate/);
  });

  it('pause — ACTIVE → PAUSED via conditional updateMany', async () => {
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
    prisma.recurringInvoiceTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', status: 'PAUSED' });

    const result = await svc.pause(TENANT, 'tpl-1', USER);
    expect(prisma.recurringInvoiceTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: 'tpl-1', tenantId: TENANT, status: 'ACTIVE' },
      data:  { status: 'PAUSED' },
    });
    expect(result).toMatchObject({ status: 'PAUSED' });
  });

  it('pause — rejects when template is not ACTIVE', async () => {
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.pause(TENANT, 'tpl-1', USER)).rejects.toThrow(/not in status ACTIVE/);
  });

  it('resume — advances nextRunAt past now', async () => {
    // Template last ran 90 days ago, monthly cadence. Resume must advance past now.
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1', tenantId: TENANT, status: 'PAUSED',
      frequency: 'MONTHLY', dayOfPeriod: longAgo.getUTCDate(),
      nextRunAt: longAgo,
    });
    prisma.recurringInvoiceTemplate.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'tpl-1', ...data }));

    const result = await svc.resume(TENANT, 'tpl-1', USER);

    expect(result.status).toBe('ACTIVE');
    expect(result.nextRunAt.getTime()).toBeGreaterThanOrEqual(Date.now());
  });

  it('resume — rejects when template not PAUSED', async () => {
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1', tenantId: TENANT, status: 'ACTIVE',
      frequency: 'MONTHLY', dayOfPeriod: 1, nextRunAt: new Date(),
    });
    await expect(svc.resume(TENANT, 'tpl-1', USER)).rejects.toThrow(/Cannot resume/);
  });

  it('cancel — non-terminal → CANCELLED', async () => {
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue({ id: 'tpl-1', status: 'ACTIVE' });
    prisma.recurringInvoiceTemplate.update.mockResolvedValue({ id: 'tpl-1', status: 'CANCELLED' });

    const result = await svc.cancel(TENANT, 'tpl-1', USER);
    expect(prisma.recurringInvoiceTemplate.update).toHaveBeenCalledWith({
      where: { id: 'tpl-1' }, data: { status: 'CANCELLED' },
    });
    expect(result).toMatchObject({ status: 'CANCELLED' });
  });

  it('cancel — rejects when already in terminal status', async () => {
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue({ id: 'tpl-1', status: 'COMPLETED' });
    await expect(svc.cancel(TENANT, 'tpl-1', USER)).rejects.toThrow(/terminal status/);
  });
});
