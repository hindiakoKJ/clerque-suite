/**
 * A request URL that is safe to write to a log.
 *
 * The paired kitchen/bar tablet and the customer display check in with
 * GET /display-pairing/whoami?token=<their credential> every 30 seconds, and
 * the request log wrote the whole URL -- so the live credential of every
 * paired screen sat in the Railway log in plain text. pino's redact list
 * never saw it: the URL was already one flat string.
 *
 * Secrets in a query string are blanked by NAME, and the two public pages
 * whose link IS the secret (a laundry claim stub, a loyalty stamp card) have
 * the token in their path blanked. Everything else is left readable, because
 * a log nobody can read is no use either.
 */
const SECRET_ENDING = /(token|secret|password|passwd|apikey|signature|credential)$/;
const SECRET_NAMES = new Set(['pin', 'otp', 'key', 'sig', 'auth', 'authorization', 'session', 'pwd', 'pass']);
const SECRET_PATH = /^(\/api\/v\d+\/(?:stub|stamps)\/)([^/?#]+)/;
export const REDACTED = '[hidden]';

/** By whole name or ending, never by substring: "barcode", "keyword" and "pinned" must stay readable. */
function isSecretParam(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_NAMES.has(n) || SECRET_ENDING.test(n);
}

export function redactUrl(url: string | null | undefined): string {
  if (!url) return '';
  const hashAt = url.indexOf('#');
  const noHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = noHash.indexOf('?');
  const path = (queryAt === -1 ? noHash : noHash.slice(0, queryAt)).replace(SECRET_PATH, `$1${REDACTED}`);
  if (queryAt === -1) return path;

  const query = noHash.slice(queryAt + 1).split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq === -1) return pair;
    const name = pair.slice(0, eq);
    let plain = name;
    try { plain = decodeURIComponent(name); } catch { /* keep it raw */ }
    return isSecretParam(plain) ? `${name}=${REDACTED}` : pair;
  }).join('&');
  return `${path}?${query}`;
}

/** Request headers that carry a credential. Never log or report their values. */
export const SECRET_HEADERS = ['authorization', 'cookie', 'x-device-token', 'x-api-key', 'x-telegram-bot-api-secret-token'];

export function redactHeaders<T extends Record<string, unknown>>(headers: T | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    out[name] = SECRET_HEADERS.includes(name.toLowerCase()) ? REDACTED : value;
  }
  return out;
}
