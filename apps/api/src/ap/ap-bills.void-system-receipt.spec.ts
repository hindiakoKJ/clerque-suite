import { BadRequestException } from '@nestjs/common';
import { APBillsService } from './ap-bills.service';

/**
 * A bill the stock receipt wrote for itself is not an ordinary payable.
 *
 * Its journal entry IS the delivery — it debits raw materials and credits
 * 2010 — so reversing it from the AP screen would take the value off the
 * books while the ingredients stay on the shelf, and nothing would put the
 * shelf right afterwards. Before the receipt's bill was linked to its entry
 * the void simply failed ("no posted JE to reverse"); linking it opened the
 * door, so the door is closed here on purpose.
 */
describe('APBillsService.void — a stock delivery is not voided from the AP screen', () => {
  const TENANT = 't1';

  function build(bill: Record<string, unknown> | null) {
    const reverse = jest.fn().mockResolvedValue({ id: 'je-rev' });
    const update = jest.fn().mockResolvedValue({ id: 'bill-1', status: 'VOIDED' });
    const prisma: any = {
      aPBill: { findFirst: jest.fn().mockResolvedValue(bill), update },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ aPBill: { update } })),
    };
    const svc = new APBillsService(
      prisma,
      { reverse } as any,                     // JournalService
      { assertDateIsOpen: jest.fn() } as any, // AccountingPeriodsService
      { next: jest.fn() } as any,             // NumberingService
      { log: jest.fn() } as any,              // AuditService
    );
    return { svc, reverse, update };
  }

  const base = {
    id: 'bill-1', tenantId: TENANT, billNumber: 'BILL-1', status: 'OPEN',
    journalEntryId: 'je-1', createdById: 'user-1',
  };

  it('refuses a bill the receive path wrote, and points at where to undo it', async () => {
    const { svc, reverse, update } = build({ ...base, createdById: 'system-receive' });
    await expect(svc.void(TENANT, 'bill-1', 'u1', 'wrong delivery'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.void(TENANT, 'bill-1', 'u1', 'wrong delivery'))
      .rejects.toThrow(/Undo the delivery under Stock/);
    expect(reverse).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('still voids an ordinary supplier bill', async () => {
    const { svc, reverse } = build(base);
    await expect(svc.void(TENANT, 'bill-1', 'u1', 'duplicate entry')).resolves.toMatchObject({ status: 'VOIDED' });
    expect(reverse).toHaveBeenCalledWith(TENANT, 'je-1', 'u1');
  });
});
