import pino from 'pino';
import { Writable } from 'stream';
import { REDACT_PATHS } from './redact-paths';

/** A credential must never reach the Railway log, whichever shape it is logged in. */
describe('structured log redaction', () => {
  function logLine(payload: Record<string, unknown>): string {
    let out = '';
    const sink = new Writable({ write(chunk, _enc, done) { out += String(chunk); done(); } });
    pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, sink).info(payload, 'probe');
    return out;
  }

  it('blanks a paired tablet\'s device token and the sign-in headers of a logged request', () => {
    const line = logLine({
      req: { headers: { 'x-device-token': 'DEVICE-SECRET-1', authorization: 'Bearer JWT-SECRET-2', cookie: 'rt=COOKIE-SECRET-3', 'user-agent': 'Chrome' } },
      headers: { 'x-device-token': 'DEVICE-SECRET-4' },
      deviceToken: 'DEVICE-SECRET-5',
      station: { deviceToken: 'DEVICE-SECRET-6' },
    });
    for (const secret of ['DEVICE-SECRET-1', 'JWT-SECRET-2', 'COOKIE-SECRET-3', 'DEVICE-SECRET-4', 'DEVICE-SECRET-5', 'DEVICE-SECRET-6']) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('Chrome');   // the rest of the request stays readable
  });

  it('still blanks passwords and tokens as before', () => {
    const line = logLine({ password: 'pw-1', user: { passwordHash: 'h-2' }, token: 't-3', body: { refreshToken: 'r-4' } });
    for (const secret of ['pw-1', 'h-2', 't-3', 'r-4']) expect(line).not.toContain(secret);
  });
});
