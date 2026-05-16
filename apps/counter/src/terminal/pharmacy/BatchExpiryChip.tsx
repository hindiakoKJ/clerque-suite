/**
 * Small badge for a single batch — lot # + expiry, color-coded:
 *   green (OK, > 90 days)
 *   amber (30-90 days)
 *   red   (< 30 days)
 * Tap target is a chip so each batch can be the pharmacist's batch pick.
 */

import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { colors, spacing, radii, text } from '@/theme/tokens';
import { expiryTier, type Batch } from './mockCatalog';

const TIER = {
  OK:    { bg: colors.successSoft, fg: colors.successDeep },
  AMBER: { bg: colors.warningSoft, fg: colors.warningDeep },
  RED:   { bg: colors.errorSoft,   fg: colors.errorDeep },
} as const;

function formatShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
}

export const BatchExpiryChip: React.FC<{
  batch: Batch;
  selected?: boolean;
  onPress?: () => void;
}> = ({ batch, selected, onPress }) => {
  const tier = expiryTier(batch.expiresAt);
  const t = TIER[tier];
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: t.bg, borderColor: selected ? t.fg : 'transparent' },
        selected && styles.selected,
      ]}
    >
      <Text style={[styles.lot, { color: t.fg }]}>{batch.lotId}</Text>
      <Text style={[styles.exp, { color: t.fg }]}>
        exp {formatShort(batch.expiresAt)} · {batch.qtyRemaining} u
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s2,
    borderRadius: radii.sm,
    borderWidth: 2,
    minWidth: 140,
  },
  selected: { transform: [{ scale: 1.02 }] },
  lot: { ...text.caption, fontWeight: '700' },
  exp: { ...text.caption, marginTop: 2 },
});

export default BatchExpiryChip;
