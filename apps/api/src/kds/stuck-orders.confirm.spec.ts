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

  function build(
    lines: Array<{ id: string; orderId: string; tenantId: string; left?: number }>,
    /** Each shop's active owners and managers. */
    bosses: Record<string, string[]> = { carolina: ['owner-1', 'manager-1'], other: ['owner-2'] },
  ) {
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
      user: { findMany: jest.fn(async ({ where }: any) => (bosses[where.tenantId] ?? []).map((id) => ({ id }))) },
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

    // One each to the people who can open Orders and void or refund -- never to the whole shop.
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'carolina', isActive: true, role: { in: ['BUSINESS_OWNER', 'BRANCH_MANAGER'] } }, select: { id: true },
    });
    expect(notifications.create).toHaveBeenCalledTimes(3);
    for (const userId of ['owner-1', 'manager-1']) {
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'carolina', userId, link: '/pos/orders', title: '2 kitchen/bar items counted as made overnight',
      }));
    }
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'other', userId: 'owner-2' }));
    expect(notifications.create.mock.calls.every((c: any[]) => c[0].userId != null)).toBe(true);
  });

  it('a cook is never sent a link to Orders: with no owner or manager to name, everyone is told with no link', async () => {
    const { job, notifications } = build([{ id: 'a1', orderId: 'o1', tenantId: 'carolina' }], {});
    await expect(job.confirmUntapped(NOW)).resolves.toBe(1);
    expect(notifications.create).toHaveBeenCalledTimes(1);
    const sent = notifications.create.mock.calls[0][0];
    expect(sent).toMatchObject({ tenantId: 'carolina', userId: null, title: '1 kitchen/bar item counted as made overnight' });
    expect(sent.link).toBeUndefined();
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

  it('the 02:30 run confirms, clears the at-sale tickets, then releases', async () => {
    const { job } = build([]);
    const order: string[] = [];
    jest.spyOn(job, 'confirmUntapped').mockImplementation(async () => { order.push('confirm'); return 2; });
    jest.spyOn(job, 'clearAtSaleTickets').mockImplementation(async () => { order.push('clear'); return 4; });
    jest.spyOn(job, 'releaseStuckOrders').mockImplementation(async () => { order.push('release'); return { released: 4, stillWaiting: 0 }; });
    await expect(job.nightly(NOW)).resolves.toEqual({ confirmed: 2, cleared: 4, released: 4, stillWaiting: 0 });
    expect(order).toEqual(['confirm', 'clear', 'release']);
  });
});

/**
 * 02:30: a ticket that took its stock at the sale (before the ready-tap rule,
 * replayed from the offline queue, or rung while deduction was paused) and
 * that nobody tapped is taken off the screen -- nothing else.
 */
