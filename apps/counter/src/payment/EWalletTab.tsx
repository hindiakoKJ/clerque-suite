/**
 * Clerque Counter — E-wallet tab (GCash + PayMaya share this shell)
 *
 * Matches the `TenderingGCash` design in screens-tablet-v2.jsx. PayMaya uses
 * the same layout with a green accent.
 *
 * Real QR codes come from the API later — V1 renders a placeholder square
 * with the brand letter; manual reference number is what BIR cares about.
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
import type { CartPayment, PaymentMethod } from '@/types';

export interface EWalletTabProps {
  totalCents: number;
  method: Extract<PaymentMethod, 'GCASH' | 'PAYMAYA'>;
  /** Brand colour used for accents + Confirm button background. */
  brandColor: string;
  brandLabel: string;
  brandLetter: string;
  onConfirm: (p: CartPayment) => void;
}

export default function EWalletTab({
  totalCents,
  method,
  brandColor,
  brandLabel,
  brandLetter,
  onConfirm,
}: EWalletTabProps): React.ReactElement {
  const [reference, setReference] = useState('');
  const refOk = /^\d{10,13}$/.test(reference);

  return (
    <View style={s.row}>
      {/* LEFT — QR + reference */}
      <View style={{ flex: 1.1, gap: spacing.s4 }}>
        <View style={s.card}>
          <View style={s.brandRow}>
            <View style={[s.brandDot, { backgroundColor: brandColor }]}>
              <Text style={s.brandLetter}>{brandLetter}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.brandTitle}>
                Customer pays via {brandLabel}
              </Text>
              <Text style={s.brandSub}>
                Show this QR — they'll get a 6-digit confirmation.
              </Text>
            </View>
          </View>

          <View style={s.qrRow}>
            <View style={s.qrSquare}>
              <Text style={s.qrPlaceholder}>{brandLabel} QR</Text>
              <Text style={s.qrPlaceholderSub}>320 × 320</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Pay to</Text>
              <Text style={s.payeeName}>HNS Corp PH</Text>
              <Text style={s.payeePhone}>0917 ••• 4452</Text>
              <View style={s.infoBanner}>
                <Text style={s.infoBannerText}>
                  Awaiting confirmation… wait for the customer's "Sent
                  successfully" SMS before tapping Confirm.
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={s.refCard}>
          <Text style={s.fieldLabel}>
            {brandLabel} reference no. <Text style={{ color: colors.error }}>*</Text>
          </Text>
          <TextInput
            value={reference}
            onChangeText={t => setReference(t.replace(/\D/g, '').slice(0, 13))}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={13}
            placeholder="1234567890"
            placeholderTextColor={colors.faint}
            style={s.refInput}
          />
          <Text style={s.fieldHelp}>
            From the customer's confirmation SMS · 10–13 digits
          </Text>
        </View>
      </View>

      {/* RIGHT — amount + summary + tip */}
      <View style={{ flex: 1, gap: spacing.s4 }}>
        <View style={[s.amountCard, { backgroundColor: colors.infoSoft, borderColor: '#BFD8FB' }]}>
          <Text style={[s.cardLabel, { color: brandColor }]}>
            Receive · {brandLabel}
          </Text>
          <Text style={[s.amountValue, tnum, { color: brandColor }]}>
            {formatPeso(totalCents)}
          </Text>
          <Text style={s.exactOnly}>Exact amount only · no sukli</Text>
        </View>

        <View style={s.tip}>
          <Text style={s.tipText}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>Tip:</Text>{' '}
            The reference number prints on both copies of the receipt.
          </Text>
        </View>

        <Pressable
          disabled={!refOk}
          style={[
            s.confirm,
            { backgroundColor: brandColor },
            !refOk && s.confirmDisabled,
          ]}
          onPress={() =>
            onConfirm({
              method,
              amount: totalCents,
              reference,
            })
          }
        >
          <Text style={s.confirmText}>
            {refOk
              ? `Confirm ${brandLabel} · ref ${reference}`
              : `Enter ${brandLabel} reference no.`}
          </Text>
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
  card: {
    padding: spacing.s5,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.s4,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s4,
  },
  brandDot: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLetter: {
    ...textTokens.displaySm,
    color: colors.onPrimary,
    fontWeight: '800',
  },
  brandTitle: { ...textTokens.bodyLg, color: colors.ink, fontWeight: '700' },
  brandSub: { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  qrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s5,
  },
  qrSquare: {
    width: 200,
    height: 200,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.ruleStrong,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrPlaceholder: { ...textTokens.displaySm, color: colors.ink, fontWeight: '700' },
  qrPlaceholderSub: { ...textTokens.caption, color: colors.muted, marginTop: 4 },

  refCard: {
    padding: spacing.s5,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  fieldLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
    marginBottom: spacing.s2,
  },
  refInput: {
    ...textTokens.cashierLg,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
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

  payeeName: { ...textTokens.displaySm, color: colors.ink, fontWeight: '700' },
  payeePhone: {
    ...textTokens.mono,
    color: colors.muted,
    marginTop: 2,
    marginBottom: spacing.s3,
  },
  infoBanner: {
    padding: spacing.s3,
    backgroundColor: colors.infoSoft,
    borderRadius: radii.sm,
  },
  infoBannerText: { ...textTokens.caption, color: colors.infoDeep, fontWeight: '500' },

  amountCard: {
    padding: spacing.s5,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  cardLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
    marginBottom: spacing.s2,
  },
  amountValue: { ...textTokens.displayLg, fontSize: 48 },
  exactOnly: { ...textTokens.caption, color: colors.muted, marginTop: spacing.s3 },

  tip: {
    padding: spacing.s4,
    backgroundColor: colors.cream,
    borderRadius: radii.sm,
  },
  tipText: { ...textTokens.caption, color: colors.muted, lineHeight: 18 },

  confirm: {
    height: 64,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
  },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { ...textTokens.cashierLg, color: colors.onPrimary },
});
