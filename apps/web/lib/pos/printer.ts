/**
 * ESC/POS Thermal Printer Service
 * Connects via Web Serial API (Chrome/Edge on dedicated POS terminal).
 * Falls back to window.print() when no serial printer is connected.
 *
 * Usage:
 *   import { printer } from '@/lib/pos/printer';
 *   await printer.connect();          // user selects serial port once
 *   await printer.printReceipt(data); // ESC/POS bytes → printer
 *   printer.disconnect();
 */

// ── Web Serial type shim ──────────────────────────────────────────────────────────
declare global {
  interface SerialPortInfo { usbVendorId?: number; usbProductId?: number; }
  interface SerialPort {
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    readable: ReadableStream | null;
    writable: WritableStream | null;
    getInfo(): SerialPortInfo;
  }
  interface SerialPortRequestOptions { filters?: { usbVendorId?: number; usbProductId?: number }[]; }
  interface Serial {
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  }
  interface Navigator { readonly serial: Serial; }
}

// ── Constants ───────────────────────────────────────────────────────────────────
const COLS = 48;        // 80 mm paper = 48 chars at 12 cpi
const BAUD = 9600;      // default for most Epson / XPrinter thermal printers

// ── ESC/POS byte helpers ────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

const cmd = (...b: number[]) => new Uint8Array(b);

const C = {
  init:         cmd(ESC, 0x40),
  lf:           cmd(LF),
  cut:          cmd(GS, 0x56, 0x41, 0x00),   // partial cut
  alignLeft:    cmd(ESC, 0x61, 0x00),
  alignCenter:  cmd(ESC, 0x61, 0x01),
  alignRight:   cmd(ESC, 0x61, 0x02),
  boldOn:       cmd(ESC, 0x45, 0x01),
  boldOff:      cmd(ESC, 0x45, 0x00),
  doubleOn:     cmd(ESC, 0x21, 0x30),  // double-height + bold
  doubleOff:    cmd(ESC, 0x21, 0x00),
  feed3:        cmd(LF, LF, LF),
};

const enc = new TextEncoder();
const txt = (s: string) => enc.encode(s);

function padRight(s: string, n: number) { return s.substring(0, n).padEnd(n); }

function twoCol(left: string, right: string): Uint8Array {
  const r = right.length;
  const l = COLS - r - 1;
  return txt(`${padRight(left, l)} ${right}`);
}

function dash(): Uint8Array { return txt('-'.repeat(COLS)); }

/** Merge all Uint8Array chunks into one. */
function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ── Receipt + Report data types ─────────────────────────────────────────────────
export interface PrintReceiptData {
  orderNumber:      string;
  branchName?:      string;
  completedAt:      string;
  lines:            { productName: string; quantity: number; unitPrice: number; lineTotal: number; discountAmount: number }[];
  subtotal:         number;
  discountAmount:   number;
  isPwdScDiscount:  boolean;
  discountOnBase?:  number;
  vatExclusiveBase?: number;
  vatRelief?:       number;
  vatAmount:        number;
  totalAmount:      number;
  payments:         { method: string; amount: number; reference?: string }[];
  isOffline?:       boolean;
  pwdScIdRef?:      string;
  pwdScIdOwnerName?: string;
  // ── BIR compliance fields (RR No. 1-2026) ──────────────────────────────────
  taxStatus?:         'VAT' | 'NON_VAT' | 'UNREGISTERED';
  tinNumber?:         string | null;
  businessName?:      string | null;
  registeredAddress?: string | null;
  isPtuHolder?:       boolean;
  ptuNumber?:         string | null;
  minNumber?:         string | null;
  // ── B2B customer fields (RR No. 1-2026 — required for CHARGE/B2B invoices) ─
  invoiceType?:       'CASH_SALE' | 'CHARGE';
  customerName?:      string | null;
  customerTin?:       string | null;
  customerAddress?:   string | null;
}

export interface PrintShiftData {
  shift: {
    openedAt: string;
    closedAt?: string | null;
    openingCash: number;
    closingCashDeclared?: number | null;
    closingCashExpected?: number | null;
    variance?: number | null;
    notes?: string | null;
  };
  totalOrders: number;
  voidCount: number;
  totalRevenue: number;
  cashRevenue: number;
  nonCashRevenue: number;
  avgOrderValue: number;
  byPaymentMethod: { method: string; totalAmount: number; orderCount: number }[];
  topProducts: { productName: string; quantitySold: number; revenue: number }[];
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  GCASH_PERSONAL: 'GCash Personal',
  GCASH_BUSINESS: 'GCash Business',
  MAYA_PERSONAL: 'Maya Personal',
  MAYA_BUSINESS: 'Maya Business',
  QR_PH: 'QR Ph',
};

