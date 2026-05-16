/**
 * Clerque Counter — Cash tab
 *
 * Matches the `TenderingCash` design in screens-tablet-v2.jsx.
 * Layout:
 *   left col — Bayad (huge) + Sukli card (green when complete, red when short)
 *              + quick totals summary.
 *   right col — large numeric keypad + quick-amount denominations + Exact CTA.
 *
 * The Confirm CTA lives outside this component (in TenderingScreen) so the
 * cashier sees one global "Confirm" no matter which tab is active.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  radii,
  spacing,
  text as textTokens,
  tnum,
} from '@/theme/tokens';
import { formatPeso } from '@/components/Money';
import NumericKeypad, { keypadToCents } from './NumericKeypad';
import type { CartPayment } from '@/types';

export interface CashTabProps {
  totalCents: number;
  /** Called when cashier confirms. Returns the CartPayment to attach. */
  onConfirm: (p: CartPayment, changeCents: number) => void;
  /** Bayad initial value (display string). */
  initialValue?: string;
}

const QUICK_AMOUNTS_CENTS = [2000, 5000, 10000, 20000, 50000, 100000];

export default function CashTab({
  totalCents,
  onConfirm,
  initialValue = '',
}: CashTabProps): React.ReactElement {
  const [raw, setRaw] = useState(initialValue);
  const bayadCents = useMemo(() => keypadToCents(raw), [raw]);
  const changeCents = bayadCents - totalCents;
  const isShort = bayadCents < totalCents;
  const isExact = bayadCents === totalCents;
  const ready = bayadCents >= totalCents && bayadCents > 0;

  const setExact = () => setRaw((totalCents / 100).toFixed(2));
  const addQuick = (cents: number) => setRaw((cents / 100).toFixed(2));

  return (
    <View style={s.row}>
      {/* LEFT — Bayad + Sukli + summary */}
      <View style={s.left}>
        <View style={s.bayadCard}>
          <Text style={s.cardLabel}>Bayad · Cash received</Text>
          <Text style={[s.bayadValue, tnum]}>{formatPeso(bayadCents)}</Text>
        </View>
        <View
          style={[
            s.sukliCard,
            isShort && s.sukliCardShort,
            isExact && s.sukliCardExact,
          ]}
        >
          <Text
            style={[
              s.cardLabel,
              isShort
                ? { color: colors.errorDeep }
                : { color: colors.successDeep },
            ]}
          >
            Sukli · Change
          </Text>
          <Text
            style={[
              s.bayadValue,
              tnum,
              isShort
                ? { color: colors.errorDeep }
                : { color: colors.successDeep },
            ]}
          >
            {formatPeso(Math.max(0, changeCents))}
          </Text>
          {isShort && (
            <Text style={s.shortLabel}>
              Short by {formatPeso(totalCents - bayadCents)}
            </Text>
          )}
        </View>

        <View style={s.summary}>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Total · Bayaran</Text>
            <Text style={[s.summaryLabel, tnum, { fontWeight: '700' }]}>
              {formatPeso(totalCents)}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityLabel="Confirm cash payment"
          disabled={!ready}
          style={[s.confirm, !ready && s.confirmDisabled]}
          onPress={() =>
            onConfirm(
              { method: 'CASH', amount: bayadCents },
              Math.max(0, changeCents),
            )
          }
        >
          <Text style={s.confirmText}>
            Confirm · {formatPeso(Math.max(0, changeCents))} sukli
          </Text>
        </Pressable>
      </View>

      {/* RIGHT — keypad + quick amounts */}
      <View style={s.right}>
        <NumericKeypad value={raw} onChange={setRaw} />
        <View style={s.quickPanel}>
          <Text style={s.quickLabel}>Quick amounts</Text>
          <View style={s.quickGrid}>
            {QUICK_AMOUNTS_CENTS.map(c => (
              <Pressable
                key={c}
                style={s.quickKey}
                onPress={() => addQuick(c)}
              >
                <Text style={s.quickKeyText}>
                  {formatPeso(c, { noDecimals: true })}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={s.exact} onPress={setExact}>
            <Text style={s.exactText}>Exact · {formatPeso(totalCents)}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    padding: spacing.s6,
    gap: spacing.s6,
  },
  left: { flex: 1, gap: spacing.s4 },
  right: { flexDirection: 'row', gap: spacing.s4 },

  bayadCard: {
    padding: spacing.s5,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  sukliCard: {
    padding: spacing.s5,
    backgroundColor: colors.successSoft,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.success,
  },
  sukliCardExact: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  sukliCardShort: {
    backgroundColor: colors.errorSoft,
    borderColor: colors.error,
  },
  cardLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
    marginBottom: spacing.s2,
  },
  bayadValue: {
    ...textTokens.displayLg,
    fontSize: 48,
    color: colors.ink,
  },
  shortLabel: {
    ...textTokens.caption,
    color: colors.errorDeep,
    marginTop: spacing.s2,
  },

  summary: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLabel: { ...textTokens.body, color: colors.ink },

  confirm: {
    height: 64,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.s3,
  },
  confirmDisabled: { backgroundColor: colors.ruleStrong },
  confirmText: { ...textTokens.cashierLg, color: colors.onPrimary },

  quickPanel: {
    padding: spacing.s3,
    backgroundColor: colors.creamSoft,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.creamDeep,
    gap: spacing.s3,
    width: 220,
  },
  quickLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s2,
  },
  quickKey: {
    width: '48%',
    height: 60,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickKeyText: {
    ...textTokens.cashierKey,
    color: colors.ink,
    fontSize: 16,
  },
  exact: {
    height: 48,
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exactText: { ...textTokens.cashierKey, color: colors.primaryInk, fontSize: 16 },
});
