import { scrubBreadcrumb, scrubEvent } from './scrub';

/** What may leave for Sentry about a failed request. */
describe('Sentry scrubbing', () => {
  const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('an error on the tablet heartbeat carries no device token: not in the URL, the query, the headers or the cookies', () => {
    const event = scrubEvent({
      message: 'boom',
      request: {
        url: `https://api.clerque.cc/api/v1/display-pairing/whoami?token=${TOKEN}`,
        query_string: `token=${TOKEN}&branchId=b1`,
        headers: { 'x-device-token': TOKEN, authorization: 'Bearer secret.jwt.value', cookie: 'rt=abc', 'user-agent': 'Chrome' },
        cookies: { rt: 'abc' },
      },
    });
    const out = JSON.stringify(event);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('secret.jwt.value');
    expect(out).not.toContain('rt=abc');
    expect(event.request.url).toBe('https://api.clerque.cc/api/v1/display-pairing/whoami?token=[hidden]');
    expect(event.request.query_string).toBe('token=[hidden]&branchId=b1');
    expect(event.request.headers).toEqual({ 'x-device-token': '[hidden]', authorization: '[hidden]', cookie: '[hidden]', 'user-agent': 'Chrome' });
    expect(event.request).not.toHaveProperty('cookies');
    expect(event.message).toBe('boom');
  });

  it('a query string that is not a plain string is dropped rather than guessed at', () => {
    const event = scrubEvent({ request: { query_string: [['token', TOKEN]] } });
    expect(JSON.stringify(event)).not.toContain(TOKEN);
  });

  it('an event with no request is returned untouched', () => {
    const event = { message: 'cron failed', request: undefined };
    expect(scrubEvent(event)).toBe(event);
  });

  it('a breadcrumb for a Telegram Bot API call is dropped whole; its URL carries the bot token', () => {
    expect(scrubBreadcrumb({ category: 'fetch', data: { url: 'https://api.telegram.org/bot123456:AAHsecret/sendMessage', method: 'POST' } })).toBeNull();
  });

  it('other breadcrumbs keep everything but the credential in their URL', () => {
    const crumb = scrubBreadcrumb({ category: 'http', data: { url: `/api/v1/display-pairing/whoami?token=${TOKEN}`, method: 'GET', status_code: 200 } });
    expect(crumb?.data).toEqual({ url: '/api/v1/display-pairing/whoami?token=[hidden]', method: 'GET', status_code: 200 });
    const plain = { category: 'console', message: 'hello', data: undefined };
    expect(scrubBreadcrumb(plain)).toBe(plain);
  });
});
