/**
 * Clerque Counter — Paired-device fetch helper
 *
 * Non-cashier surfaces (CUSTOMER_DISPLAY, KDS) authenticate against the
 * Cloud API with a long-lived deviceToken issued by /display-pairing/redeem,
 * NOT a per-user JWT. We don't want to mutate the shared `api` client's
 * Authorization header (the cashier flow owns that), so this module fetches
 * directly while reusing the same base URL discovery logic.
 *
 * Token-sanity check: GET /display-pairing/whoami?token=<...> returns 400
 * when the token is revoked / missing — callers wipe SecureStore and bounce
 * back to the picker on that signal.
 */

import Constants from 'expo-constants';
import { ApiHttpError } from '@/api/client';

function getBaseUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
  const url = extra.apiBaseUrl;
  if (!url) throw new ApiHttpError(0, 'CONFIG', 'apiBaseUrl missing from expo config');
  return url.replace(/\/+$/, '');
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  deviceToken: string | null,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (deviceToken) {
    // Backend may consume this via either an Authorization Bearer scheme
    // (KIOSK_DISPLAY service-user pattern) or a dedicated header. Send both
    // so whichever the relay guard checks is satisfied.
    headers['Authorization']  = `Bearer ${deviceToken}`;
    headers['X-Device-Token'] = deviceToken;
  }

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiHttpError(0, 'NETWORK', err instanceof Error ? err.message : 'Network error');
  }

  const text = await response.text();
  // Why `any`: shape is endpoint-specific; narrowed at the call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: any = text.length > 0 ? safeJson(text) : undefined;

  if (!response.ok) {
    const code:    string = parsed?.code ?? parsed?.error ?? `HTTP_${response.status}`;
    const message: string = parsed?.message ?? response.statusText ?? 'Request failed';
    throw new ApiHttpError(response.status, code, message);
  }
  return parsed as T;
}

function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return undefined; }
}

export const pairedClient = {
  get:  <T>(path: string, token: string | null) => request<T>('GET',  path, token),
  post: <T>(path: string, token: string | null, body?: unknown) => request<T>('POST', path, token, body),
};

export interface WhoamiResponse {
  tenantId:   string;
  cashierId:  string;
  stationId:  string | null;
  role:       string;
  label:      string | null;
}

/** Returns true if the token is still valid. False on 4xx (revoked / missing). */
export async function verifyDeviceToken(token: string): Promise<boolean> {
  try {
    await pairedClient.get<WhoamiResponse>(
      `/display-pairing/whoami?token=${encodeURIComponent(token)}`,
      null, // whoami is public — query-param auth, no header needed
    );
    return true;
  } catch (err) {
    if (err instanceof ApiHttpError && err.status >= 400 && err.status < 500) {
      return false;
    }
    // Network blip — assume the token is still good; the device can keep
    // serving from cache.
    return true;
  }
}
