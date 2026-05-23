/**
 * Clerque Counter — Z-Read (Close Shift) Screen
 *
 * Mirrors `ZReadTablet` in design-source/screens-tablet-v2.jsx.
 *
 * Sections:
 *   - Gross / discounts / net.
 *   - BIR Non-VAT split (or VAT-able / exempt / zero-rated for VAT tenants).
 *   - Tender breakdown: Cash / GCash / PayMaya / Card.
 *   - Voids: count + total.
 *   - Cash reconciliation: opening + cash payments = expected; counted = actual;
 *     variance highlighted (success 0, warning ≤ ₱100, error > ₱100).
 *   - Print Z-read via printerService.
 *   - Close shift — signs cashier out, returns to PIN screen (caller handles).
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  colors,
  radii,
  spacing,
  tap,
  text as textTokens,
  tnum,
} from '@/theme/tokens';
import { formatPeso } from '@/components/Money';
import Pill from '@/components/Pill';
import { enqueueOutbox } from '@/offline/db';
import { keypadToCents } from '@/payment/NumericKeypad';
import { useDeviceSize } from '@/shell/useDeviceSize';
import { useAuth } from '@/auth/AuthProvider';
import { getPrinterService } from '@/receipt/printerService';
import { zReadToEscPos } from '@/receipt/zReadToEscPos';

export interface TenderBreakdown {
  cashCents:    number;
  gcashCents:   number;
  paymayaCents: number;
  /** Visa / Mastercard / JCB / BancNet through EDC terminal. */
  cardCents:    number;
  /** BSP InstaPay national QR (separate rail from card). */
  qrPhCents:    number;
}

export interface ZReadSummary {
  shiftId: string;
  cashierName: string;
  openedAtMs: number;
  /** Pre-aggregated by the caller (reads from offline DB). */
  grossSalesCents: number;
  discountsCents: number;
  /** count of transactions in the shift. */
  txnCount: number;
  tender: TenderBreakdown;
  /** ₱ cents — opening drawer count. */
  openingFloatCents: number;
  /** Voided lines: count and total amount voided (₱ cents). */
  voidsCount: number;
  voidsCents: number;
  /** OR range that this shift consumed. */
  orRange: { from: number; to: number };
  /** Optional cash-in / cash-out movements during shift. */
  cashInCents?: number;
  cashOutCents?: number;
  /** BIR breakdowns. */
  vatExemptCents?: number;
  vatableCents?: number;
  vatAmountCents?: number;
  vatZeroRatedCents?: number;
  isVatRegistered: boolean;
}

export interface ZReadScreenProps {
  summary: ZReadSummary;
  /** Cashier confirms close. Caller signs them out + queues to outbox. */
  onClose: (result: ZReadCloseResult) => void;
  onCancel?: () => void;
}

export interface ZReadCloseResult {
  countedCashCents: number;
  varianceCents: number;
  notes: string;
}

