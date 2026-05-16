/**
 * Clerque Counter — Shift Open Screen
 *
 * After cashier PIN, BEFORE first sale. Cashier counts the drawer in PH
 * denominations, sums to an opening float, persists to local DB, and queues
 * the open event to the offline outbox for cloud sync.
 *
 * Denominations: 1000 / 500 / 200 / 100 / 50 / 20 / 10 / 5 / 1 / 0.25
 *   (₱0.25 is the smallest common coin used in PH change.)
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

import {
  colors,
  radii,
  spacing,
  tap,
  text as textTokens,
  tnum,
} from '@/theme/tokens';
import { formatPeso } from '@/components/Money';
import { enqueueOutbox } from '@/offline/db';

/** Each denomination in centavos. */
const DENOMS: { label: string; cents: number }[] = [
  { label: '₱1,000', cents: 100_000 },
  { label: '₱500', cents: 50_000 },
  { label: '₱200', cents: 20_000 },
  { label: '₱100', cents: 10_000 },
  { label: '₱50', cents: 5_000 },
  { label: '₱20', cents: 2_000 },
  { label: '₱10', cents: 1_000 },
  { label: '₱5', cents: 500 },
  { label: '₱1', cents: 100 },
  { label: '₱0.25', cents: 25 },
];

export interface ShiftOpenScreenProps {
  cashierId: string;
  cashierName: string;
  /** Resolves with the opening float in ₱ cents. */
  onOpened: (openingFloatCents: number, counts: Record<string, number>) => void;
  onCancel?: () => void;
}

export default function ShiftOpenScreen({
  cashierId,
  cashierName,
  onOpened,
  onCancel,
}: ShiftOpenScreenProps): React.ReactElement {
  const [counts, setCounts] = useState<Record<string, number>>(
    Object.fromEntries(DENOMS.map(d => [d.label, 0])),
  );
  const [busy, setBusy] = useState(false);

  const totalCents = useMemo(
    () =>
      DENOMS.reduce(
        (acc, d) => acc + (counts[d.label] ?? 0) * d.cents,
        0,
      ),
    [counts],
  );

  const setCount = (label: string, raw: string) => {
    const n = Number(raw.replace(/\D/g, ''));
    setCounts(prev => ({ ...prev, [label]: Number.isFinite(n) ? n : 0 }));
  };

  const handleOpen = async () => {
    setBusy(true);
    try {
      await enqueueOutbox('shift.open', {
        cashierId,
        openedAt: new Date().toISOString(),
        openingFloatCents: totalCents,
        counts,
      });
      onOpened(totalCents, counts);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Open shift · Count the drawer</Text>
          <Text style={s.subtle}>
            Cashier {cashierName} · count each denomination before first sale.
          </Text>
        </View>
        <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
          <Text style={s.label}>Opening float</Text>
          <Text style={[s.totalValue, tnum]}>{formatPeso(totalCents)}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <View style={s.grid}>
          {DENOMS.map(d => {
            const n = counts[d.label] ?? 0;
            const subtotal = n * d.cents;
            return (
              <View key={d.label} style={s.denomCard}>
                <Text style={s.denomLabel}>{d.label}</Text>
                <View style={s.denomRow}>
                  <Pressable
                    onPress={() => setCount(d.label, String(Math.max(0, n - 1)))}
                    style={s.stepBtn}
                  >
                    <Text style={s.stepBtnText}>−</Text>
                  </Pressable>
                  <TextInput
                    value={String(n)}
                    onChangeText={t => setCount(d.label, t)}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    style={s.countInput}
                  />
                  <Pressable
                    onPress={() => setCount(d.label, String(n + 1))}
                    style={s.stepBtn}
                  >
                    <Text style={s.stepBtnText}>+</Text>
                  </Pressable>
                </View>
                <Text style={[s.subtotal, tnum]}>{formatPeso(subtotal)}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={s.footer}>
        {onCancel ? (
          <Pressable style={[s.btn, s.btnGhost]} onPress={onCancel}>
            <Text style={[s.btnText, { color: colors.ink }]}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[s.btn, s.btnPrimary, busy && s.btnDisabled]}
          onPress={handleOpen}
          disabled={busy}
        >
          <Text style={s.btnText}>
            {busy ? 'Opening…' : `Open shift · ${formatPeso(totalCents)}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.s6,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    backgroundColor: colors.surface,
  },
  title: { ...textTokens.displaySm, color: colors.ink },
  subtle: { ...textTokens.bodySm, color: colors.muted, marginTop: 2 },
  label: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  totalValue: { ...textTokens.displayLg, color: colors.primary, fontSize: 40, lineHeight: 44 },

  body: { padding: spacing.s6 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s4,
  },
  denomCard: {
    width: 200,
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s3,
  },
  denomLabel: { ...textTokens.displaySm, color: colors.ink, fontSize: 20 },
  denomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { ...textTokens.cashierLg, color: colors.ink },
  countInput: {
    flex: 1,
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
    textAlign: 'center',
    ...textTokens.cashierKey,
    color: colors.ink,
  },
  subtotal: {
    ...textTokens.body,
    color: colors.muted,
    textAlign: 'right',
  },

  footer: {
    flexDirection: 'row',
    gap: spacing.s4,
    padding: spacing.s5,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  btn: {
    flex: 1,
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
    flex: 0,
    paddingHorizontal: spacing.s6,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnDisabled: { opacity: 0.6 },
  btnText: { ...textTokens.cashierLg, color: colors.onPrimary },
});
