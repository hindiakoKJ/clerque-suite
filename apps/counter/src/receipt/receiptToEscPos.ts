/**
 * Clerque Counter — Receipt → ESC/POS bytes
 *
 * Pure transform: takes a `ReceiptForPrinter` payload (the same data the
 * visual `Receipt.tsx` consumes) and emits the raw byte sequence for a
 * thermal printer. Mirrors the visual layout — header, OR# huge, lines
 * with right-aligned prices, totals, payments, bilingual footer.
 *
 * Width defaults to 32 columns (58 mm — the cheap PH standard). Pass 48
 * for an 80 mm printer.
 */

import { EscPosBuilder } from './EscPosBuilder';
import { getWebHost } from '@/api/webOrigin';
import type {
  CartLine,
  CartPayment,
  CartState,
  TenantConfig,
} from '@/types';
import type { ReceiptVatBreakdown } from './Receipt';

/** Serializable shape of what `Receipt.tsx` consumes — safe to send over IPC / store in queues. */
export interface ReceiptForPrinter {
  tenant: TenantConfig;
  cart: CartState;
  orNumber: number;
  issuedAt: number;
  cashierName: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payments: CartPayment[];
  changeCents: number;
  vat?: ReceiptVatBreakdown;
  isRefund?: boolean;
  originalOrNumber?: number;
}

export type ReceiptWidth = 32 | 48;

