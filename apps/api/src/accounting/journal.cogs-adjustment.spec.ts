import { Test, TestingModule } from '@nestjs/testing';
import { JournalService } from './journal.service';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';

/**
 * Kitchen/bar cost under the owner's "used when ready" rule:
 *  - the ready tap's COGS entry is dated to the SALE, not the tap;
 *  - an un-bump gives the cost back (Dr stock account / Cr 5010), also dated to the sale;
 *  - a made item voided or refunded moves its cost to 5070 Spoilage & Waste, dated to the
 *    void, and waits until the order's own cost entries have posted.
 */
describe('JournalService — cost of kitchen/bar items marked ready', () => {
  const CODE: Record<string, string> = { '1050': 'a1050', '1051': 'a1051', '5010': 'a5010', '5070': 'a5070' };
  const NAME = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));

  async function run(type: 'COGS' | 'COGS_ADJUSTMENT', payload: Record<string, unknown>, opts: { createdAt?: Date; unpostedCogs?: number } = {}) {
    let createData: any = null;
    const eventUpdate = jest.fn().mockResolvedValue({});
    const jeCreate = jest.fn().mockImplementation(({ data }) => { createData = data; return Promise.resolve({ id: 'je-1', lines: [] }); });
    const count = jest.fn().mockResolvedValue(opts.unpostedCogs ?? 0);
    const prisma = {
      accountingEvent: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'evt-1', tenantId: 't1', type, status: 'PENDING', payload, orderId: 'o1', createdAt: opts.createdAt ?? new Date('2026-09-16T01:00:00Z'),
        }),
        update: eventUpdate,
        count,
      },
      journalEntry: { count: jest.fn().mockResolvedValue(0), create: jeCreate, findFirst: jest.fn().mockResolvedValue(null) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'VAT' }) },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ journalEntry: { create: jeCreate }, accountingEvent: { update: eventUpdate } })),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        JournalService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccountsService, useValue: {
          seedDefaultAccounts: jest.fn().mockResolvedValue(undefined),
          findByCode: jest.fn().mockImplementation((_t: string, code: string) => Promise.resolve(CODE[code] ? { id: CODE[code], code } : null)),
        } },
        { provide: AccountingPeriodsService, useValue: { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) } },
        { provide: NumberingService, useValue: { next: jest.fn().mockResolvedValue('JE-1') } },
        { provide: AuditService, useValue: { log: jest.fn(), findSodViolations: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(JournalService);
    const outcome = await svc.processEvent('t1', 'evt-1').then((r) => ({ ok: r }), (e) => ({ error: e as Error }));
    const lines = createData
      ? (createData.lines.create as Array<{ accountId: string; debit: unknown; credit: unknown }>).map((l) => ({ account: NAME[l.accountId], debit: Number(l.debit ?? 0), credit: Number(l.credit ?? 0) }))
      : [];
    return { outcome, lines, date: createData?.date as Date | undefined, eventUpdate, count };
  }

  const SOLD = '2026-08-31T15:30:00.000Z';   // 11:30 PM Manila on the 31st

  it('the ready tap\'s cost lands on the sale\'s day, relieving raw materials', async () => {
    const { lines, date } = await run('COGS', {
      orderId: 'o1', orderItemId: 'li1', completedAt: SOLD, trigger: 'NIGHTLY',
      lines: [{ productId: 'p', orderItemId: 'li1', quantity: 1, unitCost: 63, totalCost: 63, costMethod: 'RECIPE_WAC' }],
    }, { createdAt: new Date('2026-09-01T02:30:00+08:00') });
    expect(date!.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(lines).toEqual([
      { account: '5010', debit: 63, credit: 0 },
      { account: '1051', debit: 0, credit: 63 },
    ]);
  });

  it('usage given back on an un-bump: Dr the account the cost came out of / Cr 5010, dated to the sale', async () => {
    const { lines, date } = await run('COGS_ADJUSTMENT', {
      kind: 'USAGE_RETURNED', orderId: 'o1', orderItemId: 'li1', completedAt: SOLD,
      lines: [
        { productId: 'p', quantity: 1, totalCost: 63.335, costMethod: 'RECIPE_WAC' },
        { productId: 'q', quantity: 1, totalCost: 12, costMethod: 'WAC' },
      ],
    });
    expect(date!.toISOString().slice(0, 10)).toBe('2026-08-31');
    const debit = (code: string) => lines.filter((l) => l.account === code).reduce((t, l) => t + l.debit, 0);
    expect(debit('1051')).toBeCloseTo(63.34, 2);
    expect(debit('1050')).toBeCloseTo(12, 2);
    expect(lines.find((l) => l.account === '5010')).toEqual({ account: '5010', debit: 0, credit: 75.34 });
    expect(lines.reduce((t, l) => t + l.debit - l.credit, 0)).toBeCloseTo(0, 6);
  });

  it('waste: Dr 5070 / Cr 5010 on the day of the void', async () => {
    const { lines, date } = await run('COGS_ADJUSTMENT', {
      kind: 'WASTE', source: 'VOID', orderId: 'o1', orderNumber: 'ORD-9',
      lines: [{ productId: 'p', orderItemId: 'li1', quantity: 2, unitCost: 62.345, totalCost: 124.69, costMethod: 'RECIPE_WAC' }],
    }, { createdAt: new Date('2026-09-16T01:00:00Z') });
    expect(date!.toISOString().slice(0, 10)).toBe('2026-09-16');
    expect(lines).toEqual([
      { account: '5070', debit: 124.69, credit: 0 },
      { account: '5010', debit: 0, credit: 124.69 },
    ]);
  });

  it('waste waits while the order\'s own cost entries have not posted', async () => {
    const { outcome, lines, count } = await run('COGS_ADJUSTMENT', {
      kind: 'WASTE', orderId: 'o1', lines: [{ productId: 'p', quantity: 1, totalCost: 50, costMethod: 'RECIPE_WAC' }],
    }, { unpostedCogs: 1 });
    expect((outcome as { error?: Error }).error?.message).toMatch(/waits for its cost of goods to post/);
    expect(lines).toEqual([]);
    expect(count.mock.calls[0][0].where).toMatchObject({ orderId: 'o1', type: 'COGS', status: { in: ['PENDING', 'FAILED'] } });
  });

  it('nothing to move is done without an entry; an unknown kind is refused, not skipped', async () => {
    const zero = await run('COGS_ADJUSTMENT', { kind: 'WASTE', orderId: 'o1', lines: [] });
    expect(zero.outcome).toEqual({ ok: { skipped: true } });
    expect(zero.eventUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SYNCED' }) }));

    const odd = await run('COGS_ADJUSTMENT', { kind: 'SOMETHING', orderId: 'o1', lines: [{ totalCost: 5 }] });
    expect((odd.outcome as { error?: Error }).error?.message).toMatch(/must be USAGE_RETURNED or WASTE/);
  });
});
