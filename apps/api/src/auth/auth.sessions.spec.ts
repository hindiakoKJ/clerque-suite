import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService, refreshTokenSha } from './auth.service';

/**
 * A refresh token names ONE session.
 *
 * It used to be matched by looping bcrypt over every active session of the
 * user and taking the first hit, so "sign out" could close the wrong device,
 * and a copied token replayed after rotation was answered with a silent 401.
 * Now the digest finds its own row; a rotated token presented again within a
 * minute is the two-tab race and is refused; later than that it is a stolen
 * token and every session of that user is closed.
 */
describe('AuthService — sessions: exact refresh, reuse, logout', () => {
  const USER = { id: 'u1', tenantId: 't1', branchId: 'b1', role: 'CASHIER', name: 'Maria', isActive: true, customPermissions: [] as string[] };
  const DAY = 86_400_000;

  function build(rows: any[]) {
    const created: any[] = [];
    const prisma: any = {
      userSession: {
        findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.refreshTokenSha != null && r.refreshTokenSha === where.refreshTokenSha) ?? null),
        findMany:   jest.fn(async ({ where }: any) => rows.filter((r) =>
          r.userId === where.userId && r.status === where.status && (where.refreshTokenSha === null ? r.refreshTokenSha == null : true))),
        update:     jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const r of rows) if (r.userId === where.userId && r.status === where.status) { Object.assign(r, data); count++; }
          return { count };
        }),
        create:     jest.fn(async ({ data }: any) => { created.push(data); return { id: data.id }; }),
      },
      user:          { findUnique: jest.fn().mockResolvedValue(USER) },
      tenant:        { findUnique: jest.fn().mockResolvedValue({ name: 'Cafe', taxStatus: 'NON_VAT', planCode: 'CLERQUE', ledgerMode: 'SIMPLE', modulePos: true, moduleLedger: true, modulePayroll: false }) },
      userAppAccess: { findMany: jest.fn().mockResolvedValue([]) },
      loginLog:      { create: jest.fn().mockResolvedValue({}) },
    };
    const signed: any[] = [];
    const jwt: any = { sign: jest.fn((payload: any) => { signed.push(payload); return payload.type === 'refresh' ? 'new-refresh' : 'new-access'; }) };
    const svc = new AuthService(prisma, jwt, {} as any, {} as any);
    return { svc, prisma, rows, created, signed };
  }

  const session = (over: Record<string, unknown> = {}) => ({
    id: 's-live', userId: 'u1', status: 'ACTIVE',
    refreshTokenSha: refreshTokenSha('live-token'), refreshTokenHash: 'bcrypt-of-something-else',
    expiresAt: new Date(Date.now() + DAY), lastUsedAt: new Date(Date.now() - DAY),
    ...over,
  });
  const other = () => session({ id: 's-other', refreshTokenSha: refreshTokenSha('other-token') });

  it('rotates exactly the presented session and mints tokens that carry the new session id', async () => {
    const { svc, rows, created, signed } = build([session(), other()]);
    const out = await svc.refresh('u1', 'live-token');
    expect(out).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(rows[0].status).toBe('REVOKED');
    expect(rows[0].lastUsedAt.getTime()).toBeGreaterThan(Date.now() - 5_000);   // the rotation is timestamped
    expect(rows[1].status).toBe('ACTIVE');                                        // the other device is untouched
    const access = signed.find((p) => p.type !== 'refresh');
    expect(created[0]).toMatchObject({ id: access.sid, userId: 'u1', refreshTokenSha: refreshTokenSha('new-refresh') });
  });

  it('refuses a rotated token presented again within a minute, and closes nothing: that is two tabs racing', async () => {
    const { svc, rows, prisma } = build([session({ status: 'REVOKED', lastUsedAt: new Date(Date.now() - 5_000) }), other()]);
    await expect(svc.refresh('u1', 'live-token')).rejects.toThrow(UnauthorizedException);
    expect(rows[1].status).toBe('ACTIVE');
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('treats a rotated token presented again later as a copied token and closes every session of that user', async () => {
    const { svc, rows } = build([session({ status: 'REVOKED', lastUsedAt: new Date(Date.now() - 5 * 60_000) }), other()]);
    await expect(svc.refresh('u1', 'live-token')).rejects.toThrow(/closed everywhere/);
    expect(rows[1].status).toBe('REVOKED');
  });

  it("a token that names somebody else's session is simply invalid", async () => {
    const { svc, rows, prisma } = build([session({ userId: 'u2' }), other()]);
    await expect(svc.refresh('u1', 'live-token')).rejects.toThrow('Invalid refresh token');
    expect(rows[1].status).toBe('ACTIVE');
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('still matches a session from before the digest column by its bcrypt hash, until it expires', async () => {
    const { svc, rows } = build([session({ id: 's-old', refreshTokenSha: null, refreshTokenHash: bcrypt.hashSync('old-token', 4) })]);
    await expect(svc.refresh('u1', 'old-token')).resolves.toMatchObject({ accessToken: 'new-access' });
    expect(rows[0].status).toBe('REVOKED');
  });

  it('marks an expired session EXPIRED and refuses it', async () => {
    const { svc, rows } = build([session({ expiresAt: new Date(Date.now() - 1000) })]);
    await expect(svc.refresh('u1', 'live-token')).rejects.toThrow(/expired/i);
    expect(rows[0].status).toBe('EXPIRED');
  });

  it("logout closes exactly this device's session", async () => {
    const { svc, rows } = build([session(), other()]);
    await svc.logout('u1', 'live-token');
    expect(rows[0].status).toBe('REVOKED');
    expect(rows[1].status).toBe('ACTIVE');
  });

  it('logout with an unknown or already-closed token does nothing, and never closes the rest', async () => {
    const { svc, rows, prisma } = build([session({ status: 'REVOKED', lastUsedAt: new Date(Date.now() - 5 * 60_000) }), other()]);
    await expect(svc.logout('u1', 'live-token')).resolves.toBeUndefined();
    await expect(svc.logout('u1', 'never-issued')).resolves.toBeUndefined();
    expect(rows[1].status).toBe('ACTIVE');
    expect(prisma.userSession.update).not.toHaveBeenCalled();
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
  });
});
