/**
 * Clerque Counter — brand lockup (mark + wordmark)
 *
 * Uses the real Clerque ecosystem brand mark (purple gradient backdrop with
 * three inset cards — Counter, Ledger, Sync) from `<ClerqueLogo />`. The
 * wordmark to the right reads "Clerque · Counter" with the product name
 * brand-tinted in primary brown.
 *
 *   "Clerque"   → ink colour, font-display, weight 800
 *   "·"         → faint colour, fixed inline margin
 *   "Counter"   → primary brown, font-display, weight 800
 *
 * Sizes:
 *   sm  → 24dp mark, 14sp wordmark (used in app-bars)
 *   md  → 40dp mark, 22sp wordmark (sign-in card)
 *   lg  → 96dp mark, 26sp wordmark (splash)
 *   xl  → 152dp mark, 56sp wordmark (tablet splash)
 *
 * Direction defaults to row; pass `column` on the splash screen.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import ClerqueLogo from '@/components/ClerqueLogo';
import { colors, fonts, spacing } from '@/theme';

export type BrandSize = 'sm' | 'md' | 'lg' | 'xl';
type Direction = 'row' | 'column';

interface Props {
  size?:      BrandSize;
  direction?: Direction;
  /** When true the wordmark renders in white (used over dark surfaces). */
  onDark?: boolean;
}

const SIZE_MAP: Record<BrandSize, { mark: number; word: number; gap: number }> = {
  sm: { mark: 28,  word: 14, gap: spacing.s2 },
  md: { mark: 44,  word: 22, gap: spacing.s3 },
  lg: { mark: 96,  word: 26, gap: spacing.s4 },
  xl: { mark: 152, word: 56, gap: spacing.s5 },
};

export default function BrandLockup({
  size = 'sm',
  direction = 'row',
  onDark = false,
}: Props): React.ReactElement {
  const spec = SIZE_MAP[size];
  const inkColour    = onDark ? '#FFFFFF'              : colors.ink;
  const dotColour    = onDark ? 'rgba(255,255,255,.45)' : colors.faint;
  const counterColour = onDark ? colors.primaryContainer : colors.primary;

  return (
    <View style={[styles.row, { flexDirection: direction, gap: spec.gap, alignItems: 'center' }]}>
      <ClerqueLogo size={spec.mark} />
      <View style={styles.word}>
        <Text style={{ fontFamily: fonts.displayBold, fontSize: spec.word, fontWeight: '800', color: inkColour, letterSpacing: -0.5 }}>
          Clerque
        </Text>
        <Text style={{ fontFamily: fonts.displayBold, fontSize: spec.word, fontWeight: '800', color: dotColour, marginHorizontal: 6 }}>
          ·
        </Text>
        <Text style={{ fontFamily: fonts.displayBold, fontSize: spec.word, fontWeight: '800', color: counterColour, letterSpacing: -0.5 }}>
          Counter
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:  { alignItems: 'center' },
  word: { flexDirection: 'row', alignItems: 'baseline' },
});
