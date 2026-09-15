import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * The one-time code that links a Telegram chat to one Clerque user.
 *
 * It rides in the bot's start link (t.me/<bot>?start=<code>), which Telegram
 * limits to 64 characters of A-Z a-z 0-9 _ -. So it is stateless and short:
 * the user's id, when it was issued, and a signature over both. Nothing is
 * stored until the code is used.
 *
 * Only the signed-in user can get a code for themselves (the route takes the
 * id from their session), so a code names exactly one person in one shop. It
 * expires after LINK_TTL_SECONDS, and it is single-use: TelegramLinksService
 * refuses a code issued before the user's current link was made.
 */

export const LINK_TTL_SECONDS = 10 * 60;

/** The HMAC key: bound to this deployment's JWT secret and this bot, so a code from another bot or server is worthless. */
function key(jwtSecret: string, botToken: string): Buffer {
  return createHash('sha256').update(`telegram-link|${jwtSecret}|${botToken}`).digest();
}

function signature(k: Buffer, userId: string, issued: string): string {
  return createHmac('sha256', k).update(`tg-link:${userId}:${issued}`).digest('base64url').slice(0, 22);
}

export function signLinkCode(userId: string, nowSeconds: number, jwtSecret: string, botToken: string): string {
  if (!/^[a-z0-9]+$/i.test(userId)) throw new Error('Unexpected user id format for a Telegram link code.');
  const issued = Math.floor(nowSeconds).toString(36);
  const code = `${userId}_${issued}_${signature(key(jwtSecret, botToken), userId, issued)}`;
  if (code.length > 64) throw new Error('Telegram link code is longer than the 64 characters Telegram allows.');
  return code;
}

export type LinkCodeCheck =
  | { ok: true; userId: string; issuedAt: number }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

export function verifyLinkCode(code: string, nowSeconds: number, jwtSecret: string, botToken: string): LinkCodeCheck {
  // The signature is last and base64url may itself contain "_", so split on the first two only.
  const a = code.indexOf('_');
  const b = a < 0 ? -1 : code.indexOf('_', a + 1);
  if (a <= 0 || b <= a + 1 || b === code.length - 1) return { ok: false, reason: 'malformed' };
  const userId = code.slice(0, a);
  const issued = code.slice(a + 1, b);
  const sig = code.slice(b + 1);
  if (!/^[a-z0-9]+$/i.test(userId) || !/^[0-9a-z]+$/.test(issued)) return { ok: false, reason: 'malformed' };

  const want = Buffer.from(signature(key(jwtSecret, botToken), userId, issued));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'bad-signature' };

  const issuedAt = parseInt(issued, 36);
  // A code from the future is as suspect as an old one; allow a minute of clock drift.
  if (!Number.isFinite(issuedAt) || nowSeconds - issuedAt > LINK_TTL_SECONDS || issuedAt - nowSeconds > 60) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, userId, issuedAt };
}

/** The secret Telegram echoes on every webhook call, so nobody else can post fake updates. */
export function webhookSecret(jwtSecret: string, botToken: string): string {
  return createHash('sha256').update(`telegram-webhook|${jwtSecret}|${botToken}`).digest('hex');
}

export function secretsMatch(expected: string, given: string | undefined | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
