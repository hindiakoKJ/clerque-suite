/**
 * Clerque Counter — Senior / PWD Discount Modal
 *
 * RA 9994 / RA 10754 — 20 % off + VAT exempt on the entire order, single ID
 * per order. The modal collects:
 *   - kind (Senior or PWD)
 *   - ID reference (OSCA-/PWD-/SR-…)
 *   - owner name
 *
 * Apply pseudocode (parent's responsibility — we just return the payload):
 *   cart.pwdScId = { idRef, ownerName, kind }
 *   for each line in cart.lines (F&B/Retail only — non-essentials excluded;
 *     V1: apply to all lines):
 *       line.discount = { kind, percent: 20 }
 */

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  colors,
  radii,
  spacing,
  text as textTokens,
} from '@/theme/tokens';

export interface SeniorPwdResult {
  kind: 'SENIOR' | 'PWD';
  idRef: string;
  ownerName: string;
}

export interface SeniorPwdDiscountModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (result: SeniorPwdResult) => void;
  /** Pre-fill (when editing an already-applied ID). */
  initial?: SeniorPwdResult;
}

export default function SeniorPwdDiscountModal({
  visible,
  onClose,
  onApply,
  initial,
}: SeniorPwdDiscountModalProps): React.ReactElement {
  const [kind, setKind] = useState<'SENIOR' | 'PWD'>(initial?.kind ?? 'SENIOR');
  const [idRef, setIdRef] = useState(initial?.idRef ?? '');
  const [ownerName, setOwnerName] = useState(initial?.ownerName ?? '');

  const valid = idRef.trim().length >= 4 && ownerName.trim().length >= 2;

  const submit = () => {
    if (!valid) return;
    onApply({ kind, idRef: idRef.trim(), ownerName: ownerName.trim() });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.modal}>
          <Text style={s.title}>Apply Senior / PWD discount</Text>
          <Text style={s.subtitle}>
            20% off + VAT-exempt on the entire order
          </Text>

          {/* Type */}
          <Text style={s.label}>Type</Text>
          <View style={s.radioRow}>
            {(['SENIOR', 'PWD'] as const).map(k => {
              const active = kind === k;
              return (
                <Pressable
                  key={k}
                  style={[s.radio, active && s.radioActive]}
                  onPress={() => setKind(k)}
                >
                  <View style={[s.radioDot, active && s.radioDotActive]} />
                  <Text style={[s.radioText, active && { color: colors.primaryInk }]}>
                    {k === 'SENIOR' ? 'Senior Citizen' : 'Person with Disability'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ID # */}
          <Text style={s.label}>
            {kind === 'SENIOR' ? 'OSCA / Senior ID #' : 'PWD ID #'}
          </Text>
          <TextInput
            value={idRef}
            onChangeText={setIdRef}
            autoCapitalize="characters"
            placeholder={kind === 'SENIOR' ? 'OSCA-12345' : 'PWD-67890'}
            placeholderTextColor={colors.faint}
            style={s.input}
          />

          {/* Owner */}
          <Text style={s.label}>Cardholder name</Text>
          <TextInput
            value={ownerName}
            onChangeText={setOwnerName}
            autoCapitalize="words"
            placeholder="Surname, First name"
            placeholderTextColor={colors.faint}
            style={s.input}
          />

          <View style={s.note}>
            <Text style={s.noteText}>
              PH RA 9994 — only one ID per order. The cardholder must sign the
              receipt at point of sale.
            </Text>
          </View>

          <View style={s.actions}>
            <Pressable style={[s.btn, s.btnGhost]} onPress={onClose}>
              <Text style={[s.btnText, { color: colors.ink }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.btn, s.btnPrimary, !valid && s.btnDisabled]}
              onPress={submit}
              disabled={!valid}
            >
              <Text style={s.btnText}>Apply 20% off + VAT exempt</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s6,
  },
  modal: {
    width: '100%',
    maxWidth: 480,
    padding: spacing.s6,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    gap: spacing.s3,
  },
  title: { ...textTokens.displaySm, color: colors.ink, fontWeight: '700' },
  subtitle: { ...textTokens.bodySm, color: colors.muted, marginBottom: spacing.s2 },
  label: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
    marginTop: spacing.s2,
  },
  radioRow: { flexDirection: 'row', gap: spacing.s3 },
  radio: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    padding: spacing.s4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.rule,
    backgroundColor: colors.creamSoft,
  },
  radioActive: {
    backgroundColor: colors.primaryContainer,
    borderColor: colors.primary,
  },
  radioDot: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.ruleStrong,
  },
  radioDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  radioText: { ...textTokens.bodyLg, color: colors.ink, fontWeight: '600' },
  input: {
    ...textTokens.bodyLg,
    color: colors.ink,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
  },
  note: {
    padding: spacing.s4,
    backgroundColor: colors.cream,
    borderRadius: radii.sm,
    marginTop: spacing.s3,
  },
  noteText: { ...textTokens.caption, color: colors.muted, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.s3, marginTop: spacing.s4 },
  btn: {
    flex: 1,
    height: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnDisabled: { backgroundColor: colors.ruleStrong },
  btnText: { ...textTokens.bodyLg, color: colors.onPrimary, fontWeight: '700' },
});
