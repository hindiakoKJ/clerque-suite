/**
 * SettlementService.create — a new batch holds its payments.
 *
 * The Settlement screen creates a batch from a method and two dates and then
 * confirms the bank credit; it has no step that adds payments one by one. A
 * batch created empty expected ₱0, so every real credit came out DISPUTED and
 * never posted. Creating the batch now takes every unsettled payment of that
 * method, branch and period, and sets what the bank should pay.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SettlementService, settlementWindow } from './settlement.service';

function buildService(payments: Array<{ id: string; amount: Prisma.Decimal }>) {
  const findMany = jest.fn().mockResolvedValue(payments);
  const batchCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'batch-1', ...data }));
  const itemsCreate = jest.fn().mockResolvedValue({ count: payments.length });
  const tx = {
    orderPayment: { findMany },
    settlementBatch: { create: batchCreate },
    settlementItem: { createMany: itemsCreate },
  };
  const prisma: any = { $transaction: jest.fn(async (cb: (t: any) => Promise<unknown>) => cb(tx)) };
  return { svc: new SettlementService(prisma), findMany, batchCreate, itemsCreate };
}

const dto = { branchId: 'branch-1', method: 'GCASH_PERSONAL' as const, periodStart: '2026-09-29', periodEnd: '2026-09-29' };

describe('creating a settlement batch', () => {
  it('takes the unsettled payments of its method, branch and days, and expects their total', async () => {
    const { svc, findMany, batchCreate, itemsCreate } = buildService([
      { id: 'p1', amount: new Prisma.Decimal('130.00') },
      { id: 'p2', amount: new Prisma.Decimal('457.50') },
    ]);

    const batch: any = await svc.create('tenant-1', 'owner-1', dto as any);

    const where = findMany.mock.calls[0][0].where;
    expect(where.method).toBe('GCASH_PERSONAL');
    expect(where.settlementItem).toBeNull();
    expect(where.order).toEqual(expect.objectContaining({ tenantId: 'tenant-1', branchId: 'branch-1' }));
    // The whole Manila day of the 29th: 00:00+08:00 up to (not including) the 30th.
    expect(where.order.OR[0].paidAt).toEqual({ gte: new Date('2026-09-28T16:00:00.000Z'), lt: new Date('2026-09-29T16:00:00.000Z') });
    expect(Number(batchCreate.mock.calls[0][0].data.expectedAmount)).toBe(587.5);
    expect(batch.status).toBe('PENDING');
    expect(itemsCreate).toHaveBeenCalledWith({
      data: [
        { settlementBatchId: 'batch-1', orderPaymentId: 'p1', amount: new Prisma.Decimal('130.00') },
        { settlementBatchId: 'batch-1', orderPaymentId: 'p2', amount: new Prisma.Decimal('457.50') },
      ],
    });
  });

  it('refuses a period with nothing waiting, instead of an empty batch', async () => {
    const { svc, batchCreate } = buildService([]);
    await expect(svc.create('tenant-1', 'owner-1', dto as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(batchCreate).not.toHaveBeenCalled();
  });

  it('refuses cash and card, which do not settle through a wallet', async () => {
    const { svc } = buildService([]);
    await expect(svc.create('tenant-1', 'owner-1', { ...dto, method: 'CASH' } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create('tenant-1', 'owner-1', { ...dto, method: 'CARD' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('settlementWindow', () => {
  it('reads plain dates as whole Manila days, the end day included', () => {
    const w = settlementWindow('2026-09-01', '2026-09-30');
    expect(w.start.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-30T16:00:00.000Z');
  });
  it('refuses a period that ends before it starts', () => {
    expect(() => settlementWindow('2026-09-30', '2026-09-01')).toThrow(BadRequestException);
  });
});
