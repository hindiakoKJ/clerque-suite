/**
 * Clerque Counter — "No shift open" gate sheet
 *
 * Shown when a cashier tries to tender a sale without an open shift.
 * Counter blocks the Charge CTA (PhoneCartDrawer + tablet Terminal) and
 * surfaces this sheet pointing them at the Shift tab to count the drawer.
 *
 * Compliance reason: a sale rung without a prior shift.open event leaves
 * Z-read with no opening float, which makes variance reconciliation
 * impossible and breaks BIR audit posture.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, fonts, radii, spacing, text as textTokens } from '@/theme';

interface Props {
  visible:    boolean;
  onCancel:   () => void;
  /** Navigate the cashier to the Shift tab. Caller wires the nav.navigate('Shift'). */
  onGoToShift: () => void;
}

export default function NoShiftSheet({ visible, onCancel, onGoToShift }: Props): React.ReactElement {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.scrim} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => { /* swallow taps inside */ }}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="clock-alert-outline" size={32} color={colors.warningDeep} />
          </View>
          <Text style={styles.title}>Open your shift first</Text>
          <Text style={styles.body}>
            Count the drawer and open a shift before ringing any sales.
            Without an opening float, the Z-read can&apos;t reconcile the
            day&apos;s cash variance.
          </Text>

          <Pressable
            onPress={onGoToShift}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <Text style={styles.ctaLabel}>Go to Shift →</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={styles.ghost}>
            <Text style={styles.ghostLabel}>Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(31,27,22,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.s5,
    paddingBottom: spacing.s7,
    alignItems: 'center',
    gap: spacing.s2,
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.warningSoft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.s2,
  },
  title: {
    fontFamily: fonts.displayBold, fontSize: 20, fontWeight: '800', color: colors.ink, textAlign: 'center',
  },
  body: {
    ...textTokens.bodySm, color: colors.muted, textAlign: 'center', lineHeight: 20, marginBottom: spacing.s3,
  },
  cta: {
    height: 52, width: '100%',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaPressed: { backgroundColor: colors.primaryPress },
  ctaLabel:   { color: colors.onPrimary, fontFamily: fonts.bodyBold, fontWeight: '700', fontSize: 16 },

  ghost: { height: 40, paddingHorizontal: spacing.s5, alignItems: 'center', justifyContent: 'center' },
  ghostLabel: { ...textTokens.bodySm, color: colors.muted, fontWeight: '600' },
});
