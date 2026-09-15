import { StuckOrdersScheduler } from './stuck-orders.scheduler';
import { confirmLineUsage } from '../orders/usage-confirm';

jest.mock('../orders/usage-confirm', () => ({ confirmLineUsage: jest.fn(async () => true) }));

/**
 * 02:30: tickets from before today that nobody marked ready are counted as
 * made -- chosen by the line's own flag, order by order under its lock --
 * taken off the screen, and the owner is told how many.
 */
describe('StuckOrdersScheduler — the overnight confirm', () => {
  const NOW = new Date('2026-09-16T02:30:00+08:00');

  function build(lines: Array<{ id: string; orderId: string; tenantId: string }>) {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      orderItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma: any = {
      orderItem: {
        findMany: jest.fn(async ({ skip }: any) => (skip ? [] : lines.map((l) => ({ id: l.id, orderId: l.orderId, order: { tenantId: l.tenantId } })))),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    return { job: new StuckOrdersScheduler(prisma, notifications as any), prisma, tx, notifications };
  }

  beforeEach(() => jest.clearAllMocks());

  it('confirms each waiting line from before today, marks it ready, and tells each shop once', async () => {
    const { job, prisma, tx, notifications } = build([
      { id: 'a1', orderId: 'o1', tenantId: 'carolina' },
      { id: 'a2', orderId: 'o1', tenantId: 'carolina' },
      { id: 'b1', orderId: 'o2', tenantId: 'other' },
    ]);
    await expect(job.confirmUntapped(NOW)).resolves.toBe(3);

    const where = prisma.orderItem.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ usageOnReady: true, usagePostedAt: null, order: { status: { in: ['PAID', 'COMPLETED'] }, deletedAt: null } });
    expect(where.order.paidAt.lt.toISOString()).toBe('2026-09-15T16:00:00.000Z');   // midnight in Manila
    // By its own flag, never by today's station routing.
    expect(JSON.stringify(where)).not.toContain('station');

    expect(confirmLineUsage).toHaveBeenCalledWith(tx, 'carolina', 'a1', { actorId: null, trigger: 'NIGHTLY', now: NOW });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);   // one lock per order
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a1', 'a2'] }, prepStatus: 'PENDING' }, data: { prepStatus: 'READY', readyAt: NOW } });

    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'carolina', title: '2 kitchen/bar items counted as made overnight' }));
  });

  it('one order failing does not stop the others, and nothing confirmed tells nobody', async () => {
    (confirmLineUsage as jest.Mock).mockRejectedValueOnce(new Error('lock timeout')).mockResolvedValue(false);
    const { job, notifications } = build([
      { id: 'a1', orderId: 'o1', tenantId: 'carolina' },
      { id: 'b1', orderId: 'o2', tenantId: 'carolina' },
    ]);
    await expect(job.confirmUntapped(NOW)).resolves.toBe(0);
    expect(confirmLineUsage).toHaveBeenCalledTimes(2);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('the 02:30 run confirms first, then releases', async () => {
    const { job } = build([]);
    const order: string[] = [];
    jest.spyOn(job, 'confirmUntapped').mockImplementation(async () => { order.push('confirm'); return 0; });
    jest.spyOn(job, 'releaseStuckOrders').mockImplementation(async () => { order.push('release'); return { released: 0, stillWaiting: 0 }; });
    await job.nightly(NOW);
    expect(order).toEqual(['confirm', 'release']);
  });
});
