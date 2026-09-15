import { LINK_TTL_SECONDS, secretsMatch, signLinkCode, verifyLinkCode, webhookSecret } from './link-token';

/** The one-time code that ties a Telegram chat to one Clerque user. */
describe('Telegram link code', () => {
  const JWT = 'jwt-secret';
  const BOT = '123456:bot-token';
  const USER = 'cmt1abcdefghijklmnopqrstu';   // a cuid, 25 characters
  const NOW = 1_800_000_000;

  it('fits Telegram\'s start parameter: at most 64 characters of A-Z a-z 0-9 _ -', () => {
    const code = signLinkCode(USER, NOW, JWT, BOT);
    expect(code.length).toBeLessThanOrEqual(64);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('names the user it was made for', () => {
    expect(verifyLinkCode(signLinkCode(USER, NOW, JWT, BOT), NOW + 30, JWT, BOT)).toEqual({ ok: true, userId: USER, issuedAt: NOW });
  });

  it('expires after ten minutes, and refuses one dated in the future', () => {
    const code = signLinkCode(USER, NOW, JWT, BOT);
    expect(verifyLinkCode(code, NOW + LINK_TTL_SECONDS, JWT, BOT).ok).toBe(true);
    expect(verifyLinkCode(code, NOW + LINK_TTL_SECONDS + 1, JWT, BOT)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyLinkCode(code, NOW - 120, JWT, BOT)).toEqual({ ok: false, reason: 'expired' });
  });

  it('a code changed to point at another user is refused', () => {
    const code = signLinkCode(USER, NOW, JWT, BOT);
    const other = code.replace(USER, 'cmt1zzzzzzzzzzzzzzzzzzzzz');
    expect(verifyLinkCode(other, NOW, JWT, BOT)).toEqual({ ok: false, reason: 'bad-signature' });
    const later = code.replace(`_${NOW.toString(36)}_`, `_${(NOW + 500).toString(36)}_`);
    expect(verifyLinkCode(later, NOW + 500, JWT, BOT)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('a code from another server or another bot is worthless', () => {
    const code = signLinkCode(USER, NOW, JWT, BOT);
    expect(verifyLinkCode(code, NOW, 'other-jwt', BOT).ok).toBe(false);
    expect(verifyLinkCode(code, NOW, JWT, '999:other-bot').ok).toBe(false);
  });

  it('garbage is malformed, not a crash', () => {
    for (const junk of ['', '_', 'abc', 'a_b', 'a__sig', `${USER}_zz_`, `${USER}_!!_sig`, '___']) {
      expect(verifyLinkCode(junk, NOW, JWT, BOT).ok).toBe(false);
    }
  });

  it('the webhook secret is stable per bot and compared exactly', () => {
    const s = webhookSecret(JWT, BOT);
    expect(s).toMatch(/^[a-f0-9]{64}$/);
    expect(webhookSecret(JWT, BOT)).toBe(s);
    expect(webhookSecret(JWT, '999:other')).not.toBe(s);
    expect(secretsMatch(s, s)).toBe(true);
    expect(secretsMatch(s, s.slice(0, 63))).toBe(false);
    expect(secretsMatch(s, undefined)).toBe(false);
  });
});
