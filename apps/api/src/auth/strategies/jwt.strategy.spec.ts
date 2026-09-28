import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

/** What a bearer token has to be to sign someone in. */
describe('JwtStrategy.validate', () => {
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret';
  const sessions: Record<string, any> = {
    'sess-live':    { status: 'ACTIVE',  userId: 'owner-1', user: { isActive: true } },
    'sess-revoked': { status: 'REVOKED', userId: 'owner-1', user: { isActive: true } },
    'sess-other':   { status: 'ACTIVE',  userId: 'someone-else', user: { isActive: true } },
    'sess-gone':    { status: 'ACTIVE',  userId: 'gone', user: { isActive: false } },
  };
  const prisma: any = {
    user: { findUnique: jest.fn(async ({ where }: any) => (where.id === 'gone' ? { id: 'gone', isActive: false } : { id: where.id, isActive: true })) },
    userSession: { findUnique: jest.fn(async ({ where }: any) => sessions[where.id] ?? null) },
  };
  const strategy = new JwtStrategy(prisma);
  const access = { sub: 'owner-1', tenantId: 't1', branchId: null, role: 'BUSINESS_OWNER', name: 'Anne', sid: 'sess-live' } as any;

  it('an access token for an active user signs in', async () => {
    await expect(strategy.validate(access)).resolves.toBe(access);
  });

  it('a 2FA challenge token does not, though it names the same owner', async () => {
    await expect(strategy.validate({ ...access, kind: '2fa-challenge' })).rejects.toThrow(UnauthorizedException);
  });

  it('a refresh token does not either', async () => {
    await expect(strategy.validate({ sub: 'owner-1', type: 'refresh' } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('a deactivated user does not', async () => {
    await expect(strategy.validate({ ...access, sub: 'gone', sid: 'sess-gone' })).rejects.toThrow(UnauthorizedException);
  });

  /*
    The token is only as alive as its session. Before this, "sign out
    everywhere" and the Console's tenant-wide revoke left every access token
    working for up to eight hours.
  */
  it('dies with its session: a revoked sid is refused at the next request', async () => {
    await expect(strategy.validate({ ...access, sid: 'sess-revoked' })).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate({ ...access, sid: 'sess-missing' })).rejects.toThrow(UnauthorizedException);
  });

  it('refuses a sid that belongs to somebody else\'s session', async () => {
    await expect(strategy.validate({ ...access, sid: 'sess-other' })).rejects.toThrow(UnauthorizedException);
  });

  it('honours a sid-less token only when it predates this build, so the deploy signs nobody out', async () => {
    const { sid: _drop, ...old } = access;
    const before = Math.floor((JwtStrategy.bootAt - 60_000) / 1000);
    const after  = Math.floor((JwtStrategy.bootAt + 60_000) / 1000);
    await expect(strategy.validate({ ...old, iat: before })).resolves.toMatchObject({ sub: 'owner-1' });
    await expect(strategy.validate({ ...old, iat: after })).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate({ ...old })).rejects.toThrow(UnauthorizedException);   // no iat at all: not one of ours
  });

  it('checks a super-admin token by user alone: the Console has no session row', async () => {
    const admin = { sub: 'admin-1', tenantId: null, branchId: null, role: 'SUPER_ADMIN', name: 'Console', isSuperAdmin: true } as any;
    await expect(strategy.validate(admin)).resolves.toBe(admin);
  });
});