function pad6(n: number): string {
  return n.toString().padStart(6, '0');
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const dd = d.getDate().toString().padStart(2, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mm = MONTHS[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  return `${dd} ${mm} ${yyyy} ${hh}:${mi}`;
}

function methodLabel(m: CartPayment['method']): string {
  switch (m) {
    case 'CASH': return 'Cash';
    case 'GCASH': return 'GCash';
    case 'PAYMAYA': return 'PayMaya';
    case 'CARD': return 'Card';
    case 'OTHER': return 'Other';
  }
}

function formatPesoPlain(cents: number): string {
  const value = cents / 100;
  return value.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Fixed-width row: label left, amount right, padded with spaces. */
function labelAmount(label: string, amount: string, width: number): string {
  const right = amount;
  const space = Math.max(1, width - label.length - right.length);
  if (space < 1) {
    // Label too long — truncate.
    const max = Math.max(0, width - right.length - 1);
    return `${label.slice(0, max)} ${right}`;
  }
  return `${label}${' '.repeat(space)}${right}`;
}

/** Cart line: "2x Product Name ......... 99.00", with name wrapping. */
function itemRow(line: CartLine, width: number): string[] {
  const qty = `${line.qty}x `;
  const name = `${line.productName}${line.variantName ? ` · ${line.variantName}` : ''}`;
  const price = formatPesoPlain(line.lineTotal);
  const leftBudget = width - price.length - 1;
  const fullLeft = `${qty}${name}`;

  if (fullLeft.length <= leftBudget) {
    return [labelAmount(fullLeft, price, width)];
  }

  // Wrap the name onto continuation lines.
  const rows: string[] = [];
  const indent = ' '.repeat(qty.length);
  let remaining = fullLeft;
  let first = true;
  while (remaining.length > 0) {
    const slice = remaining.slice(0, leftBudget);
    if (first) {
      // Reserve the right column for the price on the first row only.
      rows.push(labelAmount(slice, price, width));
      first = false;
    } else {
      rows.push(slice);
    }
    remaining = remaining.slice(leftBudget);
    if (!first && remaining.length > 0) {
      remaining = indent + remaining;
    }
  }
  return rows;
}

function paymentsHaveCash(payments: CartPayment[]): boolean {
  return payments.some(p => p.method === 'CASH');
}

export function receiptToEscPos(
  r: ReceiptForPrinter,
  width: ReceiptWidth = 32,
): Uint8Array {
  const b = new EscPosBuilder();
  const isVat = r.tenant.taxStatus === 'VAT' && r.tenant.isVatRegistered;

  b.init();

  // ── HEADER ─────────────────────────────────────────────
  b.align('C').bold(true).doubleHeight(true);
  b.line(r.tenant.name.toUpperCase());
  b.doubleHeight(false).bold(false);

  if (r.tenant.receiptHeaderNote) {
    b.line(r.tenant.receiptHeaderNote);
  }
  b.line(`TIN ${r.tenant.tin}`);
  b.line(isVat ? 'VAT-registered' : 'Non-VAT registered');
  b.line('Pang-opisyal na Resibo');

  if (r.isRefund) {
    b.bold(true);
    b.line(`REFUND vs OR #${r.originalOrNumber ? pad6(r.originalOrNumber) : '------'}`);
    b.bold(false);
  }

  // OR# huge — double width + double height.
  b.bold(true).doubleHeight(true).doubleWidth(true);
  b.line(`OR #${pad6(r.orNumber)}`);
  b.doubleHeight(false).doubleWidth(false).bold(false);

  b.line(formatDateTime(r.issuedAt));
  b.line(`Cashier: ${r.cashierName}`);

  b.align('L');
  b.divider('-', width);

  // ── LINES ──────────────────────────────────────────────
  for (const line of r.cart.lines) {
    const rows = itemRow(line, width);
    for (const row of rows) b.line(row);

    if (line.modifiers.length > 0) {
      const mods = line.modifiers
        .map(m => `${m.optionName}${m.priceAdjustment ? ` +${formatPesoPlain(m.priceAdjustment)}` : ''}`)
        .join(' · ');
      // Indent mods under the qty column.
      b.line(`  ${mods}`.slice(0, width));
    }
    if (line.voidedAt) {
      b.bold(true);
      b.line(`  VOID - ${line.voidReason ?? 'no reason'}`.slice(0, width));
      b.bold(false);
    }
  }

  b.divider('-', width);

  // ── TOTALS ─────────────────────────────────────────────
  b.line(labelAmount('Subtotal', formatPesoPlain(r.subtotalCents), width));

  if (r.discountCents > 0) {
    const discLabel = r.cart.pwdScId
      ? `${r.cart.pwdScId.kind === 'SENIOR' ? 'Senior' : 'PWD'} disc (20%)`
      : 'Discount';
    b.line(labelAmount(discLabel, `- ${formatPesoPlain(r.discountCents)}`, width));
  }

  if (isVat && r.vat) {
    b.line(labelAmount('Vatable sales', formatPesoPlain(r.vat.vatableSalesCents), width));
    b.line(labelAmount('VAT-exempt sales', formatPesoPlain(r.vat.vatExemptCents), width));
    b.line(labelAmount('VAT zero-rated', formatPesoPlain(r.vat.vatZeroRatedCents), width));
    b.line(labelAmount('VAT (12%)', formatPesoPlain(r.vat.vatAmountCents), width));
  } else {
    b.line(labelAmount('VAT-exempt sales', formatPesoPlain(r.totalCents), width));
  }

  b.divider('-', width);

  // TOTAL — bold + double height for visibility.
  b.bold(true).doubleHeight(true);
  b.line(labelAmount('TOTAL', formatPesoPlain(r.totalCents), Math.floor(width / 2)));
  b.doubleHeight(false).bold(false);

  // ── PAYMENTS ───────────────────────────────────────────
  for (const p of r.payments) {
    b.line(labelAmount(methodLabel(p.method), formatPesoPlain(p.amount), width));
    if (p.reference) {
      b.line(`  Ref: ${p.reference}`.slice(0, width));
    }
  }
  b.line(labelAmount('Change / Sukli', formatPesoPlain(r.changeCents), width));

  // ── SENIOR / PWD ATTESTATION ───────────────────────────
  if (r.cart.pwdScId) {
    b.divider('-', width);
    b.line(`${r.cart.pwdScId.kind === 'SENIOR' ? 'Senior ID' : 'PWD ID'}: ${r.cart.pwdScId.idRef}`);
    b.line(`Name: ${r.cart.pwdScId.ownerName}`);
    b.line('Signature: ____________________');
  }

  b.divider('-', width);

  // ── FOOTER ─────────────────────────────────────────────
  b.align('C');
  b.bold(true).line('Salamat po · Thank you!');
  b.bold(false);

  if (r.tenant.planFeatures.receiptCustomization !== 'none' && r.tenant.receiptFooterNote) {
    b.line(r.tenant.receiptFooterNote);
  }
  b.line('Powered by Clerque');
  b.line(getWebHost());
  b.line('Official Receipt · Pang-opisyal na Resibo');

  b.align('L').feed(3);

  // Cash drawer for cash payments (after print so the receipt comes out first).
  if (paymentsHaveCash(r.payments)) {
    b.openCashDrawer();
  }

  b.cut();
  return b.build();
}
