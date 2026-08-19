import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Money formatting
//
// Single-currency per tenant (NOT an FX engine). The app sets the display
// currency once at login via setDisplayCurrency(user.currency); formatPeso
// (394 call sites, signature unchanged) reads it. Default is PHP so every
// existing PH tenant renders exactly as before.
// ---------------------------------------------------------------------------

const CURRENCY_LOCALES: Record<string, string> = {
  PHP: 'en-PH',
  USD: 'en-US',
  AUD: 'en-AU',
};

function localeForCurrency(currency: string): string {
  return CURRENCY_LOCALES[currency.toUpperCase()] ?? 'en';
}

let displayCurrency = 'PHP';

/** Set the tenant's display currency (ISO 4217, e.g. 'PHP', 'USD'). Called once at login. */
export function setDisplayCurrency(currency: string): void {
  displayCurrency = (currency || 'PHP').toUpperCase();
}

/** The currency formatPeso currently renders in. */
export function getDisplayCurrency(): string {
  return displayCurrency;
}

/**
 * Format an amount (MAJOR units) in the given currency. Locale is derived
 * from the currency when not supplied (PHP→en-PH, USD→en-US, AUD→en-AU, else 'en').
 */
export function formatMoney(amount: number | string, currency: string = 'PHP', locale?: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return moneyFormatter((currency || 'PHP').toUpperCase(), locale).format(num);
}

/** Currency symbol only (e.g. '₱', '$', 'A$') — for input labels like "Amount ($)". */
export function currencySymbol(currency: string = 'PHP'): string {
  const cur = (currency || 'PHP').toUpperCase();
  const part = moneyFormatter(cur).formatToParts(0).find((p) => p.type === 'currency');
  return part?.value ?? cur;
}

/**
 * Intl formatter for a currency. A malformed code on the tenant row (e.g. 'PH')
 * makes Intl throw RangeError — which would blank every money cell in the app —
 * so fall back to the PHP default instead of throwing.
 */
function moneyFormatter(cur: string, locale?: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale ?? localeForCurrency(cur), {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 2,
    });
  } catch {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
  }
}

export function formatPeso(amount: number | string): string {
  return formatMoney(amount, displayCurrency);
}

export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-PH', options ?? { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Download a file from an authenticated API endpoint.
 *
 * Pass either:
 *   - A relative API path like `/export/journal?from=...` — the API base
 *     URL (with `/api/v1` prefix) is auto-prepended. This is the
 *     recommended pattern.
 *   - An absolute URL like `https://...` — used as-is (rare).
 *
 * Reads the Bearer token from the persisted auth store in localStorage,
 * fetches the resource, and triggers a browser download.
 *
 * Historical bug context: half the codebase called this with raw paths
 * (`/export/foo`) which `fetch` interpreted as same-origin (the web
 * server, not the API → 404); the other half wrote
 * `${API_URL}/api/v1/export/foo` which doubled the `/api/v1` prefix
 * because `NEXT_PUBLIC_API_URL` already includes it (also → 404).
 * Both patterns now route correctly through this helper.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

function resolveApiUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;          // absolute — passthrough
  const path = input.startsWith('/') ? input : `/${input}`;
  // Strip a leading "/api/v1" if a caller still includes it manually so
  // the URL doesn't end up as "...api/v1/api/v1/..." (legacy callers).
  const cleaned = path.replace(/^\/api\/v\d+\//, '/');
  return API_URL.replace(/\/$/, '') + cleaned;
}

export async function downloadAuthFile(url: string, filename: string): Promise<void> {
  let token: string | null = null;
  try {
    const raw = localStorage.getItem('app-auth');
    if (raw) {
      const { state } = JSON.parse(raw) as { state: { accessToken: string | null } };
      token = state.accessToken;
    }
  } catch (err) {
    // Auth token could not be read from localStorage (parse error, SSR, or private browsing).
    // Log for debugging; the request will proceed without a token and receive a 401.
    console.error('[downloadAuthFile] could not read auth token from localStorage:', err);
  }

  const fullUrl = resolveApiUrl(url);
  const res = await fetch(fullUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href     = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}
