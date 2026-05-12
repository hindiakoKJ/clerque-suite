/**
 * VendorCreditNotesService — happy-path coverage:
 *   1. create()  — DRAFT note with computed totals + numbering
 *   2. post()    — moves DRAFT → POSTED, builds balanced GL (DR AP / CR Expense)
 *   3. apply()   — decreases bill balance, flips note → APPLIED when fully consumed
 */

import { VendorCreditNotesService } from './vendor-credit-notes.service';
import { Prisma } from '@prisma/client';

const TENANT = 'tenant-1';
const USER   = 'user-1';

function makePrismaMock() {
  return {
    vendor:               { findFirst: jest.fn() },
    account:              { findFirst: jest.fn(), count: jest.fn() },
    aPBill:               { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    vendorCreditNote:     { findFirst: jest.fn(), findFirstOrThrow: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    vendorCreditNoteLine: { deleteMany: jest.fn() },
    vendorCreditNoteApplication: { create: jest.fn(), aggregate: jest.fn(), deleteMany: jest.fn() },
    tenant:               { findUniqueOrThrow: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('VendorCreditNotesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let journal: { create: jest.Mock; reverse: jest.Mock };
  let periods: { assertDateIsOpen: jest.Mock };
  let numbering: { next: jest.Mock };
  let audit: { log: jest.Mock };
  let service: VendorCreditNotesService;

  beforeEach(() => {
    prisma    = makePrismaMock();
    journal   = { create: jest.fn(), reverse: jest.fn() };
    periods   = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    numbering = { next: jest.fn().mockResolvedValue('VCN-2026-0001') };
    audit     = { log: jest.fn().mockResolvedValue(undefined) };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    service = new VendorCreditNotesService(
      prisma as any, journal as any, periods as any, numbering as any, audit as any,
    );
  });

  describe('create — DRAFT note with computed totals', () => {
    it('computes subtotal/vatAmount/totalAmount and uses AP_CREDIT_NOTE sequence', async () => {
      prisma.vendor.findFirst.mockResolvedValue({ id: 'vend-1' });
      prisma.account.count.mockResolvedValue(1);
      prisma.vendorCreditNote.create.mockResolvedValue({
        id: 'note-1', noteNumber: 'VCN-2026-0001', status: 'DRAFT',
      });

      await service.create(TENANT, USER, {
        vendorId: 'vend-1',
        noteDate: '2026-05-12',
        lines: [
          { accountId: 'acc-exp', unitPrice: 50, taxAmount: 6, lineTotal: 56 },
        ],
      });

      expect(numbering.next).toHaveBeenCalledWith(TENANT, 'AP_CREDIT_NOTE', null, prisma);
      const callArgs = prisma.vendorCreditNote.create.mock.calls[0][0];
      expect(Number(callArgs.data.subtotal)).toBe(50);
      expect(Number(callArgs.data.vatAmount)).toBe(6);
      expect(Number(callArgs.data.totalAmount)).toBe(56);
      expect(Number(callArgs.data.unappliedAmount)).toBe(56);
      expect(callArgs.data.status).toBe('DRAFT');
    });
  });

  describe('post — DRAFT → POSTED with balanced JE', () => {
    it('builds DR AP / CR Expense and flips status atomically with SOD respected', async () => {
      prisma.vendorCreditNote.findFirst.mockResolvedValue({
        id: 'note-1',
        noteNumber: 'VCN-2026-0001',
        status: 'DRAFT',
        createdById: 'someone-else',
        noteDate:    new Date('2026-05-12'),
        postingDate: new Date('2026-05-12'),
        totalAmount: new Prisma.Decimal(56),
        vatAmount:   new Prisma.Decimal(6),
        vendor: { name: 'Acme Supplier' },
        lines: [
          { accountId: 'acc-exp', lineTotal: new Prisma.Decimal(56), taxAmount: new Prisma.Decimal(6), description: 'Returned shipment' },
        ],
      });
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({ taxStatus: 'VAT' });
      prisma.account.findFirst
        .mockResolvedValueOnce({ id: 'acc-ap' })     // AP
        .mockResolvedValueOnce({ id: 'acc-input-vat' }); // Input VAT
      journal.create.mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202605-0001' });
      prisma.vendorCreditNote.updateMany.mockResolvedValue({ count: 1 });
      prisma.vendorCreditNote.findFirstOrThrow.mockResolvedValue({
        id: 'note-1', status: 'POSTED', journalEntryId: 'je-1',
      });

      const result = await service.post(TENANT, 'note-1', USER, 'AP_ACCOUNTANT');

      expect(periods.assertDateIsOpen).toHaveBeenCalledWith(TENANT, expect.any(Date));
      expect(journal.create).toHaveBeenCalledTimes(1);
      const jeCall = journal.create.mock.calls[0];
      expect(jeCall[3]).toBe('AP');
      const jeLines = jeCall[1].lines as Array<{ debit?: number; credit?: number }>;
      const totalDebit  = jeLines.reduce((s, l) => s + (l.debit  ?? 0), 0);
      const totalCredit = jeLines.reduce((s, l) => s + (l.credit ?? 0), 0);
      expect(totalDebit).toBeCloseTo(56, 2);
      expect(totalCredit).toBeCloseTo(56, 2);

      // First line is the AP debit
      expect(jeLines[0]).toMatchObject({ accountId: 'acc-ap', debit: 56 });

      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'AP_BILL_POSTED', entityType: 'VendorCreditNote',
      }));
      expect(result).toMatchObject({ status: 'POSTED', journalEntryId: 'je-1' });
    });

    it('blocks AP_ACCOUNTANT from posting a note they created (SOD)', async () => {
      prisma.vendorCreditNote.findFirst.mockResolvedValue({
        id: 'note-1',
        noteNumber: 'VCN-2026-0001',
        status: 'DRAFT',
        createdById: USER, // same person trying to post
        noteDate: new Date('2026-05-12'),
        postingDate: new Date('2026-05-12'),
        totalAmount: new Prisma.Decimal(56),
        vatAmount:   new Prisma.Decimal(6),
        vendor: { name: 'Acme' },
        lines: [],
      });

      await expect(service.post(TENANT, 'note-1', USER, 'AP_ACCOUNTANT'))
        .rejects.toThrow(/cannot post a vendor credit note that you created/);
    });
  });

  describe('apply — bill balance drops, note flips to APPLIED when fully consumed', () => {
    it('decreases bill balance and marks note APPLIED', async () => {
      prisma.vendorCreditNote.findFirst.mockResolvedValue({
        id: 'note-1',
        noteNumber: 'VCN-2026-0001',
        status: 'POSTED',
        vendorId: 'vend-1',
        totalAmount: new Prisma.Decimal(56),
        unappliedAmount: new Prisma.Decimal(56),
      });
      prisma.aPBill.findFirst.mockResolvedValue({
        id: 'bill-1',
        billNumber: 'BILL-2026-0009',
        status: 'OPEN',
        balanceAmount: new Prisma.Decimal(200),
        totalAmount:   new Prisma.Decimal(200),
        paidAmount:    new Prisma.Decimal(0),
        whtAmount:     new Prisma.Decimal(0),
      });
      prisma.vendorCreditNoteApplication.create.mockResolvedValue({});
      prisma.vendorCreditNoteApplication.aggregate.mockResolvedValue({ _sum: { appliedAmount: new Prisma.Decimal(56) } });
      prisma.vendorCreditNote.update.mockResolvedValue({});
      prisma.aPBill.update.mockResolvedValue({});
      prisma.vendorCreditNote.findFirstOrThrow.mockResolvedValue({
        id: 'note-1', status: 'APPLIED',
      });

      const result = await service.apply(TENANT, 'note-1', USER, { billId: 'bill-1', amount: 56 });

      expect(prisma.vendorCreditNoteApplication.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ noteId: 'note-1', billId: 'bill-1', appliedById: USER }),
      });

      // Bill subledger: balance 200 → 144, paid 0 → 56, status PARTIALLY_PAID
      const billUpdateCall = prisma.aPBill.update.mock.calls[0][0];
      expect(Number(billUpdateCall.data.balanceAmount)).toBeCloseTo(144, 2);
      expect(Number(billUpdateCall.data.paidAmount)).toBeCloseTo(56, 2);
      expect(billUpdateCall.data.status).toBe('PARTIALLY_PAID');

      // Note fully consumed → APPLIED
      const noteUpdateCall = prisma.vendorCreditNote.update.mock.calls[0][0];
      expect(noteUpdateCall.data.status).toBe('APPLIED');
      expect(Number(noteUpdateCall.data.unappliedAmount)).toBeCloseTo(0, 2);

      expect(result).toMatchObject({ status: 'APPLIED' });
    });
  });
});
