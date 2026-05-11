/**
 * Journal processor — PAID_OUT + CASH_VARIANCE handlers.
 *
 * Sprint 11 closed the POS→Ledger gap for shift cash flows. These tests verify
 * the processor emits balanced JEs for both event types and routes to the
 * right chart-of-accounts codes per category.
 */
import { JournalService } from './journal.service';

const TENANT_A = 'tenant-a';

function makeAccountsMock() {
  // Returns a stable id derived from the code so we can assert on it.
  return {
    seedDefaultAccounts: jest.fn().mockResolvedValue(undefined),
    findByCode: jest.fn(async (_t: string, code: string) => ({ id: `acct-${code}`, code })),
  };
}

function makePeriodsMock() {
  return { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
}

function makePrismaMock(event: any) {
  // Share the mock so the service can also re-fetch its own row mid-process.
  let rowStatus = event.status;
  const journalEntryCreate = jest.fn().mockImplementation(async (args: any) => ({ id: 'je-1', ...args.data }));
  const accountingEventUpdate = jest.fn().mockImplementation(async ({ data }: any) => {
    rowStatus = data.status ?? rowStatus;
    return { ...event, status: rowStatus };
  });
  const mock: any = {
    accountingEvent: {
      findFirst: jest.fn().mockImplementation(async () => ({ ...event, status: rowStatus })),
      update:    accountingEventUpdate,
    },
    journalEntry: {
      create:    journalEntryCreate,
      count:     jest.fn().mockResolvedValue(0),
      // Idempotency reconciliation in processEvent calls findFirst first.
      findFirst: jest.fn().mockResolvedValue(null),
    },
    // sequence helper
    $queryRaw:    jest.fn().mockResolvedValue([{ next_seq: BigInt(1) }]),
    $executeRaw:  jest.fn(),
  };
  // The service wraps JE creation in a $transaction; route the tx mock to
  // the same accountingEvent + journalEntry mocks so assertions still see
  // the create call from outside the transaction wrapper.
  mock.$transaction = jest.fn(async (cb: any) =>
    cb({
      accountingEvent: { update: accountingEventUpdate },
      journalEntry:    { create: journalEntryCreate },
    }),
  );
  return mock;
}

function makeService(prisma: any) {
  const numberingMock = { next: jest.fn().mockResolvedValue('JE-202605-0001') } as any;
  return new JournalService(
    prisma,
    makeAccountsMock() as any,
    makePeriodsMock() as any,
    numberingMock,
  );
}

describe('JournalService.processEvent — PAID_OUT', () => {
  const baseEvent = {
    id:        'evt-paid-1',
    tenantId:  TENANT_A,
    type:      'PAID_OUT' as const,
    status:    'PENDING' as const,
    createdAt: new Date('2026-05-12T10:00:00+08:00'),
    orderId:   null,
    payload:   {} as Record<string, unknown>,
  };

  it('SUPPLIES → DR 6070 (Office Supplies) / CR 1010 (Cash)', async () => {
    const event  = { ...baseEvent, payload: { amount: 250, category: 'SUPPLIES', reason: 'register tape', shiftId: 'shift-1' } };
    const prisma = makePrismaMock(event);
    const svc    = makeService(prisma);

    await svc.processEvent(TENANT_A, event.id);

    const args = prisma.journalEntry.create.mock.calls[0][0] as any;
    const lines = args.data.lines.create as any[];
    expect(lines).toHaveLength(2);
    const debit  = lines.find((l) => l.debit > 0);
    const credit = lines.find((l) => l.credit > 0);
    expect(debit.accountId).toBe('acct-6070');
    expect(Number(debit.debit)).toBe(250);
    expect(credit.accountId).toBe('acct-1010');
    expect(Number(credit.credit)).toBe(250);
  });

  it.each([
    ['TRANSPORT', '6100'],
    ['UTILITIES', '6060'],
    ['REPAIRS',   '6090'],
    ['OTHER',     '6140'],
    ['MEALS',     '6140'], // unknown categories fall through to misc
  ])('routes %s category to account %s', async (category, code) => {
    const event  = { ...baseEvent, payload: { amount: 100, category } };
    const prisma = makePrismaMock(event);
    const svc    = makeService(prisma);

    await svc.processEvent(TENANT_A, event.id);

    const lines = prisma.journalEntry.create.mock.calls[0][0].data.lines.create as any[];
    const debit = lines.find((l) => l.debit > 0);
    expect(debit.accountId).toBe(`acct-${code}`);
  });

  it('amount <= 0 marks the event SYNCED + skipped — no JE created', async () => {
    const event  = { ...baseEvent, payload: { amount: 0, category: 'SUPPLIES' } };
    const prisma = makePrismaMock(event);
    const svc    = makeService(prisma);

    const res = await svc.processEvent(TENANT_A, event.id);
    expect(res.skipped).toBe(true);
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });
});

describe('JournalService.processEvent — CASH_VARIANCE', () => {
  const baseEvent = {
    id:        'evt-var-1',
    tenantId:  TENANT_A,
    type:      'CASH_VARIANCE' as const,
    status:    'PENDING' as const,
    createdAt: new Date('2026-05-12T22:00:00+08:00'),
    orderId:   null,
    payload:   {} as Record<string, unknown>,
  };

  it('overage (declared > expected) → DR 1010 / CR 4092 misc income', async () => {
    const event  = { ...baseEvent, payload: { variance: 25, declaredAmount: 1525, expectedAmount: 1500, shiftId: 'shift-x' } };
    const prisma = makePrismaMock(event);
    const svc    = makeService(prisma);

    await svc.processEvent(TENANT_A, event.id);

    const lines = prisma.journalEntry.create.mock.calls[0][0].data.lines.create as any[];
    const debit  = lines.find((l) => l.debit > 0);
    const credit = lines.find((l) => l.credit > 0);
    expect(debit.accountId).toBe('acct-1010');
    expect(Number(debit.debit)).toBe(25);
    expect(credit.accountId).toBe('acct-4092');
    expect(Number(credit.credit)).toBe(25);
  });

  it('shortage (declared < expected) → DR 6140 misc expense / CR 1010', async () => {
    const event  = { ...baseEvent, payload: { variance: -50, declaredAmount: 1450, expectedAmount: 1500, shiftId: 'shift-y' } };
    const prisma = makePrismaMock(event);
    const svc    = makeService(prisma);

    await svc.processEvent(TENANT_A, event.id);

    const lines = prisma.journalEntry.create.mock.calls[0][0].data.lines.create as any[];
    const debit  = lines.find((l) => l.debit > 0);
    const credit = lines.find((l) => l.credit > 0);
    expect(debit.accountId).toBe('acct-6140');
    expect(Number(debit.debit)).toBe(50);
    expect(credit.accountId).toBe('acct-1010');
    expect(Number(credit.credit)).toBe(50);
  });

  it('zero variance is a no-op (no JE created, event marked SYNCED)', async () => {
    const event  = { ...baseEvent, payload: { variance: 0, declaredAmount: 1500, expectedAmount: 1500 } };
    const prisma = makePrismaMock(event);
    const svc    = makeService(prisma);

    const res = await svc.processEvent(TENANT_A, event.id);
    expect(res.skipped).toBe(true);
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });
});
