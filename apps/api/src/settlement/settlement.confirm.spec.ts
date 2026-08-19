/**
 * SettlementService.confirmSettlement — the ledger-posting half.
 *
 * Confirming a digital-wallet batch used to flip its status and post NOTHING,
 * so 1031 Digital Wallet Receivable grew forever with no path to the bank.
 * Now a CLEAN settlement queues a SETTLEMENT accounting event (DR 1020 / CR
 * 1031), atomically with the status change; a DISPUTED batch does not.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SettlementService } from './settlement.service';

function buildService(batch: any) {
  const eventCreate  = jest.fn().mockResolvedValue({});
  const batchUpdate  = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: batch.id, ...data }));

  const prisma: any = {
    settlementBatch: {
      // findOne() reads the batch with its items included.
      findFirst: jest.fn().mockResolvedValue(batch),
      update:    batchUpdate,
    },
    accountingEvent: { create: eventCreate },
    // The service wraps the update + event in a $transaction — pass through.
    $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
      cb({ settlementBatch: { update: batchUpdate }, accountingEvent: { create: eventCreate } })),
  };

  return { svc: new SettlementService(prisma), eventCreate, batchUpdate };
}

const baseBatch = {
  id: 'batch-1', tenantId: 'tenant-1', branchId: 'branch-1',
  method: 'GCASH_BUSINESS', status: 'PENDING',
  expectedAmount: new Prisma.Decimal(5000), items: [],
  notes: null,
};

const dto = (actual: number) => ({
  actualAmount: actual,
  settledAt:    '2026-07-26T10:00:00.000Z',
  bankReference: 'BDO-CR-99',
  notes:        undefined,
});

describe('confirmSettlement', () => {
  it('queues a SETTLEMENT event when the bank credit matches (SETTLED)', async () => {
    const { svc, eventCreate, batchUpdate } = buildService({ ...baseBatch });

    await svc.confirmSettlement('tenant-1', 'batch-1', 'owner-1', dto(5000));

    expect(batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SETTLED' }) }),
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          type:     'SETTLEMENT',
          status:   'PENDING',
          payload:  expect.objectContaining({
            batchId: 'batch-1', method: 'GCASH_BUSINESS', expectedAmount: 5000,
          }),
        }),
      }),
    );
  });

  it('does NOT post when the bank credit differs beyond a centavo (DISPUTED)', async () => {
    // e.g. a gateway fee deducted the money — resolved by hand, not auto-posted.
    const { svc, eventCreate, batchUpdate } = buildService({ ...baseBatch });

    await svc.confirmSettlement('tenant-1', 'batch-1', 'owner-1', dto(4850));

    expect(batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DISPUTED' }) }),
    );
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('tolerates a one-centavo rounding difference as SETTLED and posts', async () => {
    const { svc, eventCreate } = buildService({ ...baseBatch });
    await svc.confirmSettlement('tenant-1', 'batch-1', 'owner-1', dto(5000.01));
    expect(eventCreate).toHaveBeenCalled();
  });

  it('refuses to re-confirm an already-settled batch (single-shot per batch)', async () => {
    const { svc, eventCreate } = buildService({ ...baseBatch, status: 'SETTLED' });
    await expect(
      svc.confirmSettlement('tenant-1', 'batch-1', 'owner-1', dto(5000)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventCreate).not.toHaveBeenCalled();
  });
});
