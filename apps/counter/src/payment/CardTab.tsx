/**
 * Clerque Counter — Card tab
 *
 * Reference # (printed receipt slip) + optional last-4-of-card.
 * Mobile POS terminals (TapToPhone, etc.) are out of scope for V1 — the
 * cashier swipes on a separate device and types the slip ref here.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  colors,
  radii,
  spacing,
  text as textTokens,
  tnum,
} from '@/theme/tokens';
import { formatPeso } from '@/components/Money';
import type { CartPayment } from '@/types';

export interface CardTabProps {
  totalCents: number;
  onConfirm: (p: CartPayment) => void;
}

export default function CardTab({ totalCents, onConfirm }: CardTabProps): React.ReactElement {
  const [reference, setReference] = useState('');
  const [last4, setLast4] = useState('');
  const refOk = reference.trim().length >= 4;

  return (
    <View style={s.root}>
      <View style={[s.card, { flex: 1 }]}>
        <Text style={s.fieldLabel}>Slip / approval reference no. <Text style={{ color: colors.error }}>*</Text></Text>
        <TextInput
          value={reference}
          onChangeText={setReference}
          autoCapitalize="characters"
          placeholder="e.g. 123456"
          placeholderTextColor={colors.faint}
          style={s.input}
        />
        <Text style={s.fieldHelp}>
          The transaction ID printed on the bank terminal slip.
        </Text>

        <View style={{ height: spacing.s5 }} />

        <Text style={s.fieldLabel}>Last 4 digits of card · optional</Text>
        <TextInput
          value={last4}
          onChangeText={(t: string) => setLast4(t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={4}
          placeholder="•••• ••••"
          placeholderTextColor={colors.faint}
          style={s.input}
        />
        <Text style={s.fieldHelp}>
          Useful for disputes — does not store the full card number.
        </Text>
      </View>

      <View style={[s.card, { width: 360 }]}>
        <Text style={s.cardLabel}>Charge · Card</Text>
        <Text style={[s.amountValue, tnum]}>{formatPeso(totalCents)}</Text>
        <Pressable
          disabled={!refOk}
          style={[s.confirm, !refOk && s.confirmDisabled]}
          onPress={() =>
            onConfirm({
              method: 'CARD',
              amount: totalCents,
              reference: last4 ? `${reference}/•••${last4}` : reference,
            })
          }
        >
          <Text style={s.confirmText}>
            {refOk ? `Confirm Card · ${formatPeso(totalCents)}` : 'Enter reference no.'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    padding: spacing.s6,
    gap: spacing.s6,
  },
  card: {
    padding: spacing.s5,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  cardLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
    marginBottom: spacing.s2,
  },
  amountValue: { ...textTokens.displayLg, fontSize: 48, color: colors.ink, marginBottom: spacing.s5 },

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
  fieldHelp: {
    ...textTokens.caption,
    color: colors.muted,
    marginTop: spacing.s2,
  },

  confirm: {
    height: 64,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
  },
  confirmDisabled: { backgroundColor: colors.ruleStrong },
  confirmText: { ...textTokens.cashierLg, color: colors.onPrimary },
});
