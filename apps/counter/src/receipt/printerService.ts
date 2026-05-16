/**
 * Clerque Counter — Printer Service
 *
 * Stub interface for thermal receipt printers. V1 implementation logs to
 * console and returns OK. The real ESC/POS over react-native-bluetooth-classic
 * implementation is the next sprint.
 *
 * The same `Receipt` component renders for screen preview and, eventually,
 * is serialised to ESC/POS commands or rendered to PDF via expo-print as a
 * fallback path.
 */

export interface BluetoothDeviceInfo {
  id: string;
  name: string;
}

export interface PrinterService {
  isConnected(): Promise<boolean>;
  /** `receiptHtml` is an HTML snapshot — used by the expo-print PDF fallback. */
  print(receiptHtml: string): Promise<void>;
  scanForDevices(): Promise<BluetoothDeviceInfo[]>;
  pair(id: string): Promise<void>;
}

class ConsolePrinterService implements PrinterService {
  private pairedDeviceId: string | null = null;

  async isConnected(): Promise<boolean> {
    return this.pairedDeviceId !== null;
  }

  async print(receiptHtml: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[printerService] print() called', {
      pairedDeviceId: this.pairedDeviceId,
      htmlPreview: receiptHtml.slice(0, 200),
    });
  }

  async scanForDevices(): Promise<BluetoothDeviceInfo[]> {
    // eslint-disable-next-line no-console
    console.log('[printerService] scanForDevices() stub — returns empty');
    return [];
  }

  async pair(id: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[printerService] pair() called', { id });
    this.pairedDeviceId = id;
  }
}

let _instance: PrinterService | null = null;

export function getPrinterService(): PrinterService {
  if (!_instance) _instance = new ConsolePrinterService();
  return _instance;
}
