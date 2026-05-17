/**
 * Clerque Counter — Printer service picker
 *
 * Returns the right `PrinterService` implementation for the current
 * runtime. Custom dev builds get the Bluetooth ESC/POS service; Expo Go
 * falls back to a console logger so the rest of the app keeps working.
 *
 * The service instance is module-singleton — calling `usePrinter()` from
 * multiple components returns the same object (so a Test Print from
 * Settings and an auto-print from the receipt screen share state).
 */

import { useRef } from 'react';

import {
  ConsolePrinterService,
  type PrinterService,
} from './printerService';

let _instance: PrinterService | null = null;

function createPrinterService(): PrinterService {
  // Try to load the Bluetooth-backed service. If the native module isn't
  // available (Expo Go) or anything throws at import time, fall back to
  // the console logger so the app stays usable.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native-bluetooth-classic');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BluetoothPrinterService } = require('./BluetoothPrinterService');
    return new BluetoothPrinterService();
  } catch {
    return new ConsolePrinterService();
  }
}

/** Returns a stable singleton — safe to call from multiple components. */
export function usePrinter(): PrinterService {
  // useRef just to keep the linter happy about "must be called inside a
  // component" — the actual singleton lives at module scope.
  const ref = useRef<PrinterService | null>(null);
  if (!_instance) _instance = createPrinterService();
  ref.current = _instance;
  return _instance;
}

/** Non-hook accessor (for code outside React, e.g. background workers). */
export function getPrinter(): PrinterService {
  if (!_instance) _instance = createPrinterService();
  return _instance;
}

/** Test seam. */
export function __setPrinter(svc: PrinterService | null): void {
  _instance = svc;
}