function fmtPeso(n: number) {
  return `P${Math.abs(n).toFixed(2)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── ESC/POS document builders ───────────────────────────────────────────────────

/**
 * Map TaxStatus to BIR-mandated receipt title per provider phase.
 *
 * Phase 1 (Internal Management): always "ACKNOWLEDGEMENT RECEIPT"
 *   — pre-BIR-accreditation; issuing OR without PTU is a regulatory violation.
 * Phase 2 (BIR Certified): follows taxStatus per RR No. 1-2026.
 */
function birReceiptTitle(taxStatus?: 'VAT' | 'NON_VAT' | 'UNREGISTERED'): string {
  // Read NEXT_PUBLIC_PROVIDER_PHASE at call time (supports SSR + runtime changes)
  const phase = (process.env.NEXT_PUBLIC_PROVIDER_PHASE ?? '1').trim();
  if (phase !== '2') return 'ACKNOWLEDGEMENT RECEIPT';

  switch (taxStatus) {
    case 'VAT':          return 'VAT OFFICIAL RECEIPT';
    case 'NON_VAT':      return 'OFFICIAL RECEIPT';
    case 'UNREGISTERED':
    default:             return 'ACKNOWLEDGEMENT RECEIPT';
  }
}

function buildReceipt(data: PrintReceiptData): Uint8Array {
  const parts: Uint8Array[] = [];
  const p = (...c: Uint8Array[]) => parts.push(...c, C.lf);

  const taxStatus    = data.taxStatus ?? 'UNREGISTERED';
  const isVat        = taxStatus === 'VAT';
  const isRegistered = taxStatus !== 'UNREGISTERED';

  const cashTendered = data.payments.filter(x => x.method === 'CASH').reduce((s, x) => s + x.amount, 0);
  const nonCash      = data.payments.filter(x => x.method !== 'CASH').reduce((s, x) => s + x.amount, 0);
  const change       = Math.max(0, cashTendered - (data.totalAmount - nonCash));

  parts.push(C.init);

  if (data.isOffline) {
    parts.push(C.alignCenter, C.boldOn);
    p(txt('[ OFFLINE ORDER - PENDING SYNC ]'));
    parts.push(C.boldOff);
    p(C.lf);
  }

  const isPhase2 = (process.env.NEXT_PUBLIC_PROVIDER_PHASE ?? '1').trim() === '2';

  // ── Header: business name + BIR classification ─────────────────────────────
  parts.push(C.alignCenter, C.doubleOn);
  p(txt((data.businessName ?? data.branchName ?? 'DEMO STORE').toUpperCase()));
  parts.push(C.doubleOff);
  // Show branch name below business name if both exist
  if (data.businessName && data.branchName) {
    p(txt(data.branchName));
  }
  // Registered address (Phase 2, BIR-registered tenants)
  if (isPhase2 && data.registeredAddress) {
    p(txt(data.registeredAddress));
  }
  // TIN line per RR No. 1-2026 (Phase 2 only)
  if (isPhase2 && isRegistered && data.tinNumber) {
    const tinLabel = isVat ? 'VAT REG TIN' : 'NON-VAT REG TIN';
    p(txt(`${tinLabel}: ${data.tinNumber}`));
  }
  // PTU / MIN (Phase 2 only, when tenant holds PTU)
  if (isPhase2 && data.isPtuHolder) {
    if (data.ptuNumber) p(txt(`PTU No.: ${data.ptuNumber}`));
    if (data.minNumber) p(txt(`MIN: ${data.minNumber}`));
  }
  p(txt(birReceiptTitle(taxStatus)));
  p(txt(fmtDate(data.completedAt)));
  p(C.lf);
  parts.push(C.boldOn);
  p(txt(`# ${data.orderNumber}`));
  parts.push(C.boldOff);
  p(C.lf);

  // ── B2B customer block (RR No. 1-2026 — CHARGE invoice / business customer) ─
  if (data.invoiceType === 'CHARGE' || data.customerTin) {
    parts.push(C.alignLeft);
    p(dash());
    parts.push(C.boldOn);
    p(txt('BILL TO:'));
    parts.push(C.boldOff);
    if (data.customerName)    p(txt(data.customerName));
    if (data.customerTin)     p(txt(`TIN: ${data.customerTin}`));
    if (data.customerAddress) p(txt(data.customerAddress));
  }

  // ── Line items ─────────────────────────────────────────────────────────────
  parts.push(C.alignLeft);
  p(dash());
  for (const line of data.lines) {
    p(txt(padRight(line.productName, COLS)));
    const qty = `  ${line.quantity} x ${fmtPeso(line.unitPrice)}`;
    const tot = fmtPeso(line.lineTotal);
    parts.push(twoCol(qty, tot), C.lf);
    if (line.discountAmount > 0) {
      parts.push(twoCol('  Discount', `-${fmtPeso(line.discountAmount)}`), C.lf);
    }
  }
  p(dash());

  // ── Totals ──────────────────────────────────────────────────────────────────
  parts.push(twoCol('Subtotal', fmtPeso(data.subtotal)), C.lf);

  if (data.isPwdScDiscount && data.discountOnBase != null) {
    const baseLabel = isVat ? 'VAT-excl. base' : 'Gross base';
    parts.push(twoCol(baseLabel, fmtPeso(data.vatExclusiveBase ?? 0)), C.lf);
    parts.push(twoCol('PWD/SC Disc (20%)', `-${fmtPeso(data.discountOnBase)}`), C.lf);
    if (isVat && (data.vatRelief ?? 0) > 0) {
      parts.push(twoCol('VAT relief', `-${fmtPeso(data.vatRelief ?? 0)}`), C.lf);
    }
    if (data.pwdScIdOwnerName) p(txt(`  ID Holder: ${data.pwdScIdOwnerName}`));
    if (data.pwdScIdRef)       p(txt(`  ID No.: ${data.pwdScIdRef}`));
  } else if (data.discountAmount > 0) {
    parts.push(twoCol('Discount', `-${fmtPeso(data.discountAmount)}`), C.lf);
  }

  // VAT line — only for VAT-registered businesses
  if (isVat) {
    parts.push(twoCol('VAT (12%)', fmtPeso(data.vatAmount)), C.lf);
  }
  p(dash());

  // Grand total (double size)
  parts.push(C.boldOn, C.doubleOn);
  parts.push(twoCol('TOTAL', fmtPeso(data.totalAmount)), C.lf);
  parts.push(C.doubleOff, C.boldOff);

  p(dash());

  // ── Payments ────────────────────────────────────────────────────────────────
  for (const pay of data.payments) {
    const label = `${METHOD_LABELS[pay.method] ?? pay.method}${pay.reference ? ` #${pay.reference}` : ''}`;
    parts.push(twoCol(label, fmtPeso(pay.amount)), C.lf);
  }
  if (change > 0) {
    parts.push(C.boldOn);
    parts.push(twoCol('Change', fmtPeso(change)), C.lf);
    parts.push(C.boldOff);
  }

  p(C.lf);
  parts.push(C.alignCenter);
  p(txt(data.isOffline ? 'QUEUED - will sync on reconnect' : 'Thank you for your purchase!'));

  // ── BIR tax footer (RR No. 1-2026, Phase 2 only) ───────────────────────────
  if (!isPhase2) {
    // Phase 1 disclaimer — no BIR classification breakdown
    p(dash());
    parts.push(C.alignCenter);
    p(txt('THIS IS NOT A SALES INVOICE OR'));
    p(txt('OFFICIAL RECEIPT.'));
    p(txt('FOR INTERNAL MANAGEMENT USE ONLY.'));
    parts.push(C.alignLeft);
  } else if (isVat) {
    p(dash());
    // VATable Sales = totalAmount (gross, VAT-inclusive)
    const vatableSales    = data.totalAmount;
    const vatExcl         = Math.round((data.totalAmount / 1.12) * 100) / 100;
    const vatOnLocalSales = Math.round((data.totalAmount - vatExcl) * 100) / 100;
    parts.push(twoCol('VATable Sales', fmtPeso(vatableSales)), C.lf);
    parts.push(C.boldOn);
    parts.push(twoCol('VAT (12%)', fmtPeso(vatOnLocalSales > 0 ? vatOnLocalSales : data.vatAmount)), C.lf);
    parts.push(C.boldOff);
    parts.push(twoCol('VAT-Exempt Sales', fmtPeso(0)), C.lf);
    parts.push(twoCol('Zero-Rated Sales', fmtPeso(0)), C.lf);
  } else if (taxStatus === 'NON_VAT') {
    p(dash());
    p(txt('THIS DOCUMENT IS NOT VALID FOR'));
    p(txt('CLAIM OF INPUT TAX.'));
  }

  p(txt('Powered by Clerque Counter'));
  parts.push(C.feed3, C.cut);
  return concat(parts);
}

