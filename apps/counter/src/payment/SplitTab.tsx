/**
 * Clerque Counter — Split payment tab
 *
 * Cashier adds N payment lines (method + amount). Running total and remaining
 * shown live. Confirm enabled only when remaining = 0.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  colors,
  radii,
  spacing,
  text as textTokens,
  tnum,
} from '@/theme/tokens';
import { formatPeso } from '@/components/Money';
import type { CartPayment, PaymentMethod } from '@/types';
import NumericKeypad, { keypadToCents } from './NumericKeypad';

export interface SplitTabProps {
  totalCents: number;
  onConfirm: (payments: CartPayment[], changeCents: number) => void;
}

const METHODS: { method: Extract<PaymentMethod, 'CASH' | 'GCASH' | 'PAYMAYA' | 'CARD'>; label: string; color: string }[] = [
  { method: 'CASH', label: 'Cash', color: colors.primary },
  { method: 'GCASH', label: 'GCash', color: colors.gcash },
  { method: 'PAYMAYA', label: 'PayMaya', color: colors.paymaya },
  { method: 'CARD', label: 'Card', color: colors.muted },
];

export default function SplitTab({ totalCents, onConfirm }: SplitTabProps): React.ReactElement {
  const [lines, setLines] = useState<CartPayment[]>([]);
  const [pendingMethod, setPendingMethod] = useState<CartPayment['method']>('CASH');
  const [pendingRef, setPendingRef] = useState('');
  const [pendingRaw, setPendingRaw] = useState('');

  const paidCents = useMemo(
    () => lines.reduce((acc, l) => acc + l.amount, 0),
    [lines],
  );
  const remainingCents = totalCents - paidCents;
  const overpayCents = Math.max(0, -remainingCents);
  const ready = remainingCents <= 0 && lines.length > 0;
  // Only cash can produce change.
  const changeCents = (() => {
    if (!ready) return 0;
    const lastCash = [...lines].reverse().find(l => l.method === 'CASH');
    return lastCash ? overpayCents : 0;
  })();

  const addLine = () => {
    const cents = keypadToCents(pendingRaw);
    if (cents <= 0) return;
    setLines([
      ...lines,
      {
        method: pendingMethod,
        amount: cents,
        reference: pendingRef.trim() ? pendingRef.trim() : undefined,
      },
    ]);
    setPendingRaw('');
    setPendingRef('');
  };

  const removeLine = (i: number) => {
    setLines(lines.filter((_, idx) => idx !== i));
  };

  const fillRemaining = () => {
    if (remainingCents > 0) {
      setPendingRaw((remainingCents / 100).toFixed(2));
    }
  };

  return (
    <View style={s.row}>
      {/* LEFT — running list */}
      <View style={s.left}>
        <View style={s.summary}>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Total · Bayaran</Text>
            <Text style={[s.summaryLabel, tnum, { fontWeight: '700' }]}>
              {formatPeso(totalCents)}
            </Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Paid so far</Text>
            <Text style={[s.summaryLabel, tnum]}>{formatPeso(paidCents)}</Text>
          </View>
          <View style={[s.summaryRow, s.summaryRowTop]}>
            <Text style={[s.summaryLabel, { fontWeight: '700' }]}>
              {remainingCents > 0 ? 'Remaining' : remainingCents < 0 ? 'Overpayment (change)' : 'Settled'}
            </Text>
            <Text
              style={[
                s.summaryLabel,
                tnum,
                { fontWeight: '700' },
                remainingCents > 0
                  ? { color: colors.errorDeep }
                  : { color: colors.successDeep },
              ]}
            >
              {formatPeso(Math.abs(remainingCents))}
            </Text>
          </View>
        </View>

        <View style={s.linesCard}>
          <Text style={s.cardLabel}>Payments</Text>
          {lines.length === 0 ? (
            <Text style={s.emptyText}>No payments yet — add one on the right.</Text>
          ) : (
            lines.map((l, i) => (
              <View key={i} style={s.lineRow}>
                <Text style={s.lineMethod}>
                  {METHODS.find(m => m.method === l.method)?.label ?? l.method}
                </Text>
                <Text style={[s.lineAmount, tnum]}>{formatPeso(l.amount)}</Text>
                {l.reference ? (
                  <Text style={[s.lineRef, tnum]}>· ref {l.reference}</Text>
                ) : null}
                <Pressable onPress={() => removeLine(i)} style={s.lineRemove}>
                  <Text style={s.lineRemoveText}>Remove</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <Pressable
          disabled={!ready}
          style={[s.confirm, !ready && s.confirmDisabled]}
          onPress={() => onConfirm(lines, changeCents)}
        >
          <Text style={s.confirmText}>
            {ready
              ? `Confirm split · ${formatPeso(changeCents)} sukli`
              : `Add ${formatPeso(Math.max(0, remainingCents))} more`}
          </Text>
        </Pressable>
      </View>

      {/* RIGHT — add-payment composer */}
      <View style={s.right}>
        <View style={s.composer}>
          <Text style={s.cardLabel}>Add payment</Text>
          <View style={s.methodRow}>
            {METHODS.map(m => {
              const active = pendingMethod === m.method;
              return (
                <Pressable
                  key={m.method}
                  style={[
                    s.methodChip,
                    active && { backgroundColor: m.color, borderColor: m.color },
                  ]}
                  onPress={() => setPendingMethod(m.method)}
                >
                  <Text
                    style={[
                      s.methodChipText,
                      active && { color: colors.onPrimary },
                    ]}
                  >
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={s.amountPreview}>
            {pendingRaw ? formatPeso(keypadToCents(pendingRaw)) : '₱0.00'}
          </Text>
          <Pressable style={s.fillBtn} onPress={fillRemaining}>
            <Text style={s.fillText}>
              Fill remaining · {formatPeso(Math.max(0, remainingCents))}
            </Text>
          </Pressable>

          {pendingMethod !== 'CASH' && (
            <TextInput
              value={pendingRef}
              onChangeText={setPendingRef}
              placeholder="Reference no. (optional)"
              placeholderTextColor={colors.faint}
              style={s.refInput}
            />
          )}
        </View>

        <NumericKeypad value={pendingRaw} onChange={setPendingRaw} />

        <Pressable style={s.addBtn} onPress={addLine}>
          <Text style={s.addBtnText}>+ Add payment line</Text>
        </Pressable>
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
  right: { width: 360, gap: spacing.s4 },

  summary: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryRowTop: {
    paddingTop: spacing.s3,
    marginTop: spacing.s2,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  summaryLabel: { ...textTokens.body, color: colors.ink },

  linesCard: {
    flex: 1,
    padding: spacing.s4,
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
    marginBottom: spacing.s2,
  },
  emptyText: { ...textTokens.bodySm, color: colors.faint },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    paddingVertical: spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  lineMethod: { ...textTokens.body, color: colors.ink, fontWeight: '600', minWidth: 80 },
  lineAmount: { ...textTokens.body, color: colors.ink },
  lineRef: { ...textTokens.caption, color: colors.muted, flex: 1 },
  lineRemove: { paddingHorizontal: spacing.s3, paddingVertical: spacing.s2 },
  lineRemoveText: { ...textTokens.caption, color: colors.errorDeep, fontWeight: '700' },

  confirm: {
    height: 64,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDisabled: { backgroundColor: colors.ruleStrong },
  confirmText: { ...textTokens.cashierLg, color: colors.onPrimary },

  composer: {
    padding: spacing.s4,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s3,
  },
  methodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s2,
  },
  methodChip: {
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.creamSoft,
  },
  methodChipText: { ...textTokens.caption, color: colors.ink, fontWeight: '600' },
  amountPreview: {
    ...textTokens.displayMd,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  fillBtn: {
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fillText: { ...textTokens.caption, color: colors.primaryInk, fontWeight: '700' },
  refInput: {
    ...textTokens.body,
    color: colors.ink,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
  },
  addBtn: {
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { ...textTokens.bodyLg, color: colors.successDeep, fontWeight: '700' },
});
