import { lockoutClearedRow, recentFailedLogins } from './lockout';

/**
 * login_logs cannot be deleted from (an audit trigger refuses it), so an admin
 * reset or unlock writes a marker row and the lockout counts only failures
 * after it. The fake applies the same filters the database would.
 */
describe('lockout', () => {
  const NOW = new Date('2026-09-21T07:00:00Z');
  const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000);
  type Row = { userId: string; success: boolean; reason?: string | null; createdAt: Date };

  function db(rows: Row[]) {
    const match = (r: Row, where: any) =>
      r.userId === where.userId
      && (where.success === undefined || r.success === where.success)
      && (!where.reason?.in || where.reason.in.includes(r.reason))
      && (!where.createdAt?.gte || r.createdAt >= where.createdAt.gte)
      && (!where.createdAt?.gt || r.createdAt > where.createdAt.gt);
    return {
      loginLog: {
        findFirst: jest.fn(async ({ where }: any) =>
          rows.filter((r) => match(r, where)).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null),
        count: jest.fn(async ({ where }: any) => rows.filter((r) => match(r, where)).length),
      },
    } as any;
  }

  const fail = (minAgo: number): Row => ({ userId: 'u1', success: false, createdAt: at(minAgo) });

  it('counts failures in the last 15 minutes', async () => {
    const d = db([fail(1), fail(2), fail(3), fail(20)]);
    await expect(recentFailedLogins(d, 'u1', NOW)).resolves.toBe(3);
  });

  it('an admin reset or unlock wipes the slate: only failures after it count', async () => {
    const d = db([fail(10), fail(9), fail(8), fail(7), fail(6),
      { userId: 'u1', success: true, reason: 'ADMIN_PASSWORD_RESET', createdAt: at(5) }, fail(2)]);
    await expect(recentFailedLogins(d, 'u1', NOW)).resolves.toBe(1);
    const unlocked = db([fail(4), fail(3), { userId: 'u1', success: true, reason: 'ADMIN_UNLOCK', createdAt: at(2) }]);
    await expect(recentFailedLogins(unlocked, 'u1', NOW)).resolves.toBe(0);
  });

  it('an ordinary successful sign-in does not clear failures, as before', async () => {
    const d = db([fail(5), fail(4), { userId: 'u1', success: true, reason: null, createdAt: at(3) }, fail(1)]);
    await expect(recentFailedLogins(d, 'u1', NOW)).resolves.toBe(3);
  });

  it('the marker row is a success with the admin reason, never a failure', () => {
    expect(lockoutClearedRow({ id: 'u1', email: 'a@b.c', tenantId: 't1' }, 'ADMIN_UNLOCK'))
      .toEqual({ userId: 'u1', tenantId: 't1', email: 'a@b.c', success: true, reason: 'ADMIN_UNLOCK' });
  });
});
