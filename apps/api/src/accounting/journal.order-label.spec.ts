import { Test, TestingModule } from '@nestjs/testing';
import { JournalService } from './journal.service';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';

/**
 * Journal descriptions name the ORDER NUMBER, not the database id.
 *
 * A void used to read "Void reversal cmuax4zvz000fvfl8z1fvbhp0" while its sale
 * read "Sale ORD-2026-000088", so a bookkeeper could not match the two by
 * reading. COGS had the same problem and its payload carries only the id, so
 * the number is looked up.
 */
describe('JournalService — descriptions use the order number', () => {
  const ACCOUNT_IDS: Record<string, string> = {
    '1010': 'acct-1010', '1031': 'acct-1031', '1050': 'acct-1050', '1051': 'acct-1051',
    '2020': 'acct-2020', '4010': 'acct-4010', '5010': 'acct-5010', '5070': 'acct-5070',
  };

  async function run(
    type: 'VOID' | 'COGS',
    payload: Record<string, unknown>,
    order: { orderNumber: string } | null | 'throws' = null,
  ) {
    let createData: any = null;
    const jeCreate = jest.fn().mockImplementation(({ data }) => { createData = data; return Promise.resolve({ id: 'je-1', lines: [] }); });
    const eventUpdate = jest.fn().mockResolvedValue({});
    const orderFindFirst = order === 'throws'
      ? jest.fn().mockRejectedValue(new Error('db down'))
      : jest.fn().mockResolvedValue(order);

    const prisma = {
      accountingEvent: {
        findFirst: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.id ? {
          id: 'evt-1', tenantId: 'tenant-1', type, status: 'PENDING', payload, orderId: 'cmuax4zvz000fvfl8z1fvbhp0', createdAt: new Date(),
        } : null)),
        findMany: jest.fn().mockResolvedValue([]),
        update:   eventUpdate,
      },
      order:        { findFirst: orderFindFirst },
      journalEntry: { count: jest.fn().mockResolvedValue(0), create: jeCreate, findFirst: jest.fn().mockResolvedValue(null) },
      tenant:       { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT' }) },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({
        journalEntry:    { create: jeCreate },
        accountingEvent: { update: eventUpdate },
      })),
    };
    const accounts = {
      seedDefaultAccounts: jest.fn().mockResolvedValue(undefined),
      findByCode: jest.fn().mockImplementation((_t: string, code: string) =>
        Promise.resolve(ACCOUNT_IDS[code] ? { id: ACCOUNT_IDS[code], code, name: `Account ${code}` } : null)),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        JournalService,
        { provide: PrismaService,            useValue: prisma },
        { provide: AccountsService,          useValue: accounts },
        { provide: AccountingPeriodsService, useValue: { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) } },
        { provide: NumberingService,         useValue: { next: jest.fn().mockResolvedValue('JE-202609-0001') } },
        { provide: AuditService,             useValue: { log: jest.fn(), findSodViolations: jest.fn() } },
      ],
    }).compile();
    await moduleRef.get(JournalService).processEvent('tenant-1', 'evt-1');
    return { description: () => createData?.description as string | undefined, orderFindFirst };
  }

  const voidPayload = (extra: Record<string, unknown> = {}) => ({
    orderId: 'cmuax4zvz000fvfl8z1fvbhp0',
    reason: 'wrong order', totalAmount: 160, vatAmount: 0, discountAmount: 0,
    invoiceType: 'CASH_SALE', payments: [{ method: 'CASH', amount: 160 }],
    restockedCogsTotal: 0, refundedAmount: 0,
    ...extra,
  });

  it('a void names the order number carried in the event', async () => {
    const { description, orderFindFirst } = await run('VOID', voidPayload({ orderNumber: 'ORD-2026-000088' }));
    expect(description()).toBe('Void reversal ORD-2026-000088');
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it('an older void event without the number looks it up', async () => {
    const { description, orderFindFirst } = await run('VOID', voidPayload(), { orderNumber: 'ORD-2026-000088' });
    expect(description()).toBe('Void reversal ORD-2026-000088');
    expect(orderFindFirst.mock.calls[0][0].where).toEqual({ id: 'cmuax4zvz000fvfl8z1fvbhp0', tenantId: 'tenant-1' });
  });

  it('COGS names the order number too', async () => {
    const { description } = await run(
      'COGS',
      { orderId: 'cmuax4zvz000fvfl8z1fvbhp0', lines: [{ totalCost: 42.5, costMethod: 'RECIPE_WAC' }] },
      { orderNumber: 'ORD-2026-000088' },
    );
    expect(description()).toBe('COGS ORD-2026-000088');
  });

  it('a failed lookup never blocks the posting — it falls back to the id', async () => {
    const { description } = await run(
      'COGS',
      { orderId: 'cmuax4zvz000fvfl8z1fvbhp0', lines: [{ totalCost: 42.5, costMethod: 'RECIPE_WAC' }] },
      'throws',
    );
    expect(description()).toBe('COGS cmuax4zvz000fvfl8z1fvbhp0');
  });
});
