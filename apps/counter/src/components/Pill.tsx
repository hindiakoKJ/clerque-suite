import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, radii, spacing, text as textTokens } from '@/theme/tokens';

export type PillTone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'primary';

interface PillProps {
  tone?: PillTone;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Optional leading dot indicator. */
  dot?: boolean;
}

const TONES: Record<PillTone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: colors.creamSoft, fg: colors.ink, dot: colors.muted },
  success: { bg: colors.successSoft, fg: colors.successDeep, dot: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warningDeep, dot: colors.warning },
  error:   { bg: colors.errorSoft, fg: colors.errorDeep, dot: colors.error },
  info:    { bg: colors.infoSoft, fg: colors.infoDeep, dot: colors.info },
  primary: { bg: colors.primaryContainer, fg: colors.primaryInk, dot: colors.primary },
};

export default function Pill({ tone = 'neutral', children, style, dot }: PillProps) {
  const palette = TONES[tone];
  return (
    <View style={[styles.base, { backgroundColor: palette.bg }, style]}>
      {dot && <View style={[styles.dot, { backgroundColor: palette.dot }]} />}
      <Text style={[textTokens.caption, { color: palette.fg, fontWeight: '700' }]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 3,
    paddingHorizontal: spacing.s3,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
