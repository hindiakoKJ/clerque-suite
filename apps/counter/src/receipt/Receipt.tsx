/**
 * Clerque Counter — Receipt
 *
 * The visual receipt — rendered ONCE and used for both screen preview and the
 * printer path. For V1 the printer path emits a PDF via expo-print as a
 * fallback; the ESC/POS-over-Bluetooth path lands next sprint.
 *
 * Layout mirrors `ReceiptTablet` in design-source/screens-tablet-v2.jsx.
 *
 * BIR notes baked in:
 *   - OR number rendered HUGE at the top in mono tabular-nums (≥32pt).
 *   - Non-VAT registered: prints "Non-VAT registered" line; no VAT breakdown.
 *   - VAT-registered: prints vatable / vat-exempt / vat-amount split.
 *   - Voided lines stay in sequence, struck-through (audit requirement).
 *   - Senior/PWD ID and owner name + signature line print.
 *   - Closing line bilingual: "official receipt — Pang-opisyal na Resibo".
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import {
  colors,
  fonts,
  radii,
  spacing,
  text as textTokens,
  tnum,
} from '@/theme/tokens';
import type {
  CartLine,
  CartPayment,
  CartState,
  TenantConfig,
} from '@/types';
import { formatPeso } from '@/components/Money';
import { getWebHost } from '@/api/webOrigin';

export interface ReceiptVatBreakdown {
  /** ₱ cents — vatable net base (excludes VAT). */
  vatableSalesCents: number;
  /** ₱ cents — VAT-exempt (Senior/PWD/PWD-applicable). */
  vatExemptCents: number;
  /** ₱ cents — Zero-rated. */
  vatZeroRatedCents: number;
  /** ₱ cents — VAT amount (12%). */
  vatAmountCents: number;
}

export interface ReceiptProps {
  tenant: TenantConfig;
  cart: CartState;
  /** OR number assigned by the BIR sequence (gap-free). */
  orNumber: number;
  /** Issued-at timestamp (ms epoch). */
  issuedAt: number;
  cashierName: string;
  /** Pre-computed totals — kept off the component so it stays presentational. */
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** Payments captured on this order. */
  payments: CartPayment[];
  /** Change due (₱ cents) — only meaningful for cash. */
  changeCents: number;
  vat?: ReceiptVatBreakdown;
  /** Marks a refund receipt — adds REFUND header + links original OR. */
  isRefund?: boolean;
  /** When `isRefund`, the OR this refund references. */
  originalOrNumber?: number;
}

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
  return `${dd} ${mm} ${yyyy} · ${hh}:${mi}`;
}

function methodLabel(m: CartPayment['method']): string {
  switch (m) {
    case 'CASH': return 'Cash · Bayad';
    case 'GCASH': return 'GCash';
    case 'PAYMAYA': return 'PayMaya';
    case 'CARD': return 'Card';
    case 'OTHER': return 'Other';
  }
}

function LineRow({
  line,
}: { line: CartLine }) {
  const voided = !!line.voidedAt;
  return (
    <View style={s.lineWrap}>
      <View style={s.row}>
        <Text
          style={[
            s.itemText,
            voided && s.struck,
            { flex: 1 },
          ]}
        >
          {line.qty}× {line.productName}
          {line.variantName ? ` · ${line.variantName}` : ''}
        </Text>
        <Text style={[s.itemText, voided && s.struck, tnum]}>
          {formatPeso(line.lineTotal)}
        </Text>
      </View>
      {line.modifiers.length > 0 && (
        <Text style={[s.modText, voided && s.struck]}>
          {line.modifiers
            .map(m => `${m.optionName}${m.priceAdjustment ? ` +${formatPeso(m.priceAdjustment, { noSymbol: true })}` : ''}`)
            .join(' · ')}
        </Text>
      )}
      {voided && (
        <Text style={s.voidText}>
          VOID · {line.voidReason ?? 'no reason'}
        </Text>
      )}
    </View>
  );
}

