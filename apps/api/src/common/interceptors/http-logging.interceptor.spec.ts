import { Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { HttpLoggingInterceptor } from './http-logging.interceptor';

/** The request log must never carry a credential. */
describe('HttpLoggingInterceptor', () => {
  const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  function run(url: string, outcome: 'ok' | 'fail' = 'ok', headers: Record<string, string> = {}) {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((m: unknown) => { lines.push(String(m)); });
    }
    const req = { method: 'GET', url, originalUrl: url, headers, user: { tenantId: 't1' } };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ statusCode: 200 }) }) };
    const next = { handle: () => (outcome === 'ok' ? of({ fine: true }) : throwError(() => ({ status: 400 }))) };
    return lastValueFrom(new HttpLoggingInterceptor().intercept(ctx, next)).catch(() => undefined).then(() => lines);
  }

  afterEach(() => jest.restoreAllMocks());

  it('logs the tablet heartbeat without its device token', async () => {
    const lines = await run(`/api/v1/display-pairing/whoami?token=${TOKEN}`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('/api/v1/display-pairing/whoami?token=[hidden]');
    expect(lines[0]).toContain('tenant:t1');
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('a failed request is logged without the token too', async () => {
    const lines = await run(`/api/v1/display-pairing/whoami?token=${TOKEN}`, 'fail');
    expect(lines[0]).toContain('400');
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('never writes a header value: X-Device-Token and Authorization stay out of the log', async () => {
    const lines = await run('/api/v1/kds/stations/s1/queue?branchId=b1', 'ok', { 'x-device-token': TOKEN, authorization: 'Bearer secret.jwt.value' });
    expect(lines[0]).toContain('/api/v1/kds/stations/s1/queue?branchId=b1');
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain('secret.jwt.value');
  });

  it('stays quiet for health checks', async () => {
    expect(await run('/api/v1/health')).toEqual([]);
  });
});