describe('StuckOrdersScheduler — clearing tickets whose stock was taken at the sale', () => {
  const NOW = new Date('2026-09-22T02:30:00+08:00');
  const MIDNIGHT = new Date('2026-09-22T00:00:00+08:00');
  const YESTERDAY = new Date('2026-09-21T15:00:00+08:00');

  type Line = {
    id: string; orderId?: string; orderStatus: string; paidAt: Date; usageOnReady: boolean; prepStatus: string;
    usagePostedAt?: Date | null; deletedAt?: Date | null; onAScreen?: boolean; readyAt?: Date | null;
  };

  /** Like the database: the scheduler's filter applied to each line. */
  function matches(l: Line, where: any): boolean {
    if (where.id?.gt && !(l.id > where.id.gt)) return false;
    if (where.id?.in && !where.id.in.includes(l.id)) return false;
    if (where.usageOnReady !== undefined && l.usageOnReady !== where.usageOnReady) return false;
    if ('usagePostedAt' in where && (l.usagePostedAt ?? null) !== where.usagePostedAt) return false;
    if (where.prepStatus !== undefined && l.prepStatus !== where.prepStatus) return false;
    if (where.product?.category?.station?.hasKds === true && l.onAScreen === false) return false;
    const o = where.order;
    if (o?.status?.in && !o.status.in.includes(l.orderStatus)) return false;
    if (o && 'deletedAt' in o && (l.deletedAt ?? null) !== o.deletedAt) return false;
    if (o?.paidAt?.lt && !(l.paidAt < o.paidAt.lt)) return false;
    return true;
  }

  function build(list: Line[]) {
    const lines = new Map(list.map((l) => [l.id, l]));
    const updateMany = jest.fn(async ({ where, data }: any) => {
      const hit = [...lines.values()].filter((l) => matches(l, where));
      for (const l of hit) Object.assign(l, data);
      return { count: hit.length };
    });
    // Stock, cost and journal: none of these may be reached.
    const books = () => ({
      rawMaterial:       { update: jest.fn(), updateMany: jest.fn() },
      inventoryMovement: { create: jest.fn(), createMany: jest.fn() },
      accountingEvent:   { create: jest.fn() },
    });
    const tx: any = { $queryRaw: jest.fn().mockResolvedValue([]), orderItem: { updateMany }, ...books() };
    // Sorted by id, after the given id, a page at a time.
    const prisma: any = {
      orderItem: {
        findMany: jest.fn(async ({ where, take }: any) => [...lines.values()]
          .filter((l) => matches(l, where))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, take)
          .map((l) => ({ id: l.id, orderId: l.orderId ?? l.id, quantity: 1, refundedQty: 0, order: { tenantId: 'carolina' } }))),
        updateMany,
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
      ...books(),
    };
    const untouched = (db: any) => {
      for (const m of [db.rawMaterial.update, db.rawMaterial.updateMany, db.inventoryMovement.create, db.inventoryMovement.createMany, db.accountingEvent.create]) {
        expect(m).not.toHaveBeenCalled();
      }
    };
    return { job: new StuckOrdersScheduler(prisma), prisma, tx, lines, untouched };
  }

  beforeEach(() => { jest.clearAllMocks(); (confirmLineUsage as jest.Mock).mockResolvedValue(true); });

  it('clears an old at-sale ticket, touching no stock and no cost', async () => {
    const { job, prisma, tx, lines, untouched } = build([
      { id: 'sep01-wings',     orderStatus: 'PAID', paidAt: new Date('2026-09-01T19:39:12+08:00'), usageOnReady: false, prepStatus: 'PENDING' },
      { id: 'sep14-americano', orderStatus: 'PAID', paidAt: new Date('2026-09-14T12:13:01+08:00'), usageOnReady: false, prepStatus: 'PENDING' },
    ]);
    await expect(job.clearAtSaleTickets(NOW)).resolves.toBe(2);

    expect(lines.get('sep01-wings')!.prepStatus).toBe('READY');
    expect(lines.get('sep14-americano')!.prepStatus).toBe('READY');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);   // one lock per order
    // Status only. No readyAt: the lead-time report would read it as a person's tap at 02:30.
    const { data, where } = tx.orderItem.updateMany.mock.calls[0][0];
    expect(data).toEqual({ prepStatus: 'READY' });
    expect(where).toMatchObject({
      id: { in: ['sep01-wings'] }, usageOnReady: false, prepStatus: 'PENDING',
      product: { category: { station: { hasKds: true } } },
      order: { status: { in: ['PAID', 'COMPLETED'] }, deletedAt: null },
    });
    expect(where.order.paidAt.lt.toISOString()).toBe(MIDNIGHT.toISOString());
    expect(lines.get('sep01-wings')!.readyAt).toBeUndefined();

    expect(confirmLineUsage).not.toHaveBeenCalled();
    untouched(prisma);
    untouched(tx);
  });

  it("leaves today's ticket, a voided or deleted order, and a till-only line alone", async () => {
    const { job, lines } = build([
      // 12:30 AM today in Manila (still yesterday in UTC): today's, on the screen as it should be.
      { id: 'today',   orderStatus: 'PAID',      paidAt: new Date('2026-09-22T00:30:00+08:00'), usageOnReady: false, prepStatus: 'PENDING' },
      { id: 'voided',  orderStatus: 'VOIDED',    paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'PENDING' },
      { id: 'deleted', orderStatus: 'PAID',      paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'PENDING', deletedAt: YESTERDAY },
      { id: 'till',    orderStatus: 'COMPLETED', paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'PENDING', onAScreen: false },
      { id: 'old',     orderStatus: 'COMPLETED', paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'PENDING' },
    ]);
    await expect(job.clearAtSaleTickets(NOW)).resolves.toBe(1);
    expect(lines.get('old')!.prepStatus).toBe('READY');
    for (const id of ['today', 'voided', 'deleted', 'till']) expect(lines.get(id)!.prepStatus).toBe('PENDING');
  });

  it('a waiting line is still confirmed by the first step; the clear takes only the at-sale one', async () => {
    const bumpedAt = new Date('2026-09-21T15:04:00+08:00');
    const { job, tx, lines } = build([
      { id: 'at-sale', orderId: 'o1', orderStatus: 'PAID', paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'PENDING' },
      { id: 'waiting', orderId: 'o1', orderStatus: 'PAID', paidAt: YESTERDAY, usageOnReady: true,  prepStatus: 'PENDING', usagePostedAt: null },
      { id: 'bumped',  orderId: 'o2', orderStatus: 'COMPLETED', paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'READY', readyAt: bumpedAt },
    ]);
    jest.spyOn(job, 'releaseStuckOrders').mockResolvedValue({ released: 1, stillWaiting: 0 });

    await expect(job.nightly(NOW)).resolves.toEqual({ confirmed: 1, cleared: 1, released: 1, stillWaiting: 0 });
    // The waiting line: through the confirm (stock and cost), stamped by it.
    expect(confirmLineUsage).toHaveBeenCalledTimes(1);
    expect(confirmLineUsage).toHaveBeenCalledWith(tx, 'carolina', 'waiting', { actorId: null, trigger: 'NIGHTLY', now: NOW });
    expect(lines.get('waiting')).toMatchObject({ prepStatus: 'READY', readyAt: NOW });
    // The at-sale line: only off the screen.
    expect(lines.get('at-sale')!.prepStatus).toBe('READY');
    expect(lines.get('at-sale')!.readyAt).toBeUndefined();
    // Already bumped: as it was.
    expect(lines.get('bumped')).toMatchObject({ prepStatus: 'READY', readyAt: bumpedAt });
  });

  it('a line served between the read and the lock is not written over', async () => {
    const { job, prisma, lines } = build([
      { id: 'a1', orderStatus: 'PAID', paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'PENDING' },
    ]);
    const read = prisma.orderItem.findMany.getMockImplementation();
    prisma.orderItem.findMany.mockImplementationOnce(async (args: any) => {
      const page = await read(args);
      lines.get('a1')!.prepStatus = 'SERVED';   // the bar served it a moment ago
      return page;
    });
    await expect(job.clearAtSaleTickets(NOW)).resolves.toBe(0);
    expect(lines.get('a1')!.prepStatus).toBe('SERVED');
  });

  it('pages past 200 lines by id, never cursor and skip, without stepping over any', async () => {
    const all = Array.from({ length: 450 }, (_, i) => ({
      id: `l${String(i).padStart(3, '0')}`, orderStatus: 'PAID', paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'PENDING',
    }));
    const { job, prisma, lines } = build(all);
    await expect(job.clearAtSaleTickets(NOW)).resolves.toBe(450);
    expect([...lines.values()].every((l) => l.prepStatus === 'READY')).toBe(true);
    expect(prisma.orderItem.findMany).toHaveBeenCalledTimes(3);
    const calls = prisma.orderItem.findMany.mock.calls.map((c: any[]) => c[0]);
    expect(calls[0].where.id).toBeUndefined();
    expect(calls[1].where.id).toEqual({ gt: 'l199' });
    expect(calls[2].where.id).toEqual({ gt: 'l399' });
    for (const c of calls) {
      expect(c).not.toHaveProperty('skip');
      expect(c).not.toHaveProperty('cursor');
    }
  });

  it('one order failing does not stop the others', async () => {
    const { job, prisma, lines } = build([
      { id: 'a1', orderStatus: 'PAID', paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'PENDING' },
      { id: 'b1', orderStatus: 'PAID', paidAt: YESTERDAY, usageOnReady: false, prepStatus: 'PENDING' },
    ]);
    prisma.$transaction.mockRejectedValueOnce(new Error('lock timeout'));
    await expect(job.clearAtSaleTickets(NOW)).resolves.toBe(1);
    expect(lines.get('a1')!.prepStatus).toBe('PENDING');
    expect(lines.get('b1')!.prepStatus).toBe('READY');
  });
});
