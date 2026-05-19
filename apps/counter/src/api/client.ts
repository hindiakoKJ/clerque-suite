/**
 * Clerque Counter — API client
 * Lightweight fetch wrapper over the Cloud API. Reads baseUrl from
 * `Constants.expoConfig.extra.apiBaseUrl`, attaches the JWT (from SecureStore
 * via `setAuthToken`) on every request, and throws typed errors so callers
 * can branch on `status` / `code` rather than parsing strings.
 *
 * Auto-refresh: when an authenticated request returns 401 and we have a
 * refresh token, swap it for a fresh access token via /auth/refresh and
 * retry the original request ONCE. If the refresh itself fails the caller
 * sees the original 401 and AuthProvider's signOut path takes over.
 */

import Constants from 'expo-constants';

export interface ApiError {
  status: number;
  code: string;
  message: string;
}

export class ApiHttpError extends Error implements ApiError {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
    this.code = code;
  }
}

let authToken: string | null = null;
let refreshTokenValue: string | null = null;
/** Set by AuthProvider on boot — receives the new tokens after a successful
 *  /auth/refresh so SecureStore + React state stay in sync. */
let onTokensRefreshed: ((tokens: { accessToken: string; refreshToken: string }) => void) | null = null;
/** Called when /auth/refresh fails (refresh token revoked / expired) so the
 *  app can drop into the sign-in screen. */
let onAuthExpired: (() => void) | null = null;

/** In-flight refresh promise — multiple parallel 401s should share ONE
 *  refresh call, not stampede /auth/refresh. */
let inflightRefresh: Promise<string | null> | null = null;

export function setAuthToken(jwt: string | null): void {
  authToken = jwt;
}

export function setRefreshToken(token: string | null): void {
  refreshTokenValue = token;
}

export function setAuthCallbacks(cbs: {
  onTokensRefreshed?: (tokens: { accessToken: string; refreshToken: string }) => void;
  onAuthExpired?: () => void;
}): void {
  onTokensRefreshed = cbs.onTokensRefreshed ?? null;
  onAuthExpired = cbs.onAuthExpired ?? null;
}

function getBaseUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
  const url = extra.apiBaseUrl;
  if (!url) throw new ApiHttpError(0, 'CONFIG', 'apiBaseUrl missing from expo config');
  // The Cloud API uses `setGlobalPrefix('api/v1')` — every route lives
  // under /api/v1/*. Strip a trailing slash from the configured base
  // and append the prefix once. Endpoint paths passed to request()
  // should NOT include /api/v1 themselves.
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  /** Extra request headers (e.g. `Idempotency-Key`). */
  headers?: Record<string, string>;
  /** Internal flag — set true on the retried request after a 401 → refresh
   *  loop so we don't recurse forever if /auth/refresh's own 401 lies. */
  _retried?: boolean;
  /** Set true on the /auth/refresh call itself so 401s there short-circuit
   *  straight to onAuthExpired without trying to refresh again. */
  _isRefresh?: boolean;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshTokenValue) return null;
  // Coalesce concurrent refreshes — one network call, every caller awaits.
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async (): Promise<string | null> => {
    try {
      const fresh = await request<{ accessToken: string; refreshToken: string }>(
        'POST',
        '/auth/refresh',
        { refreshToken: refreshTokenValue },
        { _isRefresh: true },
      );
      authToken = fresh.accessToken;
      refreshTokenValue = fresh.refreshToken;
      onTokensRefreshed?.({ accessToken: fresh.accessToken, refreshToken: fresh.refreshToken });
      return fresh.accessToken;
    } catch (err) {
      // Refresh failed → session is genuinely dead. Tell the AuthProvider.
      // eslint-disable-next-line no-console
      console.warn('[auth] refresh failed, dropping session:', err);
      authToken = null;
      refreshTokenValue = null;
      onAuthExpired?.();
      return null;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // Network failure — no HTTP response was received.
    throw new ApiHttpError(0, 'NETWORK', err instanceof Error ? err.message : 'Network error');
  }

  // Some endpoints return 204 No Content.
  const text = await response.text();
  // Why `any`: we don't know the shape until we parse. Narrowed immediately below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: any = text.length > 0 ? safeJson(text) : undefined;

  if (response.status === 401 && !options._retried && !options._isRefresh && refreshTokenValue) {
    // Try to swap the dead access token for a fresh one and retry once.
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(method, path, body, { ...options, _retried: true });
    }
    // Refresh failed — fall through to throw the original 401 below.
  }

  if (!response.ok) {
    const code: string = parsed?.code ?? parsed?.error ?? `HTTP_${response.status}`;
    const message: string = parsed?.message ?? response.statusText ?? 'Request failed';
    throw new ApiHttpError(response.status, code, message);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  del: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),
  setAuthToken,
  setRefreshToken,
  setAuthCallbacks,
};
