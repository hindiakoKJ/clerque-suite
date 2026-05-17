/**
 * Clerque Counter — Device-mode persistence
 *
 * A counter device boots into one of four surfaces forever after first launch:
 *   • CASHIER         — full till (sign-in + cashier PIN required)
 *   • OWNER_SPOTCHECK — owner read-only multi-branch dashboard (same auth as cashier)
 *   • CUSTOMER_DISPLAY — kiosk cart mirror, no login (paired via 4-digit code)
 *   • KDS              — kitchen / bar display, no login (paired + station-pinned)
 *
 * Stored in expo-secure-store (auth-grade, encrypted at rest) under
 * `clerque.deviceMode`. Settings → "Change device mode" wipes the key and
 * boots back into the picker.
 */

import * as SecureStore from 'expo-secure-store';

export type DisplayDeviceRole =
  | 'CUSTOMER_DISPLAY'
  | 'KDS_KITCHEN'
  | 'KDS_BAR'
  | 'KDS_COLD_BAR'
  | 'KDS_HOT_BAR'
  | 'KDS_PASTRY_PASS'
  | 'KDS_GENERIC';

export interface PairedDevice {
  deviceToken: string;
  tenantId:    string;
  tenantName:  string;
  cashierId:   string;
  role:        DisplayDeviceRole | string;
  stationId?:  string | null;
  label?:      string | null;
}

export type DeviceMode =
  | { kind: 'CASHIER' }
  | { kind: 'OWNER_SPOTCHECK' }
  | { kind: 'CUSTOMER_DISPLAY'; pairing: PairedDevice }
  | { kind: 'KDS';              pairing: PairedDevice };

export const DEVICE_MODE_KEY = 'clerque.deviceMode';

export async function readDeviceMode(): Promise<DeviceMode | null> {
  try {
    const raw = await SecureStore.getItemAsync(DEVICE_MODE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceMode;
    if (!parsed?.kind) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeDeviceMode(mode: DeviceMode): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_MODE_KEY, JSON.stringify(mode));
}

export async function clearDeviceMode(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_MODE_KEY);
}
