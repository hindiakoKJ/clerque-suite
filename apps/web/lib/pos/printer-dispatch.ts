'use client';

/**
 * Multi-printer dispatch — Sprint 3 Phase B.
 *
 * Given a completed order and the tenant's floor layout (stations + printers),
 * splits the items into:
 *   1. The full receipt → receipt printer (existing path)
 *   2. Station tickets per station that has items + a printer (kitchen, bar)
 *
 * Each printer is dispatched via the right protocol:
 *   - BLUETOOTH_RAWBT → opens a rawbt:// URL (RawBT Android app intercepts it)
 *   - USB / Web Serial → uses the existing ThermalPrinterService
 *   - NETWORK         → POSTs to a backend proxy (deferred to Phase 3D)
 *   - BLUETOOTH_NATIVE → only available in the Capacitor wrap
 *
 * Failure handling: each dispatch is independent. If the bar printer
 * is unreachable, the receipt still prints. We surface a toast but never
 * block the sale.
 */

import { toast } from 'sonner';

// ── Types ───────────────────────────────────────────────────────────────────

export type PrinterInterface =
  | 'NETWORK'
  | 'BLUETOOTH_RAWBT'
  | 'USB'
  | 'BLUETOOTH_NATIVE';

export interface PrinterConfig {
  id:             string;
  name:           string;
  interface:      PrinterInterface;
  address:        string | null;
  paperWidthMm:   number;
  printsReceipts: boolean;
  printsOrders:   boolean;
  isActive:       boolean;
}

export interface StationConfig {
  id:         string;
  name:       string;
  hasPrinter: boolean;
  printerId:  string | null;
  /** Category IDs routed to this station */
  categoryIds: string[];
}

export interface OrderItemForPrint {
  productName: string;
  quantity:    number;
  /** Category id used to look up the routing station */
  categoryId?: string | null;
  modifiers?:  Array<{ optionName: string; priceAdjustment?: number }>;
  notes?:      string;
}

export interface StationTicketData {
  orderNumber: string;
  branchName?: string;
  completedAt: string;
  stationName: string;
  items:       OrderItemForPrint[];
}

// ── Station ticket builder (minimal ESC/POS) ────────────────────────────────

const C = {
  init:        new Uint8Array([0x1b, 0x40]),        // ESC @
  lf:          new Uint8Array([0x0a]),
  feed3:       new Uint8Array([0x1b, 0x64, 0x03]),  // ESC d 3
  cut:         new Uint8Array([0x1d, 0x56, 0x01]),  // GS V 1
  alignCenter: new Uint8Array([0x1b, 0x61, 0x01]),
  alignLeft:   new Uint8Array([0x1b, 0x61, 0x00]),
  boldOn:      new Uint8Array([0x1b, 0x45, 0x01]),
  boldOff:     new Uint8Array([0x1b, 0x45, 0x00]),
  doubleOn:    new Uint8Array([0x1d, 0x21, 0x11]),  // GS ! width=2,height=2
  doubleOff:   new Uint8Array([0x1d, 0x21, 0x00]),
};

const enc = new TextEncoder();
function txt(s: string): Uint8Array { return enc.encode(s); }
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const c of chunks) { out.set(c, i); i += c.length; }
  return out;
}

/**
 * Build a station ticket — kitchen/bar friendly. Big order number, big
 * item names, no totals, no tax, no payment info. Just what to make.
 */
export function buildStationTicket(data: StationTicketData, paperWidthMm = 80): Uint8Array {
  const cols = paperWidthMm === 58 ? 32 : 48;
  const dash = () => txt('-'.repeat(cols)) as Uint8Array;

  const parts: Uint8Array[] = [C.init];

  // Header
  parts.push(C.alignCenter, C.boldOn, C.doubleOn);
  parts.push(txt(data.stationName.toUpperCase()), C.lf);
  parts.push(C.doubleOff);
  parts.push(txt(`# ${data.orderNumber}`), C.lf);
  parts.push(C.boldOff);
  parts.push(txt(new Date(data.completedAt).toLocaleString('en-PH', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Manila',
  })), C.lf);
  if (data.branchName) parts.push(txt(data.branchName), C.lf);
  parts.push(C.alignLeft, dash(), C.lf);

  // Items
  for (const item of data.items) {
    parts.push(C.boldOn);
    parts.push(txt(`${item.quantity}× ${item.productName}`), C.lf);
    parts.push(C.boldOff);
    if (item.modifiers && item.modifiers.length > 0) {
      for (const m of item.modifiers) {
        parts.push(txt(`   - ${m.optionName}`), C.lf);
      }
    }
    if (item.notes) {
      parts.push(txt(`   * ${item.notes}`), C.lf);
    }
    parts.push(C.lf);
  }

  parts.push(dash(), C.lf, C.feed3, C.cut);
  return concat(parts);
}

// ── Dispatch ───────────────────────────────────────────────────────────────

/**
 * Send raw ESC/POS bytes to a printer using its configured interface.
 *
 * Returns a "soft" result — never throws. Failures are toasted but
 * don't block the calling code (so a sale never fails because the
 * bar printer is unplugged).
 */