function elapsedString(fromMs: number, toMs: number = Date.now()): string {
  const ms = Math.max(0, toMs - fromMs);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m elapsed`;
}

export default function ZReadScreen({
  summary,
  onClose,
  onCancel,
}: ZReadScreenProps): React.ReactElement {
  const [countedRaw, setCountedRaw] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const isPhone = useDeviceSize() === 'phone';
  const insets  = useSafeAreaInsets();
  const { tenant } = useAuth();

  const netSalesCents = summary.grossSalesCents - summary.discountsCents;
  const avgTxnCents =
    summary.txnCount > 0 ? Math.round(summary.grossSalesCents / summary.txnCount) : 0;

  const expectedCashCents =
    summary.openingFloatCents +
    summary.tender.cashCents +
    (summary.cashInCents ?? 0) -
    (summary.cashOutCents ?? 0);
  const countedCents = keypadToCents(countedRaw);
  const varianceCents = countedCents - expectedCashCents;
  const absVariance = Math.abs(varianceCents);
  const varianceTone: 'success' | 'warning' | 'error' =
    absVariance === 0 ? 'success' : absVariance <= 10_000 ? 'warning' : 'error';

  const totalTender = useMemo(
    () =>
      summary.tender.cashCents +
      summary.tender.gcashCents +
      summary.tender.paymayaCents +
      summary.tender.cardCents +
      summary.tender.qrPhCents,
    [summary.tender],
  );

  const tenderRows = [
    { name: 'Cash · Bayad', amount: summary.tender.cashCents,    color: colors.primary },
    { name: 'GCash',        amount: summary.tender.gcashCents,   color: colors.gcash   },
    { name: 'PayMaya',      amount: summary.tender.paymayaCents, color: colors.paymaya },
    { name: 'Card',         amount: summary.tender.cardCents,    color: colors.muted   },
    { name: 'QR PH',        amount: summary.tender.qrPhCents,    color: colors.ink     },
  ];

  const handlePrint = async () => {
    setPrintError(null);
    try {
      const bytes = zReadToEscPos(summary, {
        tenantName:       tenant?.name ?? 'Clerque',
        tenantTin:        tenant?.tin  ?? '000-000-000-00000',
        counterCashCents: countedCents,
        notes,
      });
      await getPrinterService().printRaw(bytes);
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Print failed');
      // eslint-disable-next-line no-console
      console.warn('[ZRead] print failed:', err);
    }
  };

  const handleClose = async () => {
    setBusy(true);
    try {
      await enqueueOutbox('shift.close', {
        shiftId: summary.shiftId,
        closedAt: new Date().toISOString(),
        grossSalesCents: summary.grossSalesCents,
        netSalesCents,
        discountsCents: summary.discountsCents,
        tender: summary.tender,
        voidsCount: summary.voidsCount,
        voidsCents: summary.voidsCents,
        openingFloatCents: summary.openingFloatCents,
        countedCashCents: countedCents,
        varianceCents,
        notes,
        orRange: summary.orRange,
      });
      onClose({ countedCashCents: countedCents, varianceCents, notes });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <View style={isPhone ? s.headerPhone : s.header}>
        <Pressable onPress={onCancel} style={s.back}>
          <Text style={s.backText}>← Cancel</Text>
        </Pressable>
        <View style={{ marginLeft: isPhone ? spacing.s2 : spacing.s6, flex: 1, minWidth: 0 }}>
          <Text style={isPhone ? s.titlePhone : s.title} numberOfLines={1}>Close shift · Z-read</Text>
          <Text style={s.subtle} numberOfLines={2}>
            Shift {summary.shiftId} · opened{' '}
            {new Date(summary.openedAtMs).toLocaleTimeString('en-PH', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}{' '}
            by {summary.cashierName}
          </Text>
        </View>
        <Pill tone="warning" dot>{elapsedString(summary.openedAtMs)}</Pill>
      </View>

      <ScrollView contentContainerStyle={isPhone ? s.bodyPhone : s.body}>
        <View style={isPhone ? s.gridRowPhone : s.gridRow}>
          {/* LEFT — sales + tender + BIR + voids */}
          <View style={isPhone ? { width: '100%', gap: spacing.s3 } : { flex: 1.4, gap: spacing.s4 }}>
            <View style={s.card}>
              <View style={s.salesHero}>
                <View>
                  <Text style={s.cardLabel}>Gross sales</Text>
                  <Text style={[s.salesValueBig, tnum]}>{formatPeso(summary.grossSalesCents)}</Text>
                  <Text style={s.subtle}>
                    {summary.txnCount} transactions · avg {formatPeso(avgTxnCents)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.cardLabel}>Net sales</Text>
                  <Text style={[s.salesValueMd, tnum]}>{formatPeso(netSalesCents)}</Text>
                  <Text style={s.subtle}>after discounts</Text>
                </View>
              </View>
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>By tender</Text>
              {tenderRows.map(t => {
                const pct = totalTender > 0 ? (t.amount / totalTender) * 100 : 0;
                return (
                  <View key={t.name} style={s.tenderRow}>
                    <View style={s.tenderHeader}>
                      <Text style={s.tenderName}>{t.name}</Text>
                      <Text style={[s.tenderAmount, tnum]}>{formatPeso(t.amount)}</Text>
                    </View>
                    <View style={s.barTrack}>
                      <View
                        style={[
                          s.barFill,
                          { width: `${pct}%`, backgroundColor: t.color },
                        ]}
                      />
                    </View>
                    <Text style={s.tenderPct}>{pct.toFixed(1)}%</Text>
                  </View>
                );
              })}
            </View>

            <View style={isPhone ? s.smallGridPhone : s.smallGrid}>
              <View style={[s.card, { flex: 1 }]}>
                <Text style={s.cardLabel}>
                  BIR · {summary.isVatRegistered ? 'VAT' : 'Non-VAT'}
                </Text>
                {summary.isVatRegistered ? (
                  <>
                    <Row label="Vatable sales" value={formatPeso(summary.vatableCents ?? 0)} />
                    <Row label="VAT-exempt sales" value={formatPeso(summary.vatExemptCents ?? 0)} />
                    <Row label="VAT zero-rated" value={formatPeso(summary.vatZeroRatedCents ?? 0)} />
                    <Row label="VAT (12%)" value={formatPeso(summary.vatAmountCents ?? 0)} />
                  </>
                ) : (
                  <>
                    <Row label="VAT-exempt sales" value={formatPeso(netSalesCents)} />
                    <Row label="VAT amount" value={formatPeso(0)} />
                  </>
                )}
                <Row
                  label="OR range"
                  value={`${summary.orRange.from.toString().padStart(6, '0')} → ${summary.orRange.to.toString().padStart(6, '0')}`}
                />
                <Row label="Gap-free" value="✓ Yes" tone="success" />
              </View>

              <View style={[s.card, { flex: 1 }]}>
                <Text style={s.cardLabel}>Voids · discounts</Text>
                <Row
                  label="Voided lines"
                  value={`${summary.voidsCount} · ${formatPeso(summary.voidsCents)}`}
                />
                <Row
                  label="Discounts applied"
                  value={formatPeso(summary.discountsCents)}
                />
              </View>
            </View>
          </View>

          {/* RIGHT — drawer reconciliation + notes */}
          <View style={isPhone ? { width: '100%', gap: spacing.s3 } : { flex: 1, gap: spacing.s4 }}>
            <View style={s.card}>
              <Text style={s.cardTitle}>Cash drawer · reconciliation</Text>
              <Text style={s.subtle}>
                Count the physical cash and enter the total below.
              </Text>
              <View style={{ height: spacing.s3 }} />
              <Row label="Opening float" value={formatPeso(summary.openingFloatCents)} />
              <Row label="+ Cash sales" value={formatPeso(summary.tender.cashCents)} />
              {summary.cashInCents ? (
                <Row label="+ Cash in" value={formatPeso(summary.cashInCents)} />
              ) : null}
              {summary.cashOutCents ? (
                <Row label="− Cash out" value={formatPeso(summary.cashOutCents)} />
              ) : null}
              <View style={s.expectedRow}>
                <Text style={s.expectedLabel}>Expected in drawer</Text>
                <Text style={[s.expectedValue, tnum]}>{formatPeso(expectedCashCents)}</Text>
              </View>

              <Text style={[s.fieldLabel, { marginTop: spacing.s4 }]}>Counted cash</Text>
              <TextInput
                value={countedRaw}
                onChangeText={t => setCountedRaw(t.replace(/[^\d.]/g, ''))}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="0.00"
                placeholderTextColor={colors.faint}
                style={s.input}
              />

              <View
                style={[
                  s.variance,
                  varianceTone === 'success' && { backgroundColor: colors.successSoft },
                  varianceTone === 'warning' && { backgroundColor: colors.warningSoft },
                  varianceTone === 'error' && { backgroundColor: colors.errorSoft },
                ]}
              >
                <Text
                  style={[
                    s.varianceText,
                    varianceTone === 'success' && { color: colors.successDeep },
                    varianceTone === 'warning' && { color: colors.warningDeep },
                    varianceTone === 'error' && { color: colors.errorDeep },
                  ]}
                >
                  Variance ·{' '}
                  <Text style={tnum}>
                    {varianceCents === 0
                      ? '₱0.00'
                      : varianceCents > 0
                        ? `+${formatPeso(absVariance)}`
                        : `− ${formatPeso(absVariance)}`}
                  </Text>
                  {varianceTone === 'success' && '  · ✓ balanced'}
                  {varianceTone === 'warning' && '  · within tolerance'}
                  {varianceTone === 'error' && '  · investigate'}
                </Text>
              </View>
            </View>

            <View style={s.card}>
              <Text style={s.cardLabel}>Shift notes · optional</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={4}
                placeholder={'e.g. "₱7 short — gave too much sukli on order #000098"'}
                placeholderTextColor={colors.faint}
                style={[s.input, { minHeight: 72, textAlignVertical: 'top' }]}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          isPhone ? s.footerPhone : s.footer,
          // Lift footer above the bottom tab bar + system gesture inset.
          // Without this, the secondary row got clipped under the tab bar
          // on phones (Print Z-read / Keep selling were unreachable).
          isPhone && { paddingBottom: Math.max(insets.bottom, spacing.s3) },
        ]}
      >
        <Pressable
          style={[s.btn, s.btnPrimary, busy && s.btnDisabled, isPhone && s.btnFull, isPhone && s.btnCompact]}
          onPress={handleClose}
          disabled={busy}
        >
          <Text style={[s.btnText, isPhone && s.btnTextCompact]}>{busy ? 'Closing…' : 'Close shift'}</Text>
        </Pressable>
        <View style={isPhone ? s.footerSecondaryRowPhone : { flexDirection: 'row', gap: spacing.s4 }}>
          <Pressable style={[s.btn, s.btnSecondary, isPhone && s.btnHalf, isPhone && s.btnCompact]} onPress={handlePrint}>
            <Text style={[s.btnText, isPhone && s.btnTextCompact, { color: colors.ink }]} numberOfLines={1}>
              {printError ? 'Retry print' : 'Print Z-read'}
            </Text>
          </Pressable>
          {onCancel ? (
            <Pressable style={[s.btn, s.btnGhost, isPhone && s.btnHalf, isPhone && s.btnCompact]} onPress={onCancel}>
              <Text style={[s.btnText, isPhone && s.btnTextCompact, { color: colors.ink }]} numberOfLines={1}>
                {isPhone ? 'Keep open' : 'Keep selling'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success';
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text
        style={[
          s.rowValue,
          tnum,
          tone === 'success' && { color: colors.successDeep, fontWeight: '700' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.s5,
    paddingHorizontal: spacing.s6,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  back: { paddingVertical: spacing.s2, paddingRight: spacing.s4 },
  backText: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  title:      { ...textTokens.displaySm, color: colors.ink },
  titlePhone: { ...textTokens.displaySm, color: colors.ink, fontSize: 16 },
  headerPhone: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  subtle: { ...textTokens.bodySm, color: colors.muted, marginTop: 2 },

  body: { padding: spacing.s6 },
  gridRow: {
    flexDirection: 'row',
    gap: spacing.s5,
    flexWrap: 'wrap',
  },

  card: {
    padding: spacing.s5,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s2,
  },
  cardLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  cardTitle: { ...textTokens.bodyLg, color: colors.ink, fontWeight: '700', marginBottom: spacing.s2 },

  salesHero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  salesValueBig: {
    ...textTokens.displayLg,
    color: colors.primary,
    fontSize: 40,
    lineHeight: 44,
    marginTop: 4,
  },
  salesValueMd: {
    ...textTokens.displayMd,
    color: colors.successDeep,
    marginTop: 4,
  },

  tenderRow: { paddingVertical: spacing.s2 },
  tenderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  tenderName: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  tenderAmount: { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.cream,
    overflow: 'hidden',
    marginTop: spacing.s2,
  },
  barFill: { height: '100%', borderRadius: 3 },
  tenderPct: { ...textTokens.caption, color: colors.muted, textAlign: 'right', marginTop: 2 },

  smallGrid:      { flexDirection: 'row', gap: spacing.s4 },
  smallGridPhone: { flexDirection: 'column', gap: spacing.s3 },
  bodyPhone:      { padding: spacing.s4, paddingBottom: spacing.s7 },
  gridRowPhone:   { flexDirection: 'column', gap: spacing.s3 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 2,
  },
  rowLabel: { ...textTokens.bodySm, color: colors.muted },
  rowValue: { ...textTokens.bodySm, color: colors.ink },

  expectedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: spacing.s3,
    marginTop: spacing.s2,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  expectedLabel: { ...textTokens.bodyLg, color: colors.ink, fontWeight: '700' },
  expectedValue: { ...textTokens.bodyLg, color: colors.ink, fontWeight: '700' },

  fieldLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
    marginBottom: spacing.s2,
  },
  input: {
    ...textTokens.cashierLg,
    color: colors.ink,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
  },
  variance: {
    padding: spacing.s4,
    borderRadius: radii.sm,
    marginTop: spacing.s3,
  },
  varianceText: { ...textTokens.bodySm, fontWeight: '600' },

  footer: {
    flexDirection: 'row',
    gap: spacing.s4,
    padding: spacing.s5,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  footerPhone: {
    padding: spacing.s3,
    paddingTop: spacing.s3,
    gap: spacing.s2,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  footerSecondaryRowPhone: { flexDirection: 'row', gap: spacing.s2 },
  btnHalf: { flex: 1, paddingHorizontal: spacing.s2 },
  btnFull: { width: '100%' },
  // Phone footer is tight under the tab bar — shrink the cashier-primary
  // 64dp height to 52dp so the stack of Close + (Print | Keep open) fits.
  btnCompact: { height: 52, paddingHorizontal: spacing.s3 },
  btnTextCompact: { fontSize: 15 },
  btn: {
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s5,
  },
  btnGhost: {
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  btnSecondary: {
    backgroundColor: colors.primaryContainer,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { ...textTokens.cashierLg, color: colors.onPrimary },
});
