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

  function build(lines: Array<{ id: string; orderId: string; tenantId: string; left?: number }>) {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      orderItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    // Like the database: sorted by id, after the given id, a page at a time.
    const prisma: any = {
      orderItem: {
        findMany: jest.fn(async ({ where, take }: any) => lines
          .filter((l) => !where.id?.gt || l.id > where.id.gt)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, take)
          .map((l) => ({ id: l.id, orderId: l.orderId, quantity: 1, refundedQty: 1 - (l.left ?? 1), order: { tenantId: l.tenantId } }))),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    return { job: new StuckOrdersScheduler(prisma, notifications as any), prisma, tx, notifications };
  }

  beforeEach(() => { jest.clearAllMocks(); (confirmLineUsage as jest.Mock).mockResolvedValue(true); });

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

  it('pages past 200 lines without stepping over any', async () => {
    const lines = Array.from({ length: 450 }, (_, i) => ({ id: `l${String(i).padStart(3, '0')}`, orderId: `o${i}`, tenantId: 'carolina' }));
    const { job, prisma } = build(lines);
    await expect(job.confirmUntapped(NOW)).resolves.toBe(450);
    const confirmed = (confirmLineUsage as jest.Mock).mock.calls.map((c) => c[2]);
    expect(new Set(confirmed).size).toBe(450);
    expect(prisma.orderItem.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.orderItem.findMany.mock.calls[1][0].where.id).toEqual({ gt: 'l199' });
  });

  it('a ticket refunded in full while it waited is stamped done but not told to the owner as made', async () => {
    const { job, notifications } = build([
      { id: 'a1', orderId: 'o1', tenantId: 'carolina' },
      { id: 'a2', orderId: 'o1', tenantId: 'carolina', left: 0 },
    ]);
    await expect(job.confirmUntapped(NOW)).resolves.toBe(1);
    expect(confirmLineUsage).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: '1 kitchen/bar item counted as made overnight' }));
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
