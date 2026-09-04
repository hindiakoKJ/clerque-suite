import { AccountingScheduler } from './accounting.scheduler';

/**
 * An accounting event that fails five times is money missing from the books,
 * and until now the only place that said so was a log line nobody at the shop
 * reads. The retry job now tells the tenant, once per count, where to look.
 */
describe('AccountingScheduler — stuck events reach a person', () => {
  function build(stuck: Array<{ tenantId: string; n: number; lastError?: string }>) {
    const created: any[] = [];
    const prisma: any = {
      accountingEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        groupBy: jest.fn().mockResolvedValue(stuck.map((s) => ({ tenantId: s.tenantId, _count: { _all: s.n } }))),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const s = stuck.find((x) => x.tenantId === where.tenantId);
          return Promise.resolve(s ? { id: 'ev-1', type: 'INVENTORY_ADJUSTMENT', lastError: s.lastError ?? null } : null);
        }),
      },
    };
    const journal: any = { processAllPending: jest.fn() };
    const notifications: any = {
      create: jest.fn().mockImplementation((args: any) => { created.push(args); return Promise.resolve({ id: 'n1' }); }),
    };
    const svc = new AccountingScheduler(prisma, journal, notifications);
    return { svc, created, prisma };
  }

  it('sends a warning to the tenant with the count, the reason and the place to fix it', async () => {
    const { svc, created } = build([{ tenantId: 't1', n: 3, lastError: 'Period 2026-08 is closed.' }]);
    await svc.retryFailedEvents();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      tenantId: 't1', userId: null, kind: 'WARNING', link: '/ledger/events', dedupeKey: 'accounting-stuck-3',
    });
    expect(created[0].title).toBe('3 stock entries could not be posted to the books');
    expect(created[0].body).toContain('Period 2026-08 is closed.');
    expect(created[0].body).toContain('The shelf is right; the books are missing it');
  });

  it('says it once, in the singular, for one event', async () => {
    const { svc, created } = build([{ tenantId: 't1', n: 1 }]);
    await svc.retryFailedEvents();
    expect(created[0].title).toBe('1 stock entry could not be posted to the books');
    expect(created[0].body).toMatch(/^A stock movement could not be recorded/);
  });

  it('re-queues only the events that still have retries left', async () => {
    const { svc, prisma } = build([]);
    await svc.retryFailedEvents();

    // Everything at or past the ceiling is left alone deliberately: it is
    // what the notification is about. Without this the ceiling could be
    // dropped and failed events would be retried forever in silence.
    const where = prisma.accountingEvent.updateMany.mock.calls[0][0].where;
    expect(where.status).toBe('FAILED');
    expect(where.retryCount).toEqual({ lt: 5 });
  });

  it('stays quiet when nothing is stuck', async () => {
    const { svc, created } = build([]);
    await svc.retryFailedEvents();
    expect(created).toEqual([]);
  });
});
