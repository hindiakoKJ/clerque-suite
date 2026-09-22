import { JwtService } from '@nestjs/jwt';
import { throttleTracker, verifiedUserId } from './throttle-tracker';

/**
 * Whose bucket a request counts against: a signed-in person's own, or the
 * caller's address. Never something the caller can pick for themselves.
 */
describe('rate-limit tracker', () => {
  const SECRET = 'a'.repeat(40);
  const jwt = new JwtService({});
  const access = (claims: object, secret = SECRET, expiresIn: number | string = '15m') =>
    jwt.sign({ sub: 'user-1', tenantId: 't1', role: 'CASHIER', ...claims }, { secret, expiresIn: expiresIn as never });
  const req = (over: { auth?: string; url?: string; ip?: string; device?: string } = {}) => ({
    ip: over.ip ?? '112.198.74.21',
    originalUrl: over.url ?? '/api/v1/orders?page=1',
    headers: {
      ...(over.auth ? { authorization: over.auth } : {}),
      ...(over.device ? { 'x-device-token': over.device } : {}),
    } as Record<string, string>,
  });

  const OLD = process.env.JWT_ACCESS_SECRET;
  beforeAll(() => { process.env.JWT_ACCESS_SECRET = SECRET; });
  afterAll(() => { process.env.JWT_ACCESS_SECRET = OLD; });

  it('a signed-in request is counted per person, so a till and the owner behind one router do not share a bucket', () => {
    const cashier = throttleTracker(req({ auth: `Bearer ${access({ sub: 'cashier-1' })}` }));
    const owner   = throttleTracker(req({ auth: `Bearer ${access({ sub: 'owner-1' })}` }));
    expect(cashier).toBe('user:cashier-1');
    expect(owner).toBe('user:owner-1');
  });

  it('no token: counted by address', () => {
    expect(throttleTracker(req())).toBe('ip:112.198.74.21');
  });

  it('a forged token cannot buy a fresh bucket', () => {
    const forged = access({ sub: 'anyone-i-like' }, 'b'.repeat(40));
    expect(throttleTracker(req({ auth: `Bearer ${forged}` }))).toBe('ip:112.198.74.21');
    // Unsigned ("alg: none") tokens are refused too.
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.`;
    expect(throttleTracker(req({ auth: `Bearer ${none}` }))).toBe('ip:112.198.74.21');
  });

  it('an expired token, a refresh token and a 2FA challenge are all counted by address', () => {
    expect(throttleTracker(req({ auth: `Bearer ${access({}, SECRET, -10)}` }))).toBe('ip:112.198.74.21');
    expect(throttleTracker(req({ auth: `Bearer ${access({ type: 'refresh' })}` }))).toBe('ip:112.198.74.21');
    expect(throttleTracker(req({ auth: `Bearer ${access({ kind: '2fa-challenge' })}` }))).toBe('ip:112.198.74.21');
  });

  it('sign-in routes are always counted by address, even with a genuine token attached', () => {
    const auth = `Bearer ${access({ sub: 'attacker-own-account' })}`;
    for (const url of ['/api/v1/auth/login', '/api/v1/auth/pin-login?x=1', '/api/v1/auth/forgot-password', '/api/v1/auth']) {
      expect(throttleTracker(req({ auth, url }))).toBe('ip:112.198.74.21');
    }
    // A route that merely starts with the same letters is not a sign-in route.
    expect(throttleTracker(req({ auth, url: '/api/v1/authors' }))).toBe('user:attacker-own-account');
  });

  it('a sign-in route in any letter case, or in absolute form, is still counted by address', () => {
    // Express matches routes case-insensitively: all of these reach AuthController.
    const auth = `Bearer ${access({ sub: 'attacker-own-account' })}`;
    for (const url of [
      '/api/v1/AUTH/pin-login', '/API/V1/auth/login', '/api/v1/Auth/forgot-password', '/Api/V1/aUtH',
      'http://api.clerque.test/api/v1/auth/login', 'HTTP://api.clerque.test/API/v1/Auth/pin-login?x=1',
    ]) {
      expect(throttleTracker(req({ auth, url }))).toBe('ip:112.198.74.21');
    }
    expect(throttleTracker(req({ auth, url: '/API/V1/Authors' }))).toBe('user:attacker-own-account');
  });

  it('a paired-tablet device token is a string the caller chose: counted by address', () => {
    const device = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(throttleTracker(req({ device }))).toBe('ip:112.198.74.21');
    expect(throttleTracker(req({ auth: `Bearer ${device}` }))).toBe('ip:112.198.74.21');
  });

  it('IPv6 callers are counted by /64', () => {
    expect(throttleTracker(req({ ip: '2001:4450:4a1b:9c00:1c2d:3e4f:5a6b:7c8d' }))).toBe('ip:2001:4450:4a1b:9c00::/64');
  });

  it('never throws, whatever it is handed', () => {
    expect(throttleTracker({} as never)).toBe('ip:unknown');
    expect(throttleTracker({ ip: '1.2.3.4', headers: { authorization: ['x', 'y'] as never } })).toBe('ip:1.2.3.4');
    expect(verifiedUserId(`Bearer ${access({})}`, undefined)).toBe(process.env.JWT_ACCESS_SECRET ? 'user-1' : null);
    expect(verifiedUserId(`Bearer ${access({})}`, '')).toBeNull();
    expect(verifiedUserId(`Bearer ${access({ sub: 42 })}`)).toBeNull();
  });

  it('verifies once per request: the three limit windows share the answer', () => {
    const r = req({ auth: `Bearer ${access({ sub: 'cashier-1' })}` });
    expect(throttleTracker(r)).toBe('user:cashier-1');
    r.headers.authorization = 'Bearer changed-after-the-fact';
    expect(throttleTracker(r)).toBe('user:cashier-1');
  });
});
