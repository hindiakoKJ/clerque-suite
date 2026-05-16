/**
 * RxCaptureModal — Rx info capture (doctor + patient + Rx photo).
 *
 * Triggered the first time an Rx-required drug is added to a cart that
 * doesn't yet have Rx info stamped. Yellow Rx serial # is REQUIRED only
 * when a DDB_S2 line exists in the cart (BFAD yellow-prescription pad).
 *
 * `expo-camera` is stubbed — the "Take photo" button resolves to a fake
 * path until the device-camera path is wired.
 *
 * Save → stamps the Rx info on every Rx-required line in the cart via
 * `useCart.stampRx({...})`.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
} from 'react-native';
import { colors, spacing, radii, text, tap, elevation } from '@/theme/tokens';

export interface RxInfo {
  doctorName: string;
  prcLicense: string;
  patientName: string;
  patientAge: number;
  /** Yellow Rx serial — required when any DDB_S2 line is in cart. */
  yellowRxSerial?: string;
  /** Local URI/path of captured photo (stub for now). */
  photoUri?: string;
}

interface Props {
  visible: boolean;
  requireYellowSerial: boolean;
  onCancel: () => void;
  onSave: (rx: RxInfo) => void;
}

export const RxCaptureModal: React.FC<Props> = ({
  visible,
  requireYellowSerial,
  onCancel,
  onSave,
}) => {
  const [doctorName, setDoctorName] = useState('');
  const [prcLicense, setPrcLicense] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [yellowRxSerial, setYellowRxSerial] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);

  const ageNum = Number(patientAge);
  const ageValid = Number.isFinite(ageNum) && ageNum > 0 && ageNum < 130;

  const canSave =
    doctorName.trim().length > 1 &&
    prcLicense.trim().length > 3 &&
    patientName.trim().length > 1 &&
    ageValid &&
    (!requireYellowSerial || yellowRxSerial.trim().length > 2);

  const fakeTakePhoto = () => {
    // Stub for expo-camera — real capture happens later.
    setPhotoUri(`file:///mock/rx-${Date.now()}.jpg`);
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      doctorName: doctorName.trim(),
      prcLicense: prcLicense.trim(),
      patientName: patientName.trim(),
      patientAge: ageNum,
      yellowRxSerial: requireYellowSerial ? yellowRxSerial.trim() : undefined,
      photoUri,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={{ padding: spacing.s5 }}>
            <Text style={styles.title}>Capture prescription</Text>
            <Text style={styles.sub}>
              Required by FDA for every Rx-only dispense. Stamped on every Rx line in this order.
            </Text>

            <Text style={styles.fieldLabel}>Doctor full name *</Text>
            <TextInput
              value={doctorName}
              onChangeText={setDoctorName}
              placeholder="Dr. Maria Santos"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>PRC license # *</Text>
            <TextInput
              value={prcLicense}
              onChangeText={setPrcLicense}
              placeholder="0089432"
              placeholderTextColor={colors.faint}
              style={[styles.input, styles.mono]}
              autoCapitalize="characters"
            />

            <Text style={styles.fieldLabel}>Patient name *</Text>
            <TextInput
              value={patientName}
              onChangeText={setPatientName}
              placeholder="Ronaldo Cruz"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Patient age *</Text>
            <TextInput
              value={patientAge}
              onChangeText={setPatientAge}
              placeholder="42"
              keyboardType="number-pad"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            {requireYellowSerial && (
              <>
                <Text style={[styles.fieldLabel, { color: colors.errorDeep }]}>
                  Yellow Rx serial # * (required — controlled drug in cart)
                </Text>
                <TextInput
                  value={yellowRxSerial}
                  onChangeText={setYellowRxSerial}
                  placeholder="YR-0000123"
                  placeholderTextColor={colors.faint}
                  style={[styles.input, styles.mono, { borderColor: colors.warning }]}
                  autoCapitalize="characters"
                />
              </>
            )}

            <Text style={styles.fieldLabel}>Rx photo</Text>
            <Pressable onPress={fakeTakePhoto} style={styles.photoBtn}>
              <Text style={styles.photoBtnText}>
                {photoUri ? 'Photo captured · retake' : 'Take photo'}
              </Text>
            </Pressable>
            {photoUri && (
              <Text style={styles.photoPath} numberOfLines={1}>{photoUri}</Text>
            )}

            <View style={styles.row}>
              <Pressable onPress={onCancel} style={[styles.secondaryBtn, { flex: 1 }]}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={!canSave}
                style={[styles.primaryCta, !canSave && styles.primaryCtaDisabled, { flex: 2 }]}
              >
                <Text style={styles.primaryCtaText}>Save Rx</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.s5 },
  card: { width: '100%', maxWidth: 720, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radii.lg, ...elevation.e3 },
  title: { ...text.displayMd, color: colors.ink },
  sub: { ...text.bodySm, color: colors.muted, marginTop: spacing.s2, marginBottom: spacing.s4 },

  fieldLabel: { ...text.caption, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', marginTop: spacing.s3, marginBottom: spacing.s1 },
  input: {
    minHeight: tap.default,
    borderWidth: 1, borderColor: colors.rule,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.s3,
    color: colors.ink,
    backgroundColor: colors.surface,
    ...text.body,
  },
  mono: { fontFamily: undefined, letterSpacing: 1 },

  photoBtn: {
    height: tap.default,
    borderRadius: radii.sm,
    borderWidth: 1.5, borderColor: colors.rule, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  photoBtnText: { ...text.body, color: colors.muted, fontWeight: '600' },
  photoPath: { ...text.caption, color: colors.faint, marginTop: spacing.s2 },

  row: { flexDirection: 'row', gap: spacing.s3, marginTop: spacing.s5 },

  primaryCta: {
    backgroundColor: colors.primary,
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryCtaDisabled: { backgroundColor: colors.ruleStrong },
  primaryCtaText: { ...text.cashierLg, color: colors.onPrimary },

  secondaryBtn: {
    height: tap.cashierPrimary,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.rule,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  secondaryBtnText: { ...text.body, color: colors.ink, fontWeight: '600' },
});

export default RxCaptureModal;
