/**
 * Small chip showing a drug's regulatory class: OTC / Rx / S2.
 * S2 (DDB_S2) is the controlled-substance class — supervisor PIN at dispense.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radii, text } from '@/theme/tokens';
import type { DrugSchedule } from './mockCatalog';

const VARIANT: Record<DrugSchedule, { bg: string; fg: string; label: string }> = {
  OTC:    { bg: colors.cream,       fg: colors.muted,       label: 'OTC' },
  RX:     { bg: colors.warningSoft, fg: colors.warningDeep, label: 'Rx' },
  DDB_S2: { bg: colors.errorSoft,   fg: colors.errorDeep,   label: 'S2 · controlled' },
};

export const ControlledBadge: React.FC<{ schedule: DrugSchedule }> = ({ schedule }) => {
  const v = VARIANT[schedule];
  return (
    <View style={[styles.chip, { backgroundColor: v.bg }]}>
      <Text style={[styles.text, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.s2,
    paddingVertical: 3,
    borderRadius: radii.xs,
    alignSelf: 'flex-start',
  },
  text: { ...text.caption, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
});

export default ControlledBadge;
