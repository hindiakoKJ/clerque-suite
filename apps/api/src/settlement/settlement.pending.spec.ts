/**
 * Settlement — GCash / Maya money on an order still at PAID counts.
 *
 * The sale entry debits 1031 Digital Wallet Receivable the moment the customer
 * pays. Settlement used to look at COMPLETED orders only, so an order the
 * kitchen or bar never bumped stayed out of "Awaiting settlement" for good and
 * the page sat below the books.
 */
import { SettlementService, SETTLEABLE_ORDER_STATUSES } from './settlement.service';

function build() {
  const aggregate = jest.fn().mockResolvedValue({ _sum: { amount: 400 }, _count: 2 });
  const findMany  = jest.fn().mockResolvedValue([]);
  const prisma: any = { orderPayment: { aggregate, findMany } };
  return { svc: new SettlementService(prisma), aggregate, findMany };
}

describe('Settlement counts PAID and COMPLETED orders', () => {
  it('the rule itself', () => {
    expect(SETTLEABLE_ORDER_STATUSES).toEqual(['PAID', 'COMPLETED']);
  });

  it('pending summary includes orders still at PAID', async () => {
    const { svc, aggregate } = build();
    const out = await svc.getPendingSummary('tenant-1', 'branch-1');

    expect(aggregate).toHaveBeenCalled();
    for (const [arg] of aggregate.mock.calls) {
      expect(arg.where.order.status).toEqual({ in: ['PAID', 'COMPLETED'] });
      expect(arg.where.order.tenantId).toBe('tenant-1');
      expect(arg.where.settlementItem).toBeNull();
    }
    expect(out[0]).toMatchObject({ pendingCount: 2, pendingAmount: 400 });
  });

  it('unmatched payments include PAID orders and filter on when the money came in', async () => {
    const { svc, findMany } = build();
    await svc.getUnmatchedPayments('tenant-1', 'branch-1', 'GCASH_PERSONAL' as never, '2026-09-01', '2026-09-30');

    const where = findMany.mock.calls[0][0].where;
    expect(where.order.status).toEqual({ in: ['PAID', 'COMPLETED'] });
    // A PAID order has no completedAt — a completedAt-only filter would drop it.
    expect(where.order.completedAt).toBeUndefined();
    expect(where.order.OR).toEqual([
      { paidAt: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') } },
      { paidAt: null, completedAt: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') } },
    ]);
  });

  it('no date range means no date filter at all', async () => {
    const { svc, findMany } = build();
    await svc.getUnmatchedPayments('tenant-1', 'branch-1', 'MAYA_PERSONAL' as never);
    expect(findMany.mock.calls[0][0].where.order.OR).toBeUndefined();
  });
});
