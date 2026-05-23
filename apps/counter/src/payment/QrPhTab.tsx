/**
 * Clerque Counter — QR PH tab
 *
 * QR PH (BSP InstaPay national QR) is fundamentally different from a Card
 * payment — the customer scans a QR code (printed standee or dynamic on
 * screen) from ANY participating bank or wallet app (GCash, Maya, BPI,
 * BDO, UnionBank, RCBC, Landbank, ChinaBank…). Funds settle to the
 * merchant's linked account through InstaPay in seconds.
 *
 * Cashier workflow:
 *   1. Show the merchant's QR PH standee to the customer.
 *   2. Customer scans, confirms in their banking app, payment lands in
 *      the merchant's account.
 *   3. Cashier reads the InstaPay reference number from the customer's
 *      "Payment Successful" screen (or hears the merchant's bank SMS).
 *   4. Cashier types the reference here for reconciliation.
 *
 * The reference is the audit hook between Counter Z-read and the
 * merchant's bank statement — without it, reconciliation falls back to
 * timestamp + amount matching which is fragile.
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

export interface QrPhTabProps {
  totalCents: number;
  onConfirm: (p: CartPayment) => void;
}

export default function QrPhTab({ totalCents, onConfirm }: QrPhTabProps): React.ReactElement {
  const [reference, setReference] = useState('');
  const [sender, setSender]       = useState('');
  const refOk = reference.trim().length >= 4;

  return (
    <View style={s.root}>
      <View style={[s.card, { flex: 1 }]}>
        <Text style={s.fieldLabel}>
          InstaPay reference no. <Text style={{ color: colors.error }}>*</Text>
        </Text>
        <TextInput
          value={reference}
          onChangeText={setReference}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="e.g. 2026052300123456"
          placeholderTextColor={colors.faint}
          style={s.input}
        />
        <Text style={s.fieldHelp}>
          The reference number from the customer&apos;s &ldquo;Payment Successful&rdquo;
          screen, or your bank&apos;s incoming-credit notification.
        </Text>

        <View style={{ height: spacing.s5 }} />

        <Text style={s.fieldLabel}>Sender name (as shown on receipt) · optional</Text>
        <TextInput
          value={sender}
          onChangeText={setSender}
          autoCapitalize="words"
          placeholder="e.g. JUAN D. CRUZ"
          placeholderTextColor={colors.faint}
          style={s.input}
        />
        <Text style={s.fieldHelp}>
          Useful when reconciling against the bank statement.
        </Text>

        <View style={s.tip}>
          <Text style={s.tipTitle}>How QR PH works</Text>
          <Text style={s.tipBody}>
            Customer scans your QR PH from ANY bank or wallet app
            (GCash · Maya · BPI · BDO · UnionBank · RCBC · Landbank…).
            Settles instantly via InstaPay — typically zero merchant fee.
          </Text>
        </View>
      </View>

      <View style={[s.card, { width: 360 }]}>
        <Text style={s.cardLabel}>Charge · QR PH</Text>
        <Text style={[s.amountValue, tnum]}>{formatPeso(totalCents)}</Text>
        <Pressable
          disabled={!refOk}
          style={[s.confirm, !refOk && s.confirmDisabled]}
          onPress={() =>
            onConfirm({
              method: 'QR_PH',
              amount: totalCents,
              reference: sender ? `${reference} · ${sender}` : reference,
            })
          }
        >
          <Text style={s.confirmText}>
            {refOk ? `Confirm QR PH · ${formatPeso(totalCents)}` : 'Enter reference no.'}
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

  tip: {
    marginTop: spacing.s5,
    padding: spacing.s4,
    borderRadius: radii.md,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  tipTitle: { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  tipBody:  { ...textTokens.caption, color: colors.muted, marginTop: 4 },

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
