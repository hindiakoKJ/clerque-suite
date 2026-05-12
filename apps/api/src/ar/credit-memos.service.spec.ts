/**
 * CreditMemosService — happy-path coverage:
 *   1. create()  — DRAFT memo with computed totals + numbering
 *   2. post()    — moves DRAFT → POSTED, builds balanced GL lines (DR Revenue / CR AR)
 *   3. apply()   — decreases invoice balance, flips memo → APPLIED when fully consumed
 */

import { CreditMemosService } from './credit-memos.service';
import { Prisma } from '@prisma/client';

const TENANT = 'tenant-1';
const USER   = 'user-1';

function makePrismaMock() {
  // Plain prisma client + a $transaction passthrough returning whatever the callback returns
  return {
    customer:           { findFirst: jest.fn() },
    account:            { findFirst: jest.fn(), count: jest.fn() },
    aRInvoice:          { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    creditMemo:         { findFirst: jest.fn(), findFirstOrThrow: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    creditMemoLine:     { deleteMany: jest.fn() },
    creditMemoApplication: { create: jest.fn(), aggregate: jest.fn(), deleteMany: jest.fn() },
    tenant:             { findUniqueOrThrow: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(/* tx === outer prismaMock */ undefined)),
  };
}

describe('CreditMemosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let journal: { create: jest.Mock; reverse: jest.Mock };
  let periods: { assertDateIsOpen: jest.Mock };
  let numbering: { next: jest.Mock };
  let audit: { log: jest.Mock };
  let service: CreditMemosService;

  beforeEach(() => {
    prisma    = makePrismaMock();
    journal   = { create: jest.fn(), reverse: jest.fn() };
    periods   = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    numbering = { next: jest.fn().mockResolvedValue('CM-2026-0001') };
    audit     = { log: jest.fn().mockResolvedValue(undefined) };

    // Wire $transaction to use prisma itself as the tx client so mocked calls hit the same jest.fn instances.
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    service = new CreditMemosService(
      prisma as any, journal as any, periods as any, numbering as any, audit as any,
    );
  });

  describe('create — DRAFT memo with computed totals', () => {
    it('computes subtotal/vatAmount/totalAmount and persists via numbering', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
      prisma.account.count.mockResolvedValue(1);
      prisma.creditMemo.create.mockResolvedValue({
        id: 'memo-1', memoNumber: 'CM-2026-0001', status: 'DRAFT',
      });

      const result = await service.create(TENANT, USER, {
        customerId: 'cust-1',
        memoDate:   '2026-05-12',
        lines: [
          { accountId: 'acc-rev', unitPrice: 100, taxAmount: 12, lineTotal: 112 },
        ],
      });

      expect(numbering.next).toHaveBeenCalledWith(TENANT, 'AR_CREDIT_MEMO', null, prisma);
      const callArgs = prisma.creditMemo.create.mock.calls[0][0];
      // subtotal = 112 - 12 = 100, vat = 12, total = 112, unapplied = 112
      expect(Number(callArgs.data.subtotal.toFixed?.(2) ?? callArgs.data.subtotal)).toBe(100);
      expect(Number(callArgs.data.vatAmount.toFixed?.(2) ?? callArgs.data.vatAmount)).toBe(12);
      expect(Number(callArgs.data.totalAmount.toFixed?.(2) ?? callArgs.data.totalAmount)).toBe(112);
      expect(Number(callArgs.data.unappliedAmount.toFixed?.(2) ?? callArgs.data.unappliedAmount)).toBe(112);
      expect(callArgs.data.status).toBe('DRAFT');
      expect(callArgs.data.memoNumber).toBe('CM-2026-0001');
      expect(result).toMatchObject({ status: 'DRAFT', memoNumber: 'CM-2026-0001' });
    });

    it('rejects with no lines', async () => {
      await expect(service.create(TENANT, USER, {
        customerId: 'cust-1', memoDate: '2026-05-12', lines: [],
      })).rejects.toThrow(/at least one line/);
    });

    it('rejects unknown customer', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      await expect(service.create(TENANT, USER, {
        customerId: 'cust-x', memoDate: '2026-05-12',
        lines: [{ accountId: 'a', unitPrice: 1, lineTotal: 1 }],
      })).rejects.toThrow(/Customer not found/);
    });
  });

  describe('post — DRAFT → POSTED with balanced JE', () => {
    it('builds DR Revenue / CR AR and flips status atomically', async () => {
      prisma.creditMemo.findFirst.mockResolvedValue({
        id: 'memo-1',
        memoNumber: 'CM-2026-0001',
        status: 'DRAFT',
        memoDate:    new Date('2026-05-12'),
        postingDate: new Date('2026-05-12'),
        totalAmount: new Prisma.Decimal(112),
        vatAmount:   new Prisma.Decimal(12),
        customer:    { name: 'Acme' },
        lines: [
          { accountId: 'acc-rev', lineTotal: new Prisma.Decimal(112), taxAmount: new Prisma.Decimal(12), description: 'Returned widget' },
        ],
      });
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({ taxStatus: 'VAT' });
      // findArReceivablesAccount → first call (code 1300) returns hit
      prisma.account.findFirst
        .mockResolvedValueOnce({ id: 'acc-ar' })     // AR
        .mockResolvedValueOnce({ id: 'acc-vat' });   // Output VAT
      journal.create.mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202605-0001' });
      prisma.creditMemo.updateMany.mockResolvedValue({ count: 1 });
      prisma.creditMemo.findFirstOrThrow.mockResolvedValue({
        id: 'memo-1', status: 'POSTED', journalEntryId: 'je-1',
      });

      const result = await service.post(TENANT, 'memo-1', USER);

      // Period guard ran
      expect(periods.assertDateIsOpen).toHaveBeenCalledWith(TENANT, expect.any(Date));

      // JE source is 'AR' (so we can post to AR-only accounts) and lines balance
      expect(journal.create).toHaveBeenCalledTimes(1);
      const jeCall = journal.create.mock.calls[0];
      expect(jeCall[3]).toBe('AR');
      const jeLines = jeCall[1].lines as Array<{ debit?: number; credit?: number }>;
      const totalDebit  = jeLines.reduce((s, l) => s + (l.debit  ?? 0), 0);
      const totalCredit = jeLines.reduce((s, l) => s + (l.credit ?? 0), 0);
      expect(totalDebit).toBeCloseTo(112, 2);
      expect(totalCredit).toBeCloseTo(112, 2);

      // Status flip: tenant-scoped updateMany guarded on status: 'DRAFT'
      expect(prisma.creditMemo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'memo-1', tenantId: TENANT, status: 'DRAFT' },
      }));
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'AR_INVOICE_POSTED', entityType: 'CreditMemo',
      }));
      expect(result).toMatchObject({ status: 'POSTED', journalEntryId: 'je-1' });
    });
  });

  describe('apply — invoice balance drops, memo flips to APPLIED on full consumption', () => {
    it('decreases invoice balance and marks memo APPLIED when fully applied', async () => {
      // Memo has 100 unapplied; we apply all of it.
      prisma.creditMemo.findFirst.mockResolvedValue({
        id: 'memo-1',
        memoNumber: 'CM-2026-0001',
        status: 'POSTED',
        customerId: 'cust-1',
        totalAmount: new Prisma.Decimal(100),
        unappliedAmount: new Prisma.Decimal(100),
      });
      prisma.aRInvoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        invoiceNumber: 'INV-2026-0007',
        status: 'OPEN',
        balanceAmount: new Prisma.Decimal(250),
        totalAmount:   new Prisma.Decimal(250),
        paidAmount:    new Prisma.Decimal(0),
      });
      prisma.creditMemoApplication.create.mockResolvedValue({});
      prisma.creditMemoApplication.aggregate.mockResolvedValue({ _sum: { appliedAmount: new Prisma.Decimal(100) } });
      prisma.creditMemo.update.mockResolvedValue({});
      prisma.aRInvoice.update.mockResolvedValue({});
      prisma.creditMemo.findFirstOrThrow.mockResolvedValue({
        id: 'memo-1', status: 'APPLIED',
      });

      const result = await service.apply(TENANT, 'memo-1', USER, { invoiceId: 'inv-1', amount: 100 });

      // Junction row created
      expect(prisma.creditMemoApplication.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          memoId:    'memo-1',
          invoiceId: 'inv-1',
          appliedById: USER,
        }),
      });

      // Invoice subledger updated: balance 250 → 150, paid 0 → 100, status stays PARTIALLY_PAID
      const invUpdateCall = prisma.aRInvoice.update.mock.calls[0][0];
      expect(Number(invUpdateCall.data.balanceAmount)).toBeCloseTo(150, 2);
      expect(Number(invUpdateCall.data.paidAmount)).toBeCloseTo(100, 2);
      expect(invUpdateCall.data.status).toBe('PARTIALLY_PAID');

      // Memo fully consumed → APPLIED
      const memoUpdateCall = prisma.creditMemo.update.mock.calls[0][0];
      expect(memoUpdateCall.data.status).toBe('APPLIED');
      expect(Number(memoUpdateCall.data.unappliedAmount)).toBeCloseTo(0, 2);

      expect(result).toMatchObject({ status: 'APPLIED' });
    });

    it('rejects amount over unapplied balance', async () => {
      prisma.creditMemo.findFirst.mockResolvedValue({
        id: 'memo-1', status: 'POSTED', customerId: 'cust-1',
        totalAmount: new Prisma.Decimal(50),
        unappliedAmount: new Prisma.Decimal(50),
      });
      await expect(service.apply(TENANT, 'memo-1', USER, { invoiceId: 'inv-1', amount: 100 }))
        .rejects.toThrow(/only 50.00 unapplied/);
    });
  });
});
