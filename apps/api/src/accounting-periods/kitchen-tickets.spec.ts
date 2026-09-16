import { manilaEndOfDay, ticketsHoldingMessage, ticketsHoldingPeriod } from './kitchen-tickets';

/**
 * What holds a period close: kitchen/bar tickets still waiting, and the cost
 * entries that belong to the period but have not posted.
 *
 * A waste entry (a made item voided or refunded) is dated to the day it was
 * created. The general queue check counts events created by the period's
 * endDate, which is 8 AM Manila of the last day -- so a latte refunded at
 * 8:55 PM on the 30th, still posting when the owner closed at 9 PM, failed to
 * post into the closed period for good.
 *
 * The events below run through a small matcher for the filter operators the
 * count uses. Any other operator throws, so a JSON-path "not" (which in
 * Postgres also drops rows lacking the key) cannot slip in unnoticed.
 */
describe('Kitchen tickets holding a period close', () => {
  const END = new Date('2026-09-30');            // stored as midnight UTC of the last day
  const THROUGH = manilaEndOfDay(END);
  const manila = (s: string) => new Date(`${s}+08:00`);

  type Event = { tenantId: string; type: string; status: string; createdAt: Date; payload: Record<string, unknown>; order: { paidAt: Date | null } | null };

  function matches(row: Record<string, any>, where: Record<string, any>): boolean {
    return Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Record<string, any>[]).some((w) => matches(row, w));
      if (key === 'order') return row.order != null && matches(row.order, cond);
      const value = row[key];
      if (cond instanceof Date || typeof cond !== 'object' || cond === null) return value === cond;
      return Object.entries(cond).every(([op, arg]) => {
        if (op === 'in') return (arg as unknown[]).includes(value);
        if (op === 'lte') return value != null && value.getTime() <= (arg as Date).getTime();
        if (op === 'path') return true;
        if (op === 'equals' && Array.isArray(cond.path)) return value?.[cond.path[0]] === arg;
        throw new Error(`matcher does not know "${op}" on ${key}`);
      });
    });
  }

  function db(events: Event[], lines: Array<{ quantity: number; refundedQty: number }> = []) {
    return {
      orderItem: { findMany: jest.fn().mockResolvedValue(lines) },
      accountingEvent: { count: jest.fn(async ({ where }: { where: Record<string, any> }) => events.filter((e) => matches(e, where)).length) },
    };
  }

  const event = (e: Partial<Event> & Pick<Event, 'type' | 'createdAt'>): Event => ({
    tenantId: 't1', status: 'PENDING', payload: {}, order: { paidAt: manila('2026-09-12T10:00:00') }, ...e,
  });
  const waste = (createdAt: Date, more: Partial<Event> = {}) =>
    event({ type: 'COGS_ADJUSTMENT', createdAt, payload: { kind: 'WASTE', source: 'REFUND' }, ...more });

  it('ends at 23:59:59.999 Manila on the last day, not 8 AM', () => {
    expect(THROUGH.toISOString()).toBe('2026-09-30T15:59:59.999Z');
  });

  it('holds the close for a waste entry from a refund on the last evening that is still posting', async () => {
    const d = db([waste(manila('2026-09-30T20:55:00'))]);
    await expect(ticketsHoldingPeriod(d as never, 't1', THROUGH)).resolves.toEqual({ waiting: 0, unposted: 1 });
  });

  it('counts waste by the day it was created, not by when the order was paid', async () => {
    const d = db([
      waste(manila('2026-09-30T20:55:00'), { status: 'FAILED', order: { paidAt: manila('2026-08-14T09:00:00') } }), // sold in August, refunded on the 30th
      waste(manila('2026-10-01T00:10:00'), { order: { paidAt: manila('2026-09-30T21:00:00') } }),                   // sold on the 30th, refunded in October
      waste(manila('2026-09-30T19:00:00'), { status: 'SYNCED' }),                                                   // already posted
      waste(manila('2026-09-30T19:00:00'), { tenantId: 't2' }),                                                     // another shop
    ]);
    await expect(ticketsHoldingPeriod(d as never, 't1', THROUGH)).resolves.toEqual({ waiting: 0, unposted: 1 });
  });

  it('still counts cost-of-goods entries by their sale, however late they were created', async () => {
    const soldLastEvening = { paidAt: manila('2026-09-30T21:00:00') };
    const d = db([
      event({ type: 'COGS', status: 'FAILED', createdAt: manila('2026-10-01T02:30:00'), order: soldLastEvening }),
      event({ type: 'COGS_ADJUSTMENT', createdAt: manila('2026-10-01T09:00:00'), payload: { kind: 'USAGE_RETURNED' }, order: soldLastEvening }),
      event({ type: 'COGS', createdAt: manila('2026-10-01T09:00:00'), order: { paidAt: manila('2026-10-01T08:00:00') } }), // sold in October
      event({ type: 'SALE', createdAt: manila('2026-09-30T20:00:00') }),                                               // the general queue check's
      event({ type: 'COGS_ADJUSTMENT', createdAt: manila('2026-09-30T20:00:00'), payload: {} }),                       // no kind at all
    ]);
    await expect(ticketsHoldingPeriod(d as never, 't1', THROUGH)).resolves.toEqual({ waiting: 0, unposted: 2 });
  });

  it('matches waste on the kind itself, with no sale date on it', async () => {
    const d = db([]);
    await ticketsHoldingPeriod(d as never, 't1', THROUGH);
    const where = d.accountingEvent.count.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ type: 'COGS_ADJUSTMENT', payload: { path: ['kind'], equals: 'WASTE' }, createdAt: { lte: THROUGH } });
  });

  it('still counts only lines with something left to make as waiting', async () => {
    const d = db([], [{ quantity: 1, refundedQty: 0 }, { quantity: 2, refundedQty: 2 }]);
    await expect(ticketsHoldingPeriod(d as never, 't1', THROUGH)).resolves.toEqual({ waiting: 1, unposted: 0 });
  });

  describe('the message', () => {
    it('names waste entries along with cost-of-goods entries', () => {
      expect(ticketsHoldingMessage('this period', { waiting: 0, unposted: 1 }))
        .toBe('1 cost-of-goods or waste entry from this period (kitchen/bar items marked ready, or made items voided or refunded) ' +
          'has not reached the books yet. They usually post within a minute — try again shortly, or review them under Ledger → Accounting Events.');
      expect(ticketsHoldingMessage('FY2026', { waiting: 0, unposted: 3 })).toMatch(/^3 cost-of-goods or waste entries from FY2026 .*have not reached/);
    });

    it('speaks of waiting items first, and says nothing when nothing holds the close', () => {
      expect(ticketsHoldingMessage('this period', { waiting: 2, unposted: 1 })).toMatch(/^2 kitchen\/bar items sold in this period are still waiting/);
      expect(ticketsHoldingMessage('this period', { waiting: 0, unposted: 0 })).toBeNull();
    });
  });
});
