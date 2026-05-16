/**
 * Clerque Counter — Shared PIN keypad
 * Large-tap-target numeric keypad used by the cashier PIN screen and the
 * supervisor PIN modal. Emits the entered string on every change; the caller
 * decides when it's "complete" (4 vs 6 digits) and calls verify.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing, text, tap } from '@/theme';

interface Props {
  value: string;
  length: 4 | 6;
  onChange: (next: string) => void;
  disabled?: boolean;
}

const KEYS: Array<{ label: string; value: string } | null> = [
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5', value: '5' },
  { label: '6', value: '6' },
  { label: '7', value: '7' },
  { label: '8', value: '8' },
  { label: '9', value: '9' },
  null,
  { label: '0', value: '0' },
  { label: '⌫', value: 'back' },
];

export function PinDots({ value, length }: { value: string; length: 4 | 6 }): React.ReactElement {
  return (
    <View style={dotStyles.row}>
      {Array.from({ length }).map((_, i) => {
        const filled = i < value.length;
        return (
          <View
            key={i}
            style={[dotStyles.dot, filled ? dotStyles.dotFilled : dotStyles.dotEmpty]}
          />
        );
      })}
    </View>
  );
}

export default function PinKeypad({ value, length, onChange, disabled }: Props): React.ReactElement {
  const handlePress = (key: string) => {
    if (disabled) return;
    Haptics.selectionAsync().catch(() => {});
    if (key === 'back') {
      onChange(value.slice(0, -1));
    } else if (value.length < length) {
      onChange(value + key);
    }
  };

  return (
    <View style={styles.grid}>
      {KEYS.map((k, idx) => {
        if (!k) return <View key={`spacer-${idx}`} style={styles.keySpacer} />;
        return (
          <Pressable
            key={k.value}
            onPress={() => handlePress(k.value)}
            disabled={disabled}
            style={({ pressed }: { pressed: boolean }) => [
              styles.key,
              pressed && styles.keyPressed,
              disabled && styles.keyDisabled,
            ]}
          >
            <Text style={styles.keyLabel}>{k.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 320,
    gap: spacing.s3,
  },
  key: {
    width: 96,
    height: Math.max(tap.cashierPrimary + 16, 80),
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rule,
  },
  keyPressed: { backgroundColor: colors.creamSoft },
  keyDisabled: { opacity: 0.5 },
  keySpacer: { width: 96, height: Math.max(tap.cashierPrimary + 16, 80) },
  keyLabel: { ...text.cashierLg, color: colors.ink },
});

const dotStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.s3 },
  dot: { width: 16, height: 16, borderRadius: 999 },
  dotEmpty: { backgroundColor: colors.rule },
  dotFilled: { backgroundColor: colors.primary },
});
