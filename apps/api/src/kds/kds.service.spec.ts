import { KdsService } from './kds.service';

/**
 * The kitchen and bar screen's ticket life: what can be bumped, when an order
 * stops waiting, what serve and un-bump do. The fake database honours the
 * filters the service sends -- station screen, refunds, order status -- so a
 * dropped condition fails here.
 */
describe('KdsService', () => {
  const TENANT = 't1';
  const SCREEN = { hasKds: true, isActive: true };
  const PRINT_ONLY = { hasKds: false, isActive: true };

  type Line = { id: string; orderId: string; prepStatus: string; readyAt: Date | null; servedAt?: Date | null; quantity: number; refundedQty: number; station: typeof SCREEN | null };
  function build(lines: Line[], orderStatus = 'PAID') {
    const order = { id: 'o1', tenantId: TENANT, status: orderStatus, readyAt: null as Date | null, completedAt: null as Date | null };
    const rows = lines.map((l) => ({ ...l }));
    const view = (l: Line) => ({ ...l, order: { status: order.status }, product: { category: l.station ? { stationId: 's1', station: l.station } : null } });
    const matches = (l: Line, where: any) => {
      if (where.id && l.id !== where.id) return false;
      if (where.orderId && l.orderId !== where.orderId) return false;
      if (where.order?.tenantId && order.tenantId !== where.order.tenantId) return false;
      if (where.prepStatus && l.prepStatus !== where.prepStatus) return false;
      if (where.product?.category?.station) {
        const want = where.product.category.station;
        if (!l.station || l.station.hasKds !== want.hasKds || l.station.isActive !== want.isActive) return false;
      }
      return true;
    };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      orderItem: {
        findFirst: jest.fn(({ where }: any) => Promise.resolve(rows.filter((l) => matches(l, where)).map(view)[0] ?? null)),
        findMany: jest.fn(({ where }: any) => Promise.resolve(rows.filter((l) => matches(l, where)).map(view))),
        updateMany: jest.fn(({ where, data }: any) => {
          const hit = rows.filter((l) => matches(l, where));
          hit.forEach((l) => Object.assign(l, data));
          return Promise.resolve({ count: hit.length });
        }),
        update: jest.fn(({ where, data }: any) => {
          const l = rows.find((x) => x.id === where.id)!;
          Object.assign(l, data);
          return Promise.resolve(view(l));
        }),
      },
      order: {
        updateMany: jest.fn(({ where, data }: any) => {
          if (where.id !== order.id || where.status !== order.status) return Promise.resolve({ count: 0 });
          Object.assign(order, data);
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const prisma: any = { ...tx, $transaction: jest.fn((fn: any) => fn(tx)) };
    return { svc: new KdsService(prisma), rows, order, tx };
  }
  const line = (over: Partial<Line>): Line => ({ id: 'l1', orderId: 'o1', prepStatus: 'PENDING', readyAt: null, quantity: 1, refundedQty: 0, station: SCREEN, ...over });

  it('the last line waiting at a screen completes the order; a line nobody can bump does not hold it', async () => {
    const { svc, order } = build([
      line({ id: 'latte' }),
      // A pastry routed to a station without a screen, and a bottled drink routed nowhere: both stay PENDING forever.
      line({ id: 'croissant', station: PRINT_ONLY }),
      line({ id: 'water', station: null }),
    ]);
    await svc.bumpReady(TENANT, 'latte');
    expect(order).toMatchObject({ status: 'COMPLETED' });
    expect(order.readyAt).toBeInstanceOf(Date);
  });

  it('a fully refunded line is not made: it cannot be bumped and does not hold the order', async () => {
    const { svc, order } = build([line({ id: 'latte' }), line({ id: 'cake', quantity: 2, refundedQty: 2 })]);
    await expect(svc.bumpReady(TENANT, 'cake')).rejects.toThrow('This item was refunded. There is nothing to make.');
    await svc.bumpReady(TENANT, 'latte');
    expect(order.status).toBe('COMPLETED');
  });

  it('a voided order\'s line cannot be bumped or un-bumped', async () => {
    const { svc } = build([line({ id: 'latte' })], 'VOIDED');
    await expect(svc.bumpReady(TENANT, 'latte')).rejects.toThrow('This order was voided. There is nothing to make.');
    await expect(svc.unbump(TENANT, 'latte')).rejects.toThrow('This order was voided. There is nothing to un-bump.');
  });

  it('two tablets bumping the same line: one flip, the second is a no-op', async () => {
    const { svc, rows, tx } = build([line({ id: 'latte' }), line({ id: 'pasta' })]);
    // The second tablet read PENDING too, but the first one's write landed first.
    const readFirst = tx.orderItem.findFirst.getMockImplementation();
    tx.orderItem.findFirst
      .mockImplementationOnce((args: any) => readFirst(args))   // which order to lock
      .mockImplementationOnce((args: any) => readFirst(args).then((r: any) => {
        rows[0].prepStatus = 'READY';   // the other tablet
        return r;
      }));
    const res = await svc.bumpReady(TENANT, 'latte');
    expect(res).toMatchObject({ id: 'latte', prepStatus: 'READY' });
    const flips = tx.orderItem.updateMany.mock.calls.filter((c: any) => c[0].where.prepStatus === 'PENDING');
    expect(flips).toHaveLength(1);
    expect(flips[0][0].where).toEqual({ id: 'latte', prepStatus: 'PENDING' });
  });

  it('served without a bump goes through the bump, so the order completes', async () => {
    const { svc, rows, order } = build([line({ id: 'latte' })]);
    const res = await svc.markServed(TENANT, 'latte');
    expect(res).toMatchObject({ prepStatus: 'SERVED' });
    expect(rows[0].readyAt).toBeInstanceOf(Date);
    expect(order.status).toBe('COMPLETED');
  });

  it('bump, serve and un-bump take the order\'s lock before reading it', async () => {
    const { svc, tx } = build([line({ id: 'latte' }), line({ id: 'pasta', prepStatus: 'READY', readyAt: new Date() })]);
    await svc.bumpReady(TENANT, 'latte');
    await svc.unbump(TENANT, 'pasta');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['o1']);
    // The lock comes before the read that decides anything.
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.orderItem.findFirst.mock.invocationCallOrder[1]);
  });

  it('a fully refunded line cannot be un-bumped: back at PENDING it would hold the order with nothing to make', async () => {
    const { svc, order } = build([line({ id: 'cake', prepStatus: 'READY', readyAt: new Date(), quantity: 1, refundedQty: 1 })], 'COMPLETED');
    await expect(svc.unbump(TENANT, 'cake')).rejects.toThrow('This item was refunded. There is nothing to un-bump.');
    expect(order.status).toBe('COMPLETED');
  });

  it('un-bumping a line that was never ready does not reopen the order', async () => {
    // Completed at the till while the screen was off; the line never got its bump.
    const { svc, order } = build([line({ id: 'latte', prepStatus: 'PENDING' })], 'COMPLETED');
    await svc.unbump(TENANT, 'latte');
    expect(order.status).toBe('COMPLETED');
  });

  it('un-bump reopens the order only for a line the order waited on', async () => {
    const screen = build([line({ id: 'latte', prepStatus: 'READY', readyAt: new Date() })], 'COMPLETED');
    await screen.svc.unbump(TENANT, 'latte');
    expect(screen.order.status).toBe('PAID');
    const counter = build([line({ id: 'water', prepStatus: 'READY', readyAt: new Date(), station: PRINT_ONLY })], 'COMPLETED');
    await counter.svc.unbump(TENANT, 'water');
    expect(counter.order.status).toBe('COMPLETED');
  });
});

describe('KdsService — the station queue', () => {
  it('leaves out fully refunded lines and shows what is left to make', async () => {
    const at = new Date(Date.now() - 60_000);
    const item = (id: string, quantity: number, refundedQty: number) => ({
      id, orderId: 'o1', productName: id, quantity, refundedQty, notes: null, prepStatus: 'PENDING', readyAt: null,
      order: { orderNumber: 'ORD-1', paidAt: at, completedAt: null, branchId: 'b1' }, modifiers: [],
    });
    const prisma: any = {
      station: { findFirst: jest.fn().mockResolvedValue({ id: 's1', name: 'Bar', hasKds: true }) },
      orderItem: { findMany: jest.fn().mockResolvedValue([item('latte', 3, 1), item('mocha', 2, 2)]) },
    };
    const rows = await new KdsService(prisma).listStationQueue('t1', 's1');
    expect(rows.map((r) => [r.productName, r.quantity])).toEqual([['latte', 2]]);
    expect(prisma.orderItem.findMany.mock.calls[0][0].where.order).toEqual({ tenantId: 't1', status: { in: ['PAID', 'COMPLETED'] } });
  });
});
