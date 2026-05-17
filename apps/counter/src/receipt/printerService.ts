/**
 * Clerque Counter — Printer Service
 *
 * Interface for thermal receipt printers. Two implementations:
 *   • `ConsolePrinterService` — dev/test/Expo-Go fallback. Logs a human-
 *     readable rendering instead of raw ESC/POS bytes.
 *   • `BluetoothPrinterService` — production. Speaks ESC/POS over
 *     react-native-bluetooth-classic. REQUIRES a custom development build
 *     (Expo Go does not bundle the native module).
 *
 * Consumers should not call these directly — use `usePrinter()` which picks
 * the right implementation at runtime.
 */

import type { ReceiptForPrinter } from './receiptToEscPos';

export interface BluetoothDeviceInfo {
  id: string;
  name: string;
}

export interface PrinterService {
  isConnected(): Promise<boolean>;
  /** Structured payload — the same data the visual Receipt consumes. */
  print(receipt: ReceiptForPrinter): Promise<void>;
  scanForDevices(): Promise<BluetoothDeviceInfo[]>;
  pair(id: string): Promise<void>;
  /** Drop the current connection (if any). Best-effort. */
  disconnect?(): Promise<void>;
}

/**
 * Console fallback — safe to use under Expo Go and in unit tests. Logs a
 * legible receipt summary; never throws.
 */
export class ConsolePrinterService implements PrinterService {
  private pairedDeviceId: string | null = null;

  async isConnected(): Promise<boolean> {
    return this.pairedDeviceId !== null;
  }

  async print(receipt: ReceiptForPrinter): Promise<void> {
    const lines: string[] = [];
    lines.push('═══════════════════════════════════════════');
    lines.push(` ${receipt.tenant.name.toUpperCase()}`);
    lines.push(` TIN ${receipt.tenant.tin}`);
    lines.push(` OR # ${receipt.orNumber.toString().padStart(6, '0')}`);
    lines.push(` Cashier: ${receipt.cashierName}`);
    lines.push('───────────────────────────────────────────');
    for (const l of receipt.cart.lines) {
      lines.push(`  ${l.qty}x ${l.productName}  ${(l.lineTotal / 100).toFixed(2)}`);
    }
    lines.push('───────────────────────────────────────────');
    lines.push(` TOTAL  ${(receipt.totalCents / 100).toFixed(2)}`);
    for (const p of receipt.payments) {
      lines.push(` ${p.method}  ${(p.amount / 100).toFixed(2)}`);
    }
    lines.push(` Change  ${(receipt.changeCents / 100).toFixed(2)}`);
    lines.push('═══════════════════════════════════════════');
    // eslint-disable-next-line no-console
    console.log(
      `[ConsolePrinter] (pairedDeviceId=${this.pairedDeviceId ?? 'none'})\n` +
        lines.join('\n'),
    );
  }

  async scanForDevices(): Promise<BluetoothDeviceInfo[]> {
    // eslint-disable-next-line no-console
    console.log('[ConsolePrinter] scanForDevices — returns empty list');
    return [];
  }

  async pair(id: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[ConsolePrinter] pair', { id });
    this.pairedDeviceId = id;
  }

  async disconnect(): Promise<void> {
    this.pairedDeviceId = null;
  }
}

let _instance: PrinterService | null = null;

/**
 * Legacy accessor — returns the console fallback. New code should use
 * `usePrinter()` from `./usePrinter.ts` to get the runtime-appropriate
 * service.
 */
export function getPrinterService(): PrinterService {
  if (!_instance) _instance = new ConsolePrinterService();
  return _instance;
}

/** Test seam — let tests inject a fake. */
export function __setPrinterService(svc: PrinterService | null): void {
  _instance = svc;
}
