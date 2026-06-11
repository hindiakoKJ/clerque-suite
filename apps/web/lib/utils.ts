import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPeso(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(num);
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