function buildShiftReport(data: PrintShiftData): Uint8Array {
  const parts: Uint8Array[] = [];
  const p = (...c: Uint8Array[]) => parts.push(...c, C.lf);
  const { shift } = data;
  const variance = shift.variance ?? 0;

  parts.push(C.init, C.alignCenter, C.doubleOn);
  p(txt('END-OF-SHIFT REPORT'));
  parts.push(C.doubleOff);
  p(txt(`${fmtDate(shift.openedAt)} - ${shift.closedAt ? fmtDate(shift.closedAt) : 'open'}`));
  p(C.lf);

  parts.push(C.alignLeft);
  p(dash());
  parts.push(C.boldOn); p(txt('SALES SUMMARY')); parts.push(C.boldOff);
  parts.push(twoCol('Total Orders', String(data.totalOrders)), C.lf);
  parts.push(twoCol('Voided', String(data.voidCount)), C.lf);
  parts.push(twoCol('Avg Order Value', fmtPeso(data.avgOrderValue)), C.lf);
  p(dash());
  parts.push(C.boldOn, C.doubleOn);
  parts.push(twoCol('TOTAL REVENUE', fmtPeso(data.totalRevenue)), C.lf);
  parts.push(C.doubleOff, C.boldOff);

  p(dash());
  parts.push(C.boldOn); p(txt('PAYMENT METHODS')); parts.push(C.boldOff);
  for (const pm of data.byPaymentMethod) {
    parts.push(twoCol(METHOD_LABELS[pm.method] ?? pm.method, fmtPeso(pm.totalAmount)), C.lf);
  }

  p(dash());
  parts.push(C.boldOn); p(txt('CASH RECONCILIATION')); parts.push(C.boldOff);
  parts.push(twoCol('Opening Cash', fmtPeso(shift.openingCash)), C.lf);
  parts.push(twoCol('+ Cash Sales', fmtPeso(data.cashRevenue)), C.lf);
  p(dash());
  parts.push(twoCol('Expected in Drawer', fmtPeso(shift.closingCashExpected ?? (shift.openingCash + data.cashRevenue))), C.lf);
  if (shift.closingCashDeclared != null) {
    parts.push(twoCol('Declared', fmtPeso(shift.closingCashDeclared)), C.lf);
    const varStr = variance === 0 ? 'BALANCED' : variance > 0 ? `+${fmtPeso(variance)} OVERAGE` : `${fmtPeso(variance)} SHORTAGE`;
    parts.push(C.boldOn);
    parts.push(twoCol('Variance', varStr), C.lf);
    parts.push(C.boldOff);
  }

  if (data.topProducts.length > 0) {
    p(dash());
    parts.push(C.boldOn); p(txt('TOP PRODUCTS')); parts.push(C.boldOff);
    data.topProducts.slice(0, 5).forEach((prod, i) => {
      const rank = `${i + 1}. ${prod.productName}`;
      const val  = `${prod.quantitySold}x ${fmtPeso(prod.revenue)}`;
      parts.push(twoCol(rank, val), C.lf);
    });
  }

  if (shift.notes) {
    p(dash());
    p(txt(`Notes: ${shift.notes}`));
  }

  parts.push(C.feed3, C.cut);
  return concat(parts);
}

