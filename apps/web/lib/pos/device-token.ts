/**
 * Sprint 25 — Paired-device token helpers.
 *
 * Secondary screens (customer display TV, KDS tablet, second register) pair
 * once via /pair → POST /display-pairing/redeem and persist the resulting
 * device token in localStorage. Subsequent reloads (TV power-cycle, browser
 * refresh) read the token back and re-verify via GET /display-pairing/whoami
 * so a revoked token bounces the device back to /pair.
 *
 * The token is NOT a JWT — the API's display-pairing controller takes it as
 * a query / body param on the public endpoints. Don't attach it as a Bearer.
 */

import axios from 'axios';

export const DEVICE_TOKEN_STORAGE_KEY = 'clerque.deviceToken';

export type PairedDeviceRole =
  | 'CUSTOMER_DISPLAY'
  | 'KDS_KITCHEN'
  | 'KDS_BAR'
  | 'KDS_COLD_BAR'
  | 'KDS_HOT_BAR'
  | 'KDS_PASTRY_PASS'
  | 'KDS_GENERIC';

export interface StoredDeviceToken {
  deviceToken: string;
  tenantId:    string;
  tenantName?: string;
  cashierId:   string;
  role:        PairedDeviceRole;
  stationId:   string | null;
  label:       string | null;
}

export interface WhoamiResponse {
  tenantId:  string;
  cashierId: string;
  stationId: string | null;
  role:      PairedDeviceRole;
  label:     string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Read the stored device-token bundle, or null if not paired. */
export function readDeviceToken(): StoredDeviceToken | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDeviceToken;
    if (!parsed?.deviceToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a freshly-issued device-token bundle. */
export function writeDeviceToken(bundle: StoredDeviceToken): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, JSON.stringify(bundle));
}

/** Forget the stored device-token bundle (Unpair action). */
export function clearDeviceToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
}

/**
 * Verify a token with the API. Returns the whoami payload on success, null on
 * any failure (revoked, missing, network). The /whoami endpoint is PUBLIC —
 * the bearer-token interceptor on api.ts would attach a stale cashier JWT,
 * which is fine but pointless; we use a raw axios call to keep this independent
 * of the cashier auth lifecycle.
 */
export async function verifyDeviceToken(token: string): Promise<WhoamiResponse | null> {
  if (!token) return null;
  try {
    const { data } = await axios.get<WhoamiResponse>(
      `${API_URL}/display-pairing/whoami`,
      { params: { token } },
    );
    return data;
  } catch {
    return null;
  }
}
