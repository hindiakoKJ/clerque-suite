import { AccountingScheduler } from './accounting.scheduler';

/**
 * A failed accounting event was a dead end.
 *
 * `processAllPending` only ever selects PENDING, so once an event flipped to
 * FAILED nothing re-offered it and nothing reported it. A sale whose journal
 * entry failed once — a period closed for the minute it took to post, an
 * account deactivated mid-shift — never reached the books at all, and the only
 * sign was that the trial balance was quietly short.
 *
 * That is the worst shape a bug can have: silent, permanent, and invisible in
 * a report that still foots.
 */
describe('AccountingScheduler.retryFailedEvents', () => {
  function build(opts: { stuck?: Array<{ tenantId: string; n: number }> } = {}) {
    const logs: string[] = [];
    const errors: string[] = [];
    const prisma: any = {
      accountingEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        groupBy: jest.fn().mockResolvedValue(
          (opts.stuck ?? []).map((s) => ({ tenantId: s.tenantId, _count: { _all: s.n } })),
        ),
        findFirst: jest.fn().mockResolvedValue({
          id: 'evt-9', type: 'SALE', lastError: 'Accounting period is closed.',
        }),
      },
    };
    const svc = new AccountingScheduler(prisma, {} as any);
    (svc as any).logger = {
      log:   (m: string) => logs.push(m),
      error: (m: string) => errors.push(m),
    };
    return { svc, prisma, logs, errors };
  }

  it('re-queues failed events so the normal processor picks them up', async () => {
    // Flipped back to PENDING rather than reprocessed here, so a retry takes
    // exactly the same path as a first attempt.
    const { svc, prisma } = build();
    await svc.retryFailedEvents();
    expect(prisma.accountingEvent.updateMany).toHaveBeenCalledWith({
      where: { status: 'FAILED', retryCount: { lt: 5 } },
      data:  { status: 'PENDING' },
    });
  });

  it('says how many it re-queued', async () => {
    const { svc, logs } = build();
    await svc.retryFailedEvents();
    expect(logs.join('\n')).toMatch(/Re-queued 3 failed accounting event/);
  });

  it('stops retrying after five attempts instead of looping forever', async () => {
    const { svc, prisma } = build();
    await svc.retryFailedEvents();
    const where = prisma.accountingEvent.updateMany.mock.calls[0][0].where;
    expect(where.retryCount).toEqual({ lt: 5 });
  });

  it('shouts about events that gave up, because that is money off the books', async () => {
    const { svc, errors } = build({ stuck: [{ tenantId: 't1', n: 4 }] });
    await svc.retryFailedEvents();
    expect(errors.join('\n')).toMatch(/Tenant t1 has 4 accounting event\(s\) stuck/);
    expect(errors.join('\n')).toMatch(/NOT on the books/);
  });

  it('names the latest failure, so the log says what to fix', async () => {
    const { svc, errors } = build({ stuck: [{ tenantId: 't1', n: 1 }] });
    await svc.retryFailedEvents();
    expect(errors.join('\n')).toMatch(/SALE evt-9 — Accounting period is closed\./);
  });

  it('says nothing when nothing is stuck', async () => {
    const { svc, errors } = build({ stuck: [] });
    await svc.retryFailedEvents();
    expect(errors).toHaveLength(0);
  });

  it('does not run two passes at once', async () => {
    const { svc, prisma } = build();
    let release: () => void = () => {};
    prisma.accountingEvent.updateMany.mockImplementation(
      () => new Promise((res) => { release = () => res({ count: 0 }); }),
    );
    const first = svc.retryFailedEvents();
    await svc.retryFailedEvents();               // must return immediately
    expect(prisma.accountingEvent.updateMany).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('survives a database error rather than killing the cron', async () => {
    const { svc, errors } = build();
    (svc as any).prisma = undefined;
    await expect(svc.retryFailedEvents()).resolves.toBeUndefined();
    expect(errors.join('\n')).toMatch(/Failed to retry accounting events/);
  });
});
