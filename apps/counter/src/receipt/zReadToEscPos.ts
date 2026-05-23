/**
 * Build an ESC/POS byte stream for a BIR-compliant Z-read printout.
 *
 * BIR rules implemented:
 *   • Z-read header reads "Z-READ" + sequence number — at close-of-shift.
 *   • Cashier name + shift open/close timestamps + OR range.
 *   • VAT breakdown (or Non-VAT breakdown) — required on Z-read.
 *   • Tender breakdown by method (cash / GCash / Maya / card).
 *   • Voids count + value.
 *   • Drawer reconciliation: opening float, cash sales, expected vs counted,
 *     variance.
 *   • Cashier signature line, BIR Accreditation footer.
 */
import { EscPosBuilder } from './EscPosBuilder';
import type { ZReadSummary } from '@/shift/ZReadScreen';

const WIDTH = 32; // 58mm printer; 80mm uses 48 — runtime override later

function pesos(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}P ${(Math.abs(cents) / 100).toFixed(2)}`;
}

function row(label: string, value: string, width: number = WIDTH): string {
  const space = Math.max(1, width - label.length - value.length);
  return `${label}${' '.repeat(space)}${value}`;
}

export interface ZReadPrintContext {
  tenantName:        string;
  tenantTin:         string;
  tenantAddress?:    string;
  birAccreditation?: string;
  counterCashCents:  number;
  notes?:            string;
}

export function zReadToEscPos(
  summary: ZReadSummary,
  ctx: ZReadPrintContext,
): Uint8Array {
  const b = new EscPosBuilder().init();

  // ── Header ────────────────────────────────────────────────────
  b.align('C').bold(true).doubleHeight(true);
  b.line(ctx.tenantName.toUpperCase());
  b.doubleHeight(false).bold(false);
  if (ctx.tenantAddress) b.line(ctx.tenantAddress);
  b.line(`TIN ${ctx.tenantTin}`);
  b.feed(1);
  b.bold(true).line('Z-READ').bold(false);
  b.line(summary.isVatRegistered ? 'VAT Registered' : 'Non-VAT Registered');

  b.align('L');
  b.divider('=');
  b.line(row('Shift', summary.shiftId.slice(-12)));
  b.line(row('Cashier', summary.cashierName));
  b.line(row('Opened', new Date(summary.openedAtMs).toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour12: false })));
  b.line(row('Closed', new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour12: false })));
  b.line(row('OR range',
    `${summary.orRange.from.toString().padStart(6, '0')}–${summary.orRange.to.toString().padStart(6, '0')}`));
  b.divider('=');

  // ── Sales totals ──────────────────────────────────────────────
  const net = summary.grossSalesCents - summary.discountsCents;
  b.bold(true).line('SALES').bold(false);
  b.line(row('Transactions', String(summary.txnCount)));
  b.line(row('Gross sales',  pesos(summary.grossSalesCents)));
  b.line(row('Discounts',    pesos(-summary.discountsCents)));
  b.line(row('Net sales',    pesos(net)));
  b.divider('-');

  // ── BIR breakdown ─────────────────────────────────────────────
  b.bold(true).line(summary.isVatRegistered ? 'VAT BREAKDOWN' : 'NON-VAT BREAKDOWN').bold(false);
  if (summary.isVatRegistered) {
    b.line(row('VATable sales',   pesos(summary.vatableCents ?? 0)));
    b.line(row('VAT-exempt',      pesos(summary.vatExemptCents ?? 0)));
    b.line(row('VAT zero-rated',  pesos(summary.vatZeroRatedCents ?? 0)));
    b.line(row('VAT (12%)',       pesos(summary.vatAmountCents ?? 0)));
  } else {
    b.line(row('VAT-exempt sales', pesos(net)));
    b.line(row('VAT amount',       pesos(0)));
  }
  b.divider('-');

  // ── Tender breakdown ──────────────────────────────────────────
  b.bold(true).line('TENDER').bold(false);
  b.line(row('Cash',    pesos(summary.tender.cashCents)));
  b.line(row('GCash',   pesos(summary.tender.gcashCents)));
  b.line(row('PayMaya', pesos(summary.tender.paymayaCents)));
  b.line(row('Card',    pesos(summary.tender.cardCents)));
  b.line(row('QR PH',   pesos(summary.tender.qrPhCents)));
  b.divider('-');

  // ── Voids ─────────────────────────────────────────────────────
  b.line(row('Voids',          `${summary.voidsCount} · ${pesos(summary.voidsCents)}`));
  b.divider('-');

  // ── Drawer reconciliation ─────────────────────────────────────
  const expected = summary.openingFloatCents
    + summary.tender.cashCents
    + (summary.cashInCents ?? 0)
    - (summary.cashOutCents ?? 0);
  const variance = ctx.counterCashCents - expected;
  b.bold(true).line('DRAWER').bold(false);
  b.line(row('Opening float',  pesos(summary.openingFloatCents)));
  b.line(row('+ Cash sales',   pesos(summary.tender.cashCents)));
  if (summary.cashInCents)  b.line(row('+ Cash in',   pesos(summary.cashInCents)));
  if (summary.cashOutCents) b.line(row('- Cash out',  pesos(summary.cashOutCents)));
  b.line(row('Expected',       pesos(expected)));
  b.line(row('Counted',        pesos(ctx.counterCashCents)));
  b.bold(true).line(row(
    variance === 0 ? 'BALANCED ✓' : variance > 0 ? 'OVER' : 'SHORT',
    pesos(Math.abs(variance)),
  )).bold(false);
  b.divider('=');

  // ── Notes ─────────────────────────────────────────────────────
  if (ctx.notes && ctx.notes.trim()) {
    b.line('Notes:');
    b.line(ctx.notes.trim().slice(0, 200));
    b.feed(1);
  }

  // ── Sign-off ──────────────────────────────────────────────────
  b.line('Cashier signature:');
  b.feed(2);
  b.line('___________________________');
  b.feed(1);
  b.line('Supervisor signature:');
  b.feed(2);
  b.line('___________________________');
  b.feed(1);

  // ── Footer ────────────────────────────────────────────────────
  b.align('C');
  if (ctx.birAccreditation) b.line(`BIR ${ctx.birAccreditation}`);
  b.line('— END OF Z-READ —');
  b.feed(2);
  b.cut();
  return b.build();
}