export default function Receipt({
  tenant,
  cart,
  orNumber,
  issuedAt,
  cashierName,
  subtotalCents,
  discountCents,
  totalCents,
  payments,
  changeCents,
  vat,
  isRefund,
  originalOrNumber,
}: ReceiptProps): React.ReactElement {
  const isVat = tenant.taxStatus === 'VAT' && tenant.isVatRegistered;
  /** BIR-registered tenants (VAT or Non-VAT) issue Official Receipts.
   *  UNREGISTERED tenants must label every slip "Acknowledgement Receipt"
   *  per BIR rules — they cannot use the OR series number.  */
  const isBirRegistered = tenant.taxStatus === 'VAT' || tenant.taxStatus === 'NON_VAT';
  const receiptKind     = isBirRegistered ? 'Official Receipt' : 'Acknowledgement Receipt';
  const receiptKindFil  = isBirRegistered ? 'Pang-opisyal na Resibo' : 'Resibo ng Pagtanggap';
  /** Display label for the giant receipt number. ORs use the "OR #" prefix
   *  per BIR conventions; ARs use "AR #" to avoid impersonating an OR. */
  const numberPrefix    = isBirRegistered ? 'OR' : 'AR';

  return (
    <View style={s.paper}>
      {/* HEADER */}
      <View style={s.center}>
        <Text style={s.bizName}>{tenant.name.toUpperCase()}</Text>
        {tenant.receiptHeaderNote ? (
          <Text style={s.meta}>{tenant.receiptHeaderNote}</Text>
        ) : null}
        <Text style={s.meta}>
          {tenant.tin ? `TIN ${tenant.tin} · ` : ''}
          {isBirRegistered ? (isVat ? 'VAT-registered' : 'Non-VAT registered') : 'Not BIR-registered'}
        </Text>
        <Text style={s.metaSmall}>{receiptKindFil}</Text>
        {isRefund && (
          <Text style={s.refundBanner}>REFUND · against {numberPrefix} # {originalOrNumber ? pad6(originalOrNumber) : '------'}</Text>
        )}
        <Text style={s.orHuge}>{numberPrefix} # {pad6(orNumber)}</Text>
        <Text style={s.meta}>
          {formatDateTime(issuedAt)} · Cashier {cashierName}
        </Text>
      </View>

      <View style={s.hr} />

      {/* LINES */}
      {cart.lines.map(line => (
        <LineRow key={line.id} line={line} />
      ))}

      <View style={s.hr} />

      {/* TOTALS */}
      <View style={s.row}>
        <Text style={s.totalsLabel}>Subtotal</Text>
        <Text style={[s.totalsLabel, tnum]}>{formatPeso(subtotalCents)}</Text>
      </View>
      {discountCents > 0 && (
        <View style={s.row}>
          <Text style={s.totalsLabel}>
            {cart.pwdScId
              ? `${cart.pwdScId.kind === 'SENIOR' ? 'Senior' : 'PWD'} disc (20%)`
              : 'Discount'}
          </Text>
          <Text style={[s.totalsLabel, tnum]}>− {formatPeso(discountCents)}</Text>
        </View>
      )}

      {isVat && vat ? (
        <>
          <View style={s.row}>
            <Text style={s.totalsLabel}>Vatable sales</Text>
            <Text style={[s.totalsLabel, tnum]}>{formatPeso(vat.vatableSalesCents)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.totalsLabel}>VAT-exempt sales</Text>
            <Text style={[s.totalsLabel, tnum]}>{formatPeso(vat.vatExemptCents)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.totalsLabel}>VAT zero-rated</Text>
            <Text style={[s.totalsLabel, tnum]}>{formatPeso(vat.vatZeroRatedCents)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.totalsLabel}>VAT (12%)</Text>
            <Text style={[s.totalsLabel, tnum]}>{formatPeso(vat.vatAmountCents)}</Text>
          </View>
        </>
      ) : (
        <View style={s.row}>
          <Text style={s.totalsLabel}>VAT-exempt sales</Text>
          <Text style={[s.totalsLabel, tnum]}>{formatPeso(totalCents)}</Text>
        </View>
      )}

      <View style={s.hr} />
      <View style={s.row}>
        <Text style={s.totalBig}>TOTAL</Text>
        <Text style={[s.totalBig, tnum]}>{formatPeso(totalCents)}</Text>
      </View>

      {/* PAYMENTS */}
      {payments.map((p, i) => (
        <View key={i}>
          <View style={s.row}>
            <Text style={s.totalsLabel}>{methodLabel(p.method)}</Text>
            <Text style={[s.totalsLabel, tnum]}>{formatPeso(p.amount)}</Text>
          </View>
          {p.reference ? (
            <View style={s.row}>
              <Text style={s.metaSmall}>Ref</Text>
              <Text style={[s.metaSmall, tnum]}>{p.reference}</Text>
            </View>
          ) : null}
        </View>
      ))}
      <View style={s.row}>
        <Text style={s.totalsLabel}>Sukli · Change</Text>
        <Text style={[s.totalsLabel, tnum]}>{formatPeso(changeCents)}</Text>
      </View>

      {/* SENIOR / PWD ATTESTATION */}
      {cart.pwdScId && (
        <>
          <View style={s.hr} />
          <Text style={s.metaSmall}>
            {cart.pwdScId.kind === 'SENIOR' ? 'Senior ID' : 'PWD ID'}: {cart.pwdScId.idRef}
          </Text>
          <Text style={s.metaSmall}>Name: {cart.pwdScId.ownerName}</Text>
          <Text style={s.metaSmall}>Signature: _____________________</Text>
        </>
      )}

      <View style={s.hr} />

      {/* FOOTER */}
      <View style={s.center}>
        <Text style={s.thanksBold}>Salamat po · Thank you!</Text>
        {tenant.planFeatures.receiptCustomization !== 'none' && tenant.receiptFooterNote ? (
          <Text style={s.metaSmall}>{tenant.receiptFooterNote}</Text>
        ) : null}
        <Text style={s.metaSmall}>Powered by Clerque · {getWebHost()}</Text>
        <Text style={s.closingLine}>
          This serves as an {receiptKind.toLowerCase()} — {receiptKindFil}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  paper: {
    width: 360,
    padding: spacing.s6,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    alignSelf: 'center',
    gap: 2,
  },
  center: {
    alignItems: 'center',
    gap: 2,
  },
  bizName: {
    ...textTokens.displaySm,
    fontWeight: '800',
    color: colors.ink,
    textAlign: 'center',
  },
  meta: {
    ...textTokens.caption,
    color: colors.muted,
    textAlign: 'center',
  },
  metaSmall: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  orHuge: {
    fontFamily: fonts.mono,
    fontSize: 32,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.5,
    marginVertical: spacing.s2,
    fontVariant: ['tabular-nums'],
  },
  refundBanner: {
    ...textTokens.caption,
    color: colors.errorDeep,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: spacing.s2,
  },
  hr: {
    height: 1,
    backgroundColor: colors.rule,
    marginVertical: spacing.s3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 2,
  },
  lineWrap: {
    marginBottom: spacing.s2,
  },
  itemText: {
    ...textTokens.bodySm,
    color: colors.ink,
  },
  modText: {
    ...textTokens.caption,
    color: colors.muted,
    paddingLeft: spacing.s3,
    marginTop: 2,
  },
  voidText: {
    ...textTokens.caption,
    color: colors.errorDeep,
    fontWeight: '700',
    paddingLeft: spacing.s3,
    marginTop: 2,
  },
  struck: {
    textDecorationLine: 'line-through',
    color: colors.faint,
  },
  totalsLabel: {
    ...textTokens.bodySm,
    color: colors.ink,
  },
  totalBig: {
    ...textTokens.displaySm,
    color: colors.ink,
    fontWeight: '800',
  },
  thanksBold: {
    ...textTokens.bodySm,
    color: colors.ink,
    fontWeight: '700',
  },
  closingLine: {
    ...textTokens.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.s2,
  },
});
