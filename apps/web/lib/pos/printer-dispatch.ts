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
import { thermalBytes } from './thermal-text';

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

// Printers get plain ASCII: "Café" -> "Cafe", "×" -> "x" (see thermal-text.ts).
function txt(s: string): Uint8Array { return thermalBytes(s); }
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
    parts.push(txt(`${item.quantity}x ${item.productName}`), C.lf);
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
        // On desktop (no RawBT installed) the URL would fail silently, so say why.
        if (typeof window === 'undefined') return { ok: false, reason: 'No window' };
        if (!isLikelyAndroid()) {
          return {
            ok: false,
            reason: `${printer.name} prints through the RawBT app on an Android tablet. Print from that tablet, or use the browser print button here.`,
          };
        }
        // Same hand-off as the station tablets and the test slip: a link click,
        // not a hidden iframe, which newer Android Chrome silently blocks.
        sendViaRawBt(escpos);
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
        // A browser cannot open a raw connection to a printer's IP address, so
        // this screen cannot print to a network printer. Say what to do instead.
        return {
          ok: false,
          reason: `${printer.name} is set up as a network printer, which this screen cannot print to. Ask Clerque support to switch it to Bluetooth (RawBT) or USB, or turn it off in Settings > Floor layout.`,
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
  /**
   * This device cannot drive that printer at all, so nothing was attempted.
   * Not a failure: the station prints its own ticket from its own screen.
   */
  skipped?: boolean;
}

/**
 * Can THIS device drive that printer at all?
 *
 * A station printer belongs to the station's tablet: the bar's Bluetooth
 * printer is paired to the bar tablet through RawBT, not to the till. A till on
 * a laptop used to try anyway, fail, and put a red "Station tickets failed ...
 * RawBT requires Android" toast over every single sale, which reads as "the
 * sale went wrong" when nothing had. The kitchen and bar screens have their
 * own print button per ticket, so the right thing for the till to do about a
 * printer it cannot reach is nothing, quietly.
 */
export function printerReachableHere(
  printer: PrinterConfig,
  webSerialPrinter: { send?: (b: Uint8Array) => Promise<void>; connected?: boolean } | null,
): boolean {
  switch (printer.interface) {
    case 'BLUETOOTH_RAWBT':
      return isLikelyAndroid();
    case 'USB':
      return !!webSerialPrinter?.send && !!webSerialPrinter.connected;
    case 'NETWORK':
      return false;
    case 'BLUETOOTH_NATIVE': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cap = typeof window !== 'undefined' ? (window as any).Capacitor : undefined;
      return !!cap?.isNative;
    }
    default:
      return false;
  }
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

    // Not this device's printer: leave it to the station's own screen.
    if (!printerReachableHere(printer, webSerialPrinter)) {
      results.push({
        printer,
        station,
        jobType: 'STATION_TICKET',
        ok: false,
        skipped: true,
        reason: `${station.name} prints its own tickets.`,
      });
      continue;
    }

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

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa handles binary strings; the input is already characters in 0-255 range.
  return typeof window !== 'undefined' ? window.btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

/**
 * Hand an ESC/POS payload to the RawBT app via its intent URL. RawBT owns the
 * Bluetooth pairing (classic SPP printers are unreachable from Web Bluetooth)
 * and forwards the bytes to the paired printer. A hidden link is clicked, so
 * the intent opens RawBT without replacing the page.
 */
export function sendViaRawBt(escpos: Uint8Array): void {
  if (typeof window === 'undefined') return;
  const url = `rawbt:base64,${uint8ToBase64(escpos)}`;

  // Anchor click, not a hidden iframe. Newer Android Chrome silently refuses
  // custom-scheme navigations inside iframes ("Navigation to rawbt: was
  // blocked"), which presents as "the print button does nothing" with no
  // error anywhere. A synthesized click on a real <a> runs inside the user's
  // gesture and reliably raises the Android intent chooser / RawBT.
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    setTimeout(() => {
      if (a.parentNode) document.body.removeChild(a);
    }, 1000);
  }
}

export function isLikelyAndroid(): boolean {
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
  /** Printers this device cannot drive; nothing was tried, nothing went wrong. */
  skippedCount: number;
  failureSummary?: string;
} {
  const printed = results.filter((r) => r.ok);
  const skipped = results.filter((r) => !r.ok && r.skipped);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  let failureSummary: string | undefined;
  if (failed.length > 0) {
    const reasons = [...new Set(failed.map((f) => f.reason ?? 'unknown'))];
    const printers = [...new Set(failed.map((f) => f.printer.name))];
    failureSummary = `${printers.join(', ')}: ${reasons.join('; ')}`;
  }
  return { printedCount: printed.length, failedCount: failed.length, skippedCount: skipped.length, failureSummary };
}

/**
 * What, if anything, to tell the cashier after the tickets went out. Null means
 * say nothing: there was nothing to print, or the only printers involved
 * belong to other devices.
 */
export function dispatchToast(results: DispatchResult[]): { level: 'success' | 'warning'; message: string } | null {
  const { printedCount, failedCount, failureSummary } = summariseDispatch(results);
  if (printedCount > 0 && failedCount === 0) {
    return { level: 'success', message: `Sent ${printedCount} ticket${printedCount === 1 ? '' : 's'} to stations.` };
  }
  if (printedCount > 0 && failedCount > 0) {
    return { level: 'warning', message: `The sale is saved. ${printedCount} station ticket${printedCount === 1 ? '' : 's'} sent, ${failedCount} did not print: ${failureSummary}` };
  }
  if (failedCount > 0) {
    return { level: 'warning', message: `The sale is saved, but the station ticket did not print: ${failureSummary}` };
  }
  return null;
}

// ── Toast convenience ───────────────────────────────────────────────────────

/** Toast a friendly summary after a multi-printer dispatch. */
export function toastDispatchSummary(results: DispatchResult[]) {
  const t = dispatchToast(results);
  if (!t) return; // nothing to print, or only other devices' printers: silent
  if (t.level === 'success') toast.success(t.message);
  else toast.warning(t.message);
}
