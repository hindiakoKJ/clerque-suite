/**
 * Clerque Counter — Shared PIN keypad
 * Large-tap-target numeric keypad used by the cashier PIN screen and the
 * supervisor PIN modal. Emits the entered string on every change; the caller
 * decides when it's "complete" (4 vs 6 digits) and calls verify.
 */

import React from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
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
  // Responsive sizing — scale keys to fit phones (<= 480dp wide) while
  // staying generous on tablets. The keypad takes up at most 90% of the
  // shorter dimension so it fits in landscape phones too.
  const { width, height } = useWindowDimensions();
  const shorter = Math.min(width, height);
  // Three-key columns with two inter-key gaps → key = (available - 2*gap) / 3
  // Available width capped at 360dp (tablet design width) to avoid
  // ridiculously huge keys on a 12" tablet.
  const available = Math.min(shorter * 0.9, 360);
  const keySize = Math.floor((available - 2 * spacing.s3) / 3);
  const gridWidth = keySize * 3 + spacing.s3 * 2;

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
    <View style={[styles.grid, { width: gridWidth }]}>
      {KEYS.map((k, idx) => {
        if (!k) {
          return <View key={`spacer-${idx}`} style={{ width: keySize, height: keySize }} />;
        }
        return (
          <Pressable
            key={k.value}
            onPress={() => handlePress(k.value)}
            disabled={disabled}
            style={({ pressed }: { pressed: boolean }) => [
              styles.key,
              { width: keySize, height: keySize },
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
    gap: spacing.s3,
  },
  key: {
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rule,
  },
  keyPressed: { backgroundColor: colors.creamSoft },
  keyDisabled: { opacity: 0.5 },
  keyLabel: { ...text.cashierLg, color: colors.ink },
});

const dotStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.s3 },
  dot: { width: 16, height: 16, borderRadius: 999 },
  dotEmpty: { backgroundColor: colors.rule },
  dotFilled: { backgroundColor: colors.primary },
});