// ── ThermalPrinterService ───────────────────────────────────────────────────────

export class ThermalPrinterService {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  /** True if Web Serial API is available in this browser */
  get isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  get isConnected(): boolean {
    return this.port !== null;
  }

  /**
   * Open a browser port picker and connect.
   * Returns `true` on success, `false` on cancel/error.
   */
  async connect(): Promise<boolean> {
    if (!this.isSupported) return false;
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: BAUD });
      this.writer = this.port.writable!.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
      return true;
    } catch {
      this.port = null;
      this.writer = null;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.writer) { this.writer.releaseLock(); this.writer = null; }
      if (this.port)   { await this.port.close();   this.port = null;  }
    } catch { /* ignore */ }
  }

  private async send(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Printer not connected');
    await this.writer.write(data);
  }

  async printReceipt(data: PrintReceiptData): Promise<void> {
    await this.send(buildReceipt(data));
  }

  async printShiftReport(data: PrintShiftData): Promise<void> {
    await this.send(buildShiftReport(data));
  }

  async printTest(): Promise<void> {
    const chunks: Uint8Array[] = [
      C.init, C.alignCenter, C.boldOn,
      txt('--- PRINTER TEST ---'), C.lf,
      C.boldOff,
      txt('Clerque Counter'), C.lf,
      txt(new Date().toLocaleString('en-PH')), C.lf,
      txt('Thermal printer OK'), C.lf,
      C.feed3, C.cut,
    ];
    await this.send(concat(chunks));
  }
}

/** Singleton instance — import this everywhere */
export const printer = new ThermalPrinterService();
