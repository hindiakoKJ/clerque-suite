/**
 * Clerque Counter — Bluetooth ESC/POS printer service
 *
 * Speaks ESC/POS over `react-native-bluetooth-classic`. Pairs with the
 * cashier's thermal printer (most PH operators use a generic 58 mm
 * RPP-02 / RPP-300 or an 80 mm Epson clone), persists the device id in
 * SecureStore, and auto-reconnects on next launch.
 *
 * REQUIRES a custom development build — the native module is not bundled
 * into Expo Go. Under Expo Go, `usePrinter()` falls back to
 * `ConsolePrinterService` automatically.
 *
 * Android permission flow (API ≥ 31):
 *   • Must request BLUETOOTH_CONNECT (and BLUETOOTH_SCAN for discovery)
 *     at runtime via PermissionsAndroid before calling getBondedDevices().
 *   • If denied, every public method throws a `PrinterError` whose
 *     message is safe to surface in a Snackbar.
 *
 * iOS: Bluetooth Classic uses MFi accessories — the user has to pair
 * the printer in Settings first. We rely on that as the discovery path.
 */

import { Platform, PermissionsAndroid } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type {
  BluetoothDeviceInfo,
  PrinterService,
} from './printerService';
import {
  receiptToEscPos,
  type ReceiptForPrinter,
  type ReceiptWidth,
} from './receiptToEscPos';

/** SecureStore key for the paired device id. */
const PAIRED_DEVICE_KEY = 'clerque.printerId';

export class PrinterError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PrinterError';
  }
}

/**
 * Lazy module loader — `require` is wrapped so the file is safe to import
 * under Expo Go. Throws a typed error if the native module is missing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadRNBluetoothClassic(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-bluetooth-classic');
    return mod?.default ?? mod;
  } catch (e) {
    throw new PrinterError(
      'Bluetooth printer module not available — use a custom dev build (not Expo Go).',
      e,
    );
  }
}

async function ensureAndroidPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // API ≥ 31 split BLUETOOTH_CONNECT / BLUETOOTH_SCAN out of the legacy
  // BLUETOOTH permission. Below 31 the manifest entries are sufficient.
  if (typeof Platform.Version === 'number' && Platform.Version < 31) return;

  const wanted = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
  ];
  const results = await PermissionsAndroid.requestMultiple(wanted);
  const denied = wanted.filter(p => results[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length > 0) {
    throw new PrinterError(
      'Bluetooth permission denied — enable it in app settings to print receipts.',
    );
  }
}

export interface BluetoothPrinterOptions {
  /** Paper width in characters — 32 (58 mm) or 48 (80 mm). Default 32. */
  width?: ReceiptWidth;
}

export class BluetoothPrinterService implements PrinterService {
  private readonly width: ReceiptWidth;
  private cachedId: string | null = null;

  constructor(opts: BluetoothPrinterOptions = {}) {
    this.width = opts.width ?? 32;
  }

  private async getPairedId(): Promise<string | null> {
    if (this.cachedId) return this.cachedId;
    const id = await SecureStore.getItemAsync(PAIRED_DEVICE_KEY);
    this.cachedId = id;
    return id;
  }

  async scanForDevices(): Promise<BluetoothDeviceInfo[]> {
    await ensureAndroidPermissions();
    const RNBT = loadRNBluetoothClassic();

    try {
      const enabled: boolean = await RNBT.isBluetoothEnabled();
      if (!enabled) {
        throw new PrinterError('Bluetooth is off — turn it on and try again.');
      }
      // Bonded (paired) devices only — receipt printers are paired in
      // the OS Bluetooth settings first.
      const devices = await RNBT.getBondedDevices();
      return (devices ?? []).map((d: { address: string; name?: string }) => ({
        id: d.address,
        name: d.name ?? d.address,
      }));
    } catch (e) {
      if (e instanceof PrinterError) throw e;
      throw new PrinterError('Could not list Bluetooth devices.', e);
    }
  }

  async pair(id: string): Promise<void> {
    await ensureAndroidPermissions();
    const RNBT = loadRNBluetoothClassic();
    try {
      // delimiter '' = treat the channel as raw bytes (no LF framing).
      await RNBT.connectToDevice(id, { delimiter: '' });
      await SecureStore.setItemAsync(PAIRED_DEVICE_KEY, id);
      this.cachedId = id;
    } catch (e) {
      throw new PrinterError(
        'Could not connect to the printer — make sure it is on and in range.',
        e,
      );
    }
  }

  async isConnected(): Promise<boolean> {
    const id = await this.getPairedId();
    if (!id) return false;
    try {
      const RNBT = loadRNBluetoothClassic();
      return await RNBT.isDeviceConnected(id);
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    const id = await this.getPairedId();
    if (!id) return;
    try {
      const RNBT = loadRNBluetoothClassic();
      await RNBT.disconnectFromDevice(id);
    } catch {
      // best-effort
    }
    await SecureStore.deleteItemAsync(PAIRED_DEVICE_KEY);
    this.cachedId = null;
  }

  async print(receipt: ReceiptForPrinter): Promise<void> {
    const id = await this.getPairedId();
    if (!id) {
      throw new PrinterError('No printer paired — pair one in Settings → Printer.');
    }
    await ensureAndroidPermissions();
    const RNBT = loadRNBluetoothClassic();
    const bytes = receiptToEscPos(receipt, this.width);
    const b64 = bytesToBase64(bytes);

    const tryWrite = async (): Promise<void> => {
      await RNBT.writeToDevice(id, b64, 'base64');
    };

    try {
      await tryWrite();
    } catch (firstErr) {
      // One-shot reconnect-and-retry — common after the printer sleeps.
      try {
        await RNBT.connectToDevice(id, { delimiter: '' });
        await tryWrite();
      } catch (secondErr) {
        throw new PrinterError(
          'Print failed — check the printer is on, paired, and has paper.',
          secondErr ?? firstErr,
        );
      }
    }
  }
}

/** Hermes-safe Uint8Array → base64 (no Buffer required). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // `btoa` is available on Hermes and the web — RN polyfills it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.btoa === 'function') return g.btoa(binary);
  // Last-resort fallback (should never hit in app runtime).
  return manualBase64(bytes);
}

function manualBase64(bytes: Uint8Array): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  if (i < bytes.length) {
    const rem = bytes.length - i;
    const n = (bytes[i] << 16) | ((rem > 1 ? bytes[i + 1] : 0) << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += rem === 2 ? chars[(n >> 6) & 63] + '=' : '==';
  }
  return out;
}
