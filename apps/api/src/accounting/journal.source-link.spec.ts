import { Test, TestingModule } from '@nestjs/testing';
import { JournalService } from './journal.service';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';

/**
 * From the books back to the delivery.
 *
 * A stock receipt's journal entry used to carry the request number only as
 * words inside its description; nothing could link from it, and a credit
 * receipt's AP bill was never tied to the entry that credited 2010 for it,
 * so the bill could not be voided. Pinned here: the entry's `reference` is
 * the event's reference; the matching unlinked bill gets the entry's id; a
 * transfer between branches is skipped and never becomes an entry.
 */
describe('JournalService — system entries point back at their source', () => {
  const ACCOUNT_IDS: Record<string, string> = {
    '1010': 'acct-1010', '1040': 'acct-1040', '1050': 'acct-1050', '1051': 'acct-1051',
    '2010': 'acct-2010', '3010': 'acct-3010', '5010': 'acct-5010', '5060': 'acct-5060',
    '5070': 'acct-5070', '6070': 'acct-6070', '6210': 'acct-6210',
  };

  async function run(payload: Record<string, unknown>, opts: { bill?: { id: string } | null } = {}) {
    let createData: any = null;
    const apFindFirst = jest.fn().mockResolvedValue(opts.bill ?? null);
    const apUpdate = jest.fn().mockResolvedValue({});
    const eventUpdate = jest.fn().mockResolvedValue({});
    const jeCreate = jest.fn().mockImplementation(({ data }) => { createData = data; return Promise.resolve({ id: 'je-1', lines: [] }); });

    const prisma = {
      accountingEvent: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'evt-1', tenantId: 'tenant-1', type: 'INVENTORY_ADJUSTMENT', status: 'PENDING', payload, orderId: null, createdAt: new Date(),
        }),
        update: eventUpdate,
      },
      journalEntry: { count: jest.fn().mockResolvedValue(0), create: jeCreate, findFirst: jest.fn().mockResolvedValue(null) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'VAT' }) },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({
        journalEntry:    { create: jeCreate },
        accountingEvent: { update: eventUpdate },
        aPBill:          { findFirst: apFindFirst, update: apUpdate },
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
    const result = await moduleRef.get(JournalService).processEvent('tenant-1', 'evt-1');
    return { result, createData: () => createData, apFindFirst, apUpdate, eventUpdate, jeCreate };
  }

  const receipt = (extra: Record<string, unknown>) => ({
    kind: 'RAW_MATERIAL_RECEIPT', rawMaterialId: 'rm-1', rawMaterialName: 'Chicken breast', productName: 'Chicken breast',
    category: 'INGREDIENT', unit: 'kg', quantity: 10, unitCost: 200, totalValue: 2000, branchId: 'b-1',
    ...extra,
  });

  it('writes the receipt\'s reference onto the entry so the books can link to the request', async () => {
    const { createData, apFindFirst } = await run(receipt({ paymentMethod: 'CASH', referenceNumber: 'REQ-20260903-001' }));
    expect(createData().reference).toBe('REQ-20260903-001');
    expect(createData().source).toBe('SYSTEM');
    expect(apFindFirst).not.toHaveBeenCalled();
  });

  it('leaves the reference empty when the event has none', async () => {
    const { createData } = await run(receipt({ paymentMethod: 'CASH' }));
    expect(createData().reference).toBeUndefined();
  });

  it('ties a credit receipt\'s AP bill to the entry that credited 2010 for it', async () => {
    const { apFindFirst, apUpdate } = await run(
      receipt({ paymentMethod: 'CREDIT', referenceNumber: 'REQ-20260903-002', grossValue: 2000 }),
      { bill: { id: 'bill-7' } },
    );
    const where = apFindFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: 'tenant-1', reference: 'REQ-20260903-002', journalEntryId: null, createdById: 'system-receive' });
    expect(Number(where.totalAmount)).toBe(2000);
    expect(apUpdate).toHaveBeenCalledWith({ where: { id: 'bill-7' }, data: { journalEntryId: 'je-1' } });
  });

  it('still posts the entry when no bill matches, and touches nothing', async () => {
    const { result, apUpdate, jeCreate } = await run(
      receipt({ paymentMethod: 'CREDIT', referenceNumber: 'REQ-20260903-003', grossValue: 2000 }),
      { bill: null },
    );
    expect(result.skipped).toBeFalsy();
    expect(jeCreate).toHaveBeenCalledTimes(1);
    expect(apUpdate).not.toHaveBeenCalled();
  });

  it('skips a transfer between branches: stock moved, value did not', async () => {
    const { result, jeCreate, eventUpdate } = await run({
      kind: 'STOCK_TRANSFER', direction: 'OUT', rawMaterialName: 'Sugar', category: 'INGREDIENT', unit: 'g',
      quantity: 1500, unitCost: 0.09, totalValue: 135, branchId: 'b-main', referenceNumber: 'ST-2026-000007',
    });
    expect(result).toEqual({ skipped: true });
    expect(jeCreate).not.toHaveBeenCalled();
    expect(eventUpdate.mock.calls[0][0].data.status).toBe('SYNCED');
  });
});
