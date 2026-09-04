import { NotificationsService } from './notifications.service';

/**
 * The idempotency this service promised never once fired.
 *
 * `create()` looked for an earlier notification whose BODY contained the
 * `dedupeKey` — but the key is never written into the body. Callers pass keys
 * like `low-ingredient-3-2-1` while the body reads "OUT: Beans · Low: Fresh
 * Milk". No row could match, so every caller that asked to be deduplicated
 * silently was not, and the alerts simply repeated. Nothing crashed, which is
 * why it survived.
 */
describe('NotificationsService.create — the dedupe that never fired', () => {
  const TENANT = 't1';

  function build(existing: any = null) {
    const created: any[] = [];
    const prisma: any = {
      notification: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(({ data }: any) => { created.push(data); return Promise.resolve({ id: 'n1', ...data }); }),
      },
    };
    return { svc: new NotificationsService(prisma), prisma, created };
  }

  const args = (over: Record<string, unknown> = {}) => ({
    tenantId: TENANT, userId: null,
    title: '3 ingredients out of stock',
    body:  'OUT: Beans, Milk, Sugar',
    link:  '/procure/requests',
    dedupeKey: 'low-ingredient-3-0-0',
    ...over,
  });

  it('suppresses an identical alert inside the hour', async () => {
    const { svc, created } = build({ id: 'already-there' });
    const res = await svc.create(args() as never);
    expect(res).toEqual({ id: 'already-there' });
    expect(created).toHaveLength(0);
  });

  it('no longer looks for the key inside the body, which could never match', async () => {
    /*
      The actual defect, pinned. The old query was
      `body: { contains: args.dedupeKey }` against a body that has never
      contained it.
    */
    const { svc, prisma } = build();
    await svc.create(args() as never);
    const where = prisma.notification.findFirst.mock.calls[0][0].where;
    expect(where.body).toBe('OUT: Beans, Milk, Sugar');
    expect(JSON.stringify(where)).not.toContain('contains');
  });

  it('still creates when the news has actually changed', async () => {
    // A different set of shortages is a different message, and must get through.
    const { svc, prisma, created } = build();
    await svc.create(args({ body: 'OUT: Beans · Low: Fresh Milk' }) as never);
    expect(created).toHaveLength(1);
    expect(prisma.notification.findFirst.mock.calls[0][0].where.body)
      .toBe('OUT: Beans · Low: Fresh Milk');
  });

  it('does not dedupe at all when no key is given', async () => {
    // Opting in is what asking for suppression means; everything else is news.
    const { svc, prisma, created } = build({ id: 'already-there' });
    await svc.create(args({ dedupeKey: undefined }) as never);
    expect(prisma.notification.findFirst).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });

  it('scopes the check to the tenant and the recipient', async () => {
    const { svc, prisma } = build();
    await svc.create(args({ userId: 'u9' }) as never);
    expect(prisma.notification.findFirst.mock.calls[0][0].where)
      .toMatchObject({ tenantId: TENANT, userId: 'u9' });
  });

  it('only looks back an hour', async () => {
    const { svc, prisma } = build();
    const before = Date.now();
    await svc.create(args() as never);
    const gte = prisma.notification.findFirst.mock.calls[0][0].where.createdAt.gte as Date;
    const minutes = (before - gte.getTime()) / 60000;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThan(61);
  });
});
