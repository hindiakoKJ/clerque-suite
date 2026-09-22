import { REDACTED, SECRET_HEADERS, redactUrl } from '../common/http/redact-url';

/**
 * What an error report may say about the request that failed.
 *
 * Sentry attaches the request (URL, query string, headers, cookies) and a
 * trail of breadcrumbs to every event. A paired tablet's credential rides
 * in a query string, a signed-in user's in the Authorization header, and
 * the Telegram bot token in every Bot API URL -- none of that belongs in a
 * third-party dashboard. These two functions run in `beforeSend` and
 * `beforeBreadcrumb` (see sentry.ts) and are pure, so the spec can hand
 * them plain objects.
 */

/** /bot<id>:<secret>/ -- the shape of a Telegram Bot API path. */
export const BOT_API_PATH = /\/bot\d+:[^/]+\//;

interface RequestLike {
  url?: string;
  query_string?: unknown;
  headers?: Record<string, string>;
  cookies?: unknown;
}

export function scrubEvent<T extends { request?: RequestLike }>(event: T): T {
  const req = event.request;
  if (!req) return event;
  if (typeof req.url === 'string') req.url = redactUrl(req.url);
  if (req.query_string !== undefined) {
    // A string is redacted by parameter name; any other shape is dropped
    // whole rather than guessed at.
    req.query_string = typeof req.query_string === 'string'
      ? redactUrl(`/?${req.query_string}`).slice(2)
      : undefined;
  }
  if (req.headers) {
    const clean: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      clean[name] = SECRET_HEADERS.includes(name.toLowerCase()) ? REDACTED : value;
    }
    req.headers = clean;
  }
  if (req.cookies !== undefined) delete req.cookies;
  return event;
}

/** null drops the breadcrumb; otherwise its URL is made safe to keep. */
export function scrubBreadcrumb<T extends { data?: Record<string, unknown> }>(crumb: T): T | null {
  const url = crumb.data?.url;
  if (typeof url !== 'string') return crumb;
  if (BOT_API_PATH.test(url)) return null;
  crumb.data = { ...crumb.data, url: redactUrl(url) };
  return crumb;
}
