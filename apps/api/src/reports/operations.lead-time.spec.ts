import { OperationsService } from './operations.service';

/**
 * Lead time counts only orders a kitchen or bar actually marked ready.
 *
 * readyAt - paidAt is a kitchen time only when somebody at a station screen
 * bumped a line. Three kinds of order carry a readyAt nobody bumped:
 *   - an order with nothing to make, COMPLETED at the till with readyAt = paidAt,
 *     which read as an instant drink;
 *   - an order completed by refunding what was left to make, stamped at the refund;
 *   - an order released by the nightly job for orders stuck at "Preparing",
 *     stamped in the small hours -- a "wait" of half a day.
 * The bump now records who did it (OrderItem.readyById); lead time counts only
 * orders with at least one such line.
 */
describe('Lead time counts only orders a station marked ready', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const DAY    = '2026-09-12';
  const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+08:00`);

  const order = (o: { id: string; status?: string; paid: string; ready?: string | null; bumpedBy?: string | null; routed?: boolean; lineReady?: string | null; waited?: boolean }) => ({
    id: o.id,
    status: o.status ?? 'COMPLETED',
    paidAt: at(o.paid),
    readyAt: o.ready ? at(o.ready) : null,
    items: [{
      productId: `p-${o.id}`, productName: `Drink ${o.id}`, quantity: 1,
      readyById: o.bumpedBy ?? null,
      readyAt: o.lineReady ? at(o.lineReady) : (o.bumpedBy ? at(o.ready ?? o.paid) : null),
      usageOnReady: o.waited ?? false,
      product: { category: { stationId: o.routed === false ? null : 'st-bar', name: 'Coffee' } },
    }],
  });

  function build(orders: any[]) {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue(orders) },
      station: { findMany: jest.fn().mockResolvedValue([{ id: 'st-bar', name: 'Bar', kind: 'BAR' }]) },
    };
    return new OperationsService(prisma);
  }

  const BUMPED = order({ id: 'bumped', paid: '10:00', ready: '10:05', bumpedBy: 'barista-1' });

  it('asks the database who marked each line ready', async () => {
    const svc = build([]);
    await svc.getDailyLeadTime(TENANT, BRANCH, DAY);
    const query = (svc as any).prisma.order.findMany.mock.calls[0][0];
    expect(query.select.items.select.readyById).toBe(true);
  });

  it('leaves out counter-only, refund-completed and nightly-released orders', async () => {
    const report = await build([
      BUMPED,
      order({ id: 'counter', paid: '10:10', ready: '10:10', routed: false }),        // readyAt = paidAt at the till
      order({ id: 'refunded', paid: '10:20', ready: '14:00' }),                      // completed by the refund
      order({ id: 'nightly', paid: '11:00', ready: '23:59' }),                       // released by the job
      order({ id: 'making', status: 'PAID', paid: '11:30', ready: null }),
    ]).getDailyLeadTime(TENANT, BRANCH, DAY);

    expect(report.totalOrders).toBe(5);
    expect(report.inFlightCount).toBe(1);
    expect(report.completedCount).toBe(1);
    expect(report.avgSec).toBe(300);
    expect(report.p90Sec).toBe(300);
    expect(report.overTenMinCount).toBe(0);
    expect(report.byStation).toEqual([expect.objectContaining({ stationId: 'st-bar', orderCount: 1, avgSec: 300 })]);
    expect(report.byProduct.map((p) => p.productId)).toEqual(['p-bumped']);
    expect(report.byHour[10]).toEqual({ hour: 10, orderCount: 1, avgSec: 300 });
    expect(report.byHour[11].orderCount).toBe(0);
  });

  it('still times days before the bump recorded anyone, and never the overnight confirm', async () => {
    const report = await build([
      // Bumped last month: no bumper on record, but the line has its own ready time.
      order({ id: 'old', paid: '09:00', ready: '09:04', lineReady: '09:04' }),
      // Counted as made at 02:30 by the job: a line that waited, stamped, no bumper.
      order({ id: 'overnight', paid: '09:10', ready: '23:59', lineReady: '23:59', waited: true }),
    ]).getDailyLeadTime(TENANT, BRANCH, DAY);
    expect(report.completedCount).toBe(1);
    expect(report.avgSec).toBe(240);
  });

  describe('an order with a line the nightly job stamped', () => {
    // Two stations on one order. A line that waited and was never tapped is
    // stamped READY at 02:30 the next morning, with nobody recorded.
    const NIGHT = new Date('2026-09-13T02:30:00+08:00');
    const line = (l: { id: string; station: string; readyAt: Date | null; bumpedBy?: string }) => ({
      productId: `p-${l.id}`, productName: l.id, quantity: 1,
      readyById: l.bumpedBy ?? null,
      readyAt: l.readyAt,
      usageOnReady: true,
      product: { category: { stationId: l.station, name: l.station } },
    });

    it('is not timed when the job released it at that stamp, though a person bumped its other line', async () => {
      const report = await build([
        BUMPED,
        {
          id: 'latte-and-sandwich', status: 'COMPLETED', paidAt: at('10:00'), readyAt: NIGHT,   // released at the stamp
          items: [
            line({ id: 'latte', station: 'st-bar', readyAt: at('10:05'), bumpedBy: 'barista-1' }),
            line({ id: 'sandwich', station: 'st-kitchen', readyAt: NIGHT }),
          ],
        },
      ]).getDailyLeadTime(TENANT, BRANCH, DAY);

      expect(report.completedCount).toBe(1);
      expect(report.avgSec).toBe(300);
      expect(report.overTenMinCount).toBe(0);
      expect(report.byStation).toEqual([expect.objectContaining({ stationId: 'st-bar', orderCount: 1, avgSec: 300 })]);
      expect(report.byProduct.map((p) => p.productId)).toEqual(['p-bumped']);
      expect(report.byHour[10].orderCount).toBe(1);
    });

    it('is still timed when a bump completed it and the stamp came a night later, on a line refunded away while it waited', async () => {
      const report = await build([
        {
          id: 'latte-and-refunded-sandwich', status: 'COMPLETED', paidAt: at('10:00'), readyAt: at('10:05'),   // completed by the bump
          items: [
            line({ id: 'latte', station: 'st-bar', readyAt: at('10:05'), bumpedBy: 'barista-1' }),
            line({ id: 'sandwich', station: 'st-kitchen', readyAt: NIGHT }),
          ],
        },
      ]).getDailyLeadTime(TENANT, BRANCH, DAY);

      expect(report.completedCount).toBe(1);
      expect(report.avgSec).toBe(300);
    });
  });

  it('times every order a station bumped, as before', async () => {
    const report = await build([
      BUMPED,
      order({ id: 'slow', paid: '10:30', ready: '10:45', bumpedBy: 'barista-2' }),
    ]).getDailyLeadTime(TENANT, BRANCH, DAY);

    expect(report.completedCount).toBe(2);
    expect(report.avgSec).toBe(600);
    expect(report.overTenMinCount).toBe(1);
    expect(report.byStation[0].orderCount).toBe(2);
    expect(report.byHour[10].orderCount).toBe(2);
  });

  it('has no lead time to show when nothing was bumped, rather than a made-up one', async () => {
    const report = await build([
      order({ id: 'counter', paid: '10:10', ready: '10:10', routed: false }),
    ]).getDailyLeadTime(TENANT, BRANCH, DAY);

    expect(report.completedCount).toBe(0);
    expect(report.avgSec).toBeNull();
    expect(report.byStation).toEqual([]);
  });
});
