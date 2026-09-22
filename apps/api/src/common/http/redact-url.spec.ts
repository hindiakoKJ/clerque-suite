import { REDACTED, redactHeaders, redactUrl } from './redact-url';

/** What may be written to a log line. */
describe('redactUrl', () => {
  const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('hides the paired tablet\'s credential in the whoami heartbeat', () => {
    const out = redactUrl(`/api/v1/display-pairing/whoami?token=${TOKEN}`);
    expect(out).toBe(`/api/v1/display-pairing/whoami?token=${REDACTED}`);
    expect(out).not.toContain(TOKEN);
  });

  it('hides every credential-shaped parameter, whatever the spelling, and keeps the rest', () => {
    const out = redactUrl(`/api/v1/x?branchId=b1&deviceToken=${TOKEN}&access_token=zzz&PIN=1234&api_key=k&page=2&refreshToken=r`);
    expect(out).toBe(`/api/v1/x?branchId=b1&deviceToken=${REDACTED}&access_token=${REDACTED}&PIN=${REDACTED}&api_key=${REDACTED}&page=2&refreshToken=${REDACTED}`);
  });

  it('matches whole names, so ordinary filters stay readable', () => {
    const url = '/api/v1/products?barcode=4800016644504&keyword=latte&pinned=true&design=2&author=kj&status=PAID&code=WELCOME10';
    expect(redactUrl(url)).toBe(url);
  });

  it('hides the token in the two public pages whose link is the secret', () => {
    expect(redactUrl('/api/v1/stub/Zk3_9xQ')).toBe(`/api/v1/stub/${REDACTED}`);
    expect(redactUrl('/api/v1/stamps/Zk3_9xQ?lang=en')).toBe(`/api/v1/stamps/${REDACTED}?lang=en`);
    expect(redactUrl('/api/v1/orders/ord_123')).toBe('/api/v1/orders/ord_123');
  });

  it('copes with odd input', () => {
    expect(redactUrl(undefined)).toBe('');
    expect(redactUrl('/api/v1/x?')).toBe('/api/v1/x?');
    expect(redactUrl('/api/v1/x?flag&token=abc#frag')).toBe(`/api/v1/x?flag&token=${REDACTED}`);
    expect(redactUrl('/api/v1/x?%E0%A4%A=1&token=abc')).toBe(`/api/v1/x?%E0%A4%A=1&token=${REDACTED}`);
    expect(redactUrl('/api/v1/x?to%6Ben=abc')).toBe(`/api/v1/x?to%6Ben=${REDACTED}`);
  });
});

describe('redactHeaders', () => {
  it('hides credentials and keeps the rest', () => {
    expect(redactHeaders({ Authorization: 'Bearer x', 'x-device-token': 'abc', cookie: 'a=b', 'user-agent': 'Chrome' })).toEqual({
      Authorization: REDACTED, 'x-device-token': REDACTED, cookie: REDACTED, 'user-agent': 'Chrome',
    });
    expect(redactHeaders(undefined)).toEqual({});
  });
});