export async function dispatchPrintJob(
  printer: PrinterConfig,
  escpos:  Uint8Array,
  webSerialPrinter: { send?: (b: Uint8Array) => Promise<void>; connected?: boolean } | null,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    switch (printer.interface) {
      case 'BLUETOOTH_RAWBT': {
        // RawBT URL scheme: rawbt:base64,<base64-encoded ESC/POS>
        // RawBT Android app captures the URL via Android intent filter and
        // forwards bytes to the paired Bluetooth printer.
        // Reference: https://rawbt.ru/ (free, freemium pro features).
        const b64 = uint8ToBase64(escpos);
        const url = `rawbt:base64,${b64}`;
        // window.location.href triggers the intent on Android browsers.
        // On desktop (no RawBT installed), the URL fails silently — we toast a hint.
        if (typeof window === 'undefined') return { ok: false, reason: 'No window' };
        if (!isLikelyAndroid()) {
          return { ok: false, reason: 'RawBT requires Android with the RawBT app installed.' };
        }
        // Use a hidden iframe so the navigation doesn't replace the current page
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = url;
        document.body.appendChild(iframe);
        // Clean up after a tick — RawBT consumes the URL on app launch
        setTimeout(() => document.body.removeChild(iframe), 1000);
        return { ok: true };
      }

      case 'USB': {
        // Existing Web Serial path — printer must be connected via the picker
        if (!webSerialPrinter?.send || !webSerialPrinter.connected) {
          return { ok: false, reason: `${printer.name} is not connected.` };
        }
        await webSerialPrinter.send(escpos);
        return { ok: true };
      }

      case 'NETWORK': {
        // Reach the printer's IP via a server-side proxy. Browsers can't open
        // raw TCP sockets directly. Phase 3D adds the backend proxy endpoint;
        // for now, fail with a friendly message.
        return {
          ok: false,
          reason: `Network printer support coming soon. Set ${printer.name} to Bluetooth (RawBT) or USB.`,
        };
      }

      case 'BLUETOOTH_NATIVE': {
        // Capacitor wrap only — checked via window.Capacitor at runtime.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cap = typeof window !== 'undefined' ? (window as any).Capacitor : undefined;
        if (!cap?.isNative) {
          return {
            ok: false,
            reason: `${printer.name} requires the Clerque Counter Android app.`,
          };
        }
        // Capacitor plugin call would go here; deferred to year-end Capacitor track
        return { ok: false, reason: 'Native Bluetooth coming with the Android app.' };
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Unknown printer error',
    };
  }
}

// ── Higher-level: split order across station printers ──────────────────────

export interface OrderForPrint {
  orderNumber: string;
  branchName?: string;
  completedAt: string;
  items: OrderItemForPrint[];
}

export interface DispatchInput {
  order:    OrderForPrint;
  stations: StationConfig[];
  printers: PrinterConfig[];
  /** A connected Web Serial printer instance — used for USB dispatch. */
  webSerialPrinter: { send?: (b: Uint8Array) => Promise<void>; connected?: boolean } | null;
}

export interface DispatchResult {
  printer: PrinterConfig;
  station?: StationConfig;
  jobType: 'STATION_TICKET';
  ok: boolean;
  reason?: string;
}

/**
 * Print one station ticket per station that has items + a printer.
 * The receipt itself is printed separately via the existing receipt path.
 *
 * Returns one result per dispatched job. Caller decides what to surface
 * (typically a single toast summarizing successes + any failures).
 */
export async function dispatchOrderToStations(
  input: DispatchInput,
): Promise<DispatchResult[]> {
  const { order, stations, printers, webSerialPrinter } = input;
  const printerById = new Map(printers.map((p) => [p.id, p]));
  const results: DispatchResult[] = [];

  for (const station of stations) {
    if (!station.hasPrinter || !station.printerId) continue;
    const printer = printerById.get(station.printerId);
    if (!printer || !printer.isActive) continue;

    const items = order.items.filter(
      (it) => it.categoryId && station.categoryIds.includes(it.categoryId),
    );
    if (items.length === 0) continue;

    const ticket: StationTicketData = {
      orderNumber: order.orderNumber,
      branchName:  order.branchName,
      completedAt: order.completedAt,
      stationName: station.name,
      items,
    };
    const escpos = buildStationTicket(ticket, printer.paperWidthMm);
    const dispatchResult = await dispatchPrintJob(printer, escpos, webSerialPrinter);
    results.push({
      printer,
      station,
      jobType: 'STATION_TICKET',
      ...dispatchResult,
    });
  }

  return results;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa handles binary strings; the input is already characters in 0-255 range.
  return typeof window !== 'undefined' ? window.btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

function isLikelyAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

/**
 * Summarise dispatch results for a single user-visible toast.
 * Called by the terminal after dispatch completes.
 */
export function summariseDispatch(results: DispatchResult[]): {
  printedCount: number;
  failedCount:  number;
  failureSummary?: string;
} {
  const printed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  let failureSummary: string | undefined;
  if (failed.length > 0) {
    const reasons = [...new Set(failed.map((f) => f.reason ?? 'unknown'))];
    const printers = [...new Set(failed.map((f) => f.printer.name))];
    failureSummary = `${printers.join(', ')}: ${reasons.join('; ')}`;
  }
  return { printedCount: printed.length, failedCount: failed.length, failureSummary };
}

// ── Toast convenience ───────────────────────────────────────────────────────

/** Toast a friendly summary after a multi-printer dispatch. */
export function toastDispatchSummary(results: DispatchResult[]) {
  const { printedCount, failedCount, failureSummary } = summariseDispatch(results);
  if (printedCount > 0 && failedCount === 0) {
    toast.success(`Sent ${printedCount} ticket${printedCount === 1 ? '' : 's'} to stations.`);
  } else if (printedCount > 0 && failedCount > 0) {
    toast.warning(`${printedCount} sent, ${failedCount} failed: ${failureSummary}`);
  } else if (printedCount === 0 && failedCount > 0) {
    toast.error(`Station tickets failed: ${failureSummary}`);
  }
  // 0 printed, 0 failed = nothing to dispatch — silent
}
