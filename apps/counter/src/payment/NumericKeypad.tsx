/**
 * Clerque Counter — shared numeric keypad
 * Used by CashTab and SplitTab. Larger keys than the PIN keypad — `cashierLg`
 * label, ~80dp keys. Emits the entered string; caller parses to cents.
 *
 * Supports a decimal point (`·`) and backspace (`⌫`).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing, text as textTokens } from '@/theme/tokens';

interface Props {
  /** Free-form string the cashier has typed so far (digits + at most one '.'). */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

const KEYS: Array<{ label: string; value: string }> = [
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5', value: '5' },
  { label: '6', value: '6' },
  { label: '7', value: '7' },
  { label: '8', value: '8' },
  { label: '9', value: '9' },
  { label: '.', value: '.' },
  { label: '0', value: '0' },
  { label: '⌫', value: 'back' },
];

export default function NumericKeypad({ value, onChange, disabled }: Props): React.ReactElement {
  const press = (k: string) => {
    if (disabled) return;
    Haptics.selectionAsync().catch(() => {});
    if (k === 'back') {
      onChange(value.slice(0, -1));
      return;
    }
    if (k === '.') {
      if (value.includes('.')) return;
      onChange(value === '' ? '0.' : value + '.');
      return;
    }
    // digit
    if (value === '0') {
      onChange(k);
    } else {
      // Prevent more than 2 decimal places.
      const dotIdx = value.indexOf('.');
      if (dotIdx >= 0 && value.length - dotIdx > 2) return;
      onChange(value + k);
    }
  };

  return (
    <View style={s.grid}>
      {KEYS.map(k => {
        const isAction = k.value === '.' || k.value === 'back';
        return (
          <Pressable
            key={k.value}
            onPress={() => press(k.value)}
            disabled={disabled}
            style={({ pressed }) => [
              s.key,
              isAction && s.keyAction,
              pressed && s.keyPressed,
              disabled && s.keyDisabled,
            ]}
          >
            <Text style={[s.keyLabel, isAction && s.keyLabelAction]}>{k.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Convert keypad string to cents. '12.5' → 1250, '12.50' → 1250, '' → 0. */
export function keypadToCents(value: string): number {
  if (!value) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

const s = StyleSheet.create({
  grid: {
    width: 320,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s3,
  },
  key: {
    width: 96,
    height: 80,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rule,
  },
  keyAction: {
    backgroundColor: colors.creamSoft,
  },
  keyPressed: {
    backgroundColor: colors.cream,
  },
  keyDisabled: { opacity: 0.4 },
  keyLabel: { ...textTokens.cashierLg, color: colors.ink },
  keyLabelAction: { color: colors.muted },
});
