/**
 * PWD / Senior Citizen ID capture sheet — BIR compliance.
 *
 * RA 9994 (Senior Citizen) and RA 10754 (PWD) both require the cashier to
 * record the cardholder's:
 *   • Name on the ID
 *   • ID / OSCA / PWD card number
 *
 * These appear on the OR and the audit trail. Without them, BIR may
 * disallow the VAT-exempt + 20% discount during an audit. We surface this
 * prompt BEFORE applying the discount so the cart can't end up in a
 * "discount applied with no ID captured" state.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';

import { colors, fonts, radii, spacing, text as textTokens } from '@/theme';

export interface PwdScCaptureResult {
  idRef:     string;
  ownerName: string;
  kind:      'SENIOR' | 'PWD';
}

interface Props {
  visible: boolean;
  kind:    'SENIOR' | 'PWD' | null;
  initial?: { idRef?: string; ownerName?: string };
  onCancel: () => void;
  onConfirm: (result: PwdScCaptureResult) => void;
}

export default function PwdScCaptureSheet({ visible, kind, initial, onCancel, onConfirm }: Props): React.ReactElement {
  const [ownerName, setOwnerName] = useState('');
  const [idRef, setIdRef] = useState('');

  // Reset / seed fields whenever the sheet opens.
  useEffect(() => {
    if (visible) {
      setOwnerName(initial?.ownerName ?? '');
      setIdRef(initial?.idRef ?? '');
    }
  }, [visible, initial?.ownerName, initial?.idRef]);

  const isValid = ownerName.trim().length > 0 && idRef.trim().length >= 4;
  const title = kind === 'SENIOR'
    ? 'Senior Citizen ID'
    : kind === 'PWD'
      ? 'PWD ID'
      : 'ID';
  const idLabel = kind === 'SENIOR' ? 'OSCA / Senior ID number' : 'PWD ID number';
  const lawRef = kind === 'SENIOR'
    ? 'RA 9994 — Expanded Senior Citizens Act. Cardholder name + OSCA/Senior ID are required on the OR.'
    : 'RA 10754 — Magna Carta for PWDs. Cardholder name + PWD ID are required on the OR.';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <Pressable style={s.scrim} onPress={onCancel}>
        <Pressable style={s.sheet} onPress={() => { /* swallow */ }}>
          <View style={s.handle} />
          <Text style={s.title}>{title}</Text>
          <Text style={s.hint}>{lawRef}</Text>

          <View style={s.field}>
            <Text style={s.label}>Cardholder name</Text>
            <TextInput
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="Full name as printed on the card"
              placeholderTextColor={colors.faint}
              style={s.input}
              autoCapitalize="words"
              autoFocus
              returnKeyType="next"
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>{idLabel}</Text>
            <TextInput
              value={idRef}
              onChangeText={setIdRef}
              placeholder={kind === 'SENIOR' ? 'e.g. 12-345-678' : 'e.g. RR-0407-0000123'}
              placeholderTextColor={colors.faint}
              style={s.input}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (isValid && kind) {
                  onConfirm({ ownerName: ownerName.trim(), idRef: idRef.trim(), kind });
                }
              }}
            />
          </View>

          <View style={s.row}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [s.btn, s.btnGhost, pressed && { opacity: 0.85 }]}
            >
              <Text style={s.btnGhostLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (!isValid || !kind) return;
                onConfirm({ ownerName: ownerName.trim(), idRef: idRef.trim(), kind });
              }}
              disabled={!isValid || !kind}
              style={({ pressed }) => [s.btn, s.btnPrimary, (!isValid || !kind) && s.btnDisabled, pressed && { opacity: 0.92 }]}
            >
              <Text style={s.btnPrimaryLabel}>Apply 20% discount</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(31,27,22,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.s5,
    paddingBottom: spacing.s7,
    gap: spacing.s3,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.rule, alignSelf: 'center' },
  title:  { fontFamily: fonts.displayBold, fontSize: 22, fontWeight: '700', color: colors.ink },
  hint:   { ...textTokens.caption, color: colors.muted, marginBottom: spacing.s2 },
  field:  { gap: spacing.s2 },
  label:  { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700' },
  input:  {
    ...textTokens.body,
    color: colors.ink,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: radii.md,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
  },
  row:    { flexDirection: 'row', gap: spacing.s3, marginTop: spacing.s3 },
  btn:    {
    flex: 1,
    height: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost:       { backgroundColor: colors.creamSoft, borderWidth: 1, borderColor: colors.rule },
  btnGhostLabel:  { ...textTokens.body, color: colors.ink, fontWeight: '700' },
  btnPrimary:     { backgroundColor: colors.primary },
  btnPrimaryLabel:{ ...textTokens.body, color: colors.onPrimary, fontWeight: '800' },
  btnDisabled:    { opacity: 0.5 },
});
