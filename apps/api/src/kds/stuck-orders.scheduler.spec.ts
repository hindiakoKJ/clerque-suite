import { StuckOrdersScheduler } from './stuck-orders.scheduler';

/**
 * The nightly release of orders left at Preparing: only before today (Manila),
 * only with nothing left to make at a screen, dated to when they were paid.
 */
describe('StuckOrdersScheduler', () => {
  function build(orders: Array<{ id: string; paidAt: Date; waiting: Array<{ quantity: number; refundedQty: number }>; readyAt?: Date | null }>) {
    const state = new Map(orders.map((o) => [o.id, { ...o, status: 'PAID' as string, completedAt: null as Date | null, readyAtOrder: null as Date | null }]));
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: {
        findFirst: jest.fn(({ where }: any) => {
          const o = state.get(where.id);
          return Promise.resolve(o && o.status === where.status ? { paidAt: o.paidAt } : null);
        }),
        updateMany: jest.fn(({ where, data }: any) => {
          const o = state.get(where.id)!;
          if (o.status !== where.status) return Promise.resolve({ count: 0 });
          Object.assign(o, { status: data.status, completedAt: data.completedAt, readyAtOrder: data.readyAt });
          return Promise.resolve({ count: 1 });
        }),
      },
      orderItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(state.get(where.orderId)!.waiting)),
        aggregate: jest.fn(({ where }: any) => Promise.resolve({ _max: { readyAt: state.get(where.orderId)!.readyAt ?? null } })),
      },
    };
    const prisma: any = {
      order: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(
          [...state.values()].filter((o) => o.status === where.status && o.paidAt < where.paidAt.lt).map((o) => ({ id: o.id })),
        )),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    return { job: new StuckOrdersScheduler(prisma), state, prisma, tx };
  }

  it('releases yesterday\'s orders with nothing left to make, and leaves the rest', async () => {
    const paid = new Date('2026-09-14T13:00:00+08:00');
    const ready = new Date('2026-09-14T13:06:00+08:00');
    const { job, state, tx } = build([
      { id: 'refunded-away', paidAt: paid, waiting: [{ quantity: 1, refundedQty: 1 }], readyAt: ready },
      { id: 'still-waiting', paidAt: paid, waiting: [{ quantity: 2, refundedQty: 0 }] },
      // 12:30 AM today in Manila (still yesterday in UTC) -- today's, not touched.
      { id: 'today', paidAt: new Date('2026-09-15T00:30:00+08:00'), waiting: [] },
    ]);
    const res = await job.releaseStuckOrders(new Date('2026-09-15T02:30:00+08:00'));
    expect(res).toEqual({ released: 1, stillWaiting: 1 });
    expect(state.get('refunded-away')).toMatchObject({ status: 'COMPLETED', completedAt: paid, readyAtOrder: ready });
    expect(state.get('still-waiting')!.status).toBe('PAID');
    expect(state.get('today')!.status).toBe('PAID');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('an order a refund or bump finished in the meantime is left alone', async () => {
    const { job, state, tx } = build([{ id: 'o1', paidAt: new Date('2026-09-14T09:00:00+08:00'), waiting: [] }]);
    tx.order.findFirst.mockResolvedValueOnce(null);   // completed by the time the lock was taken
    const res = await job.releaseStuckOrders(new Date('2026-09-15T02:30:00+08:00'));
    expect(res).toEqual({ released: 0, stillWaiting: 0 });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(state.get('o1')!.status).toBe('PAID');
  });
});
