/**
 * Clerque Counter — sync state pill
 *
 * Pixel-faithful to `.sync-pill` in design-source-v3:
 *   cream-soft surface, cream-deep 1dp border, pill radius, 8dp green dot
 *   with a soft 18%-opacity glow ring, label in 13sp medium ink.
 *
 *   state            label         dot           glow
 *   ──────────────── ───────────── ───────────── ─────────────────
 *   online           Online        success       success @ 18%
 *   offline          Offline · N    warning       warning @ 18%
 *   syncing          Syncing · N   info          info    @ 18%
 *
 * Reads `useSync()` directly so it can be dropped anywhere without prop-
 * drilling. Pass `compact` to shrink for app-bar use.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useSync } from '@/offline/SyncProvider';
import { colors, fonts, radii, spacing } from '@/theme';

interface Props {
  compact?: boolean;
}

export default function SyncPill({ compact }: Props): React.ReactElement {
  const { state, queuedCount } = useSync();
  const spec = tone(state, queuedCount);

  return (
    <View
      style={[
        styles.pill,
        compact && styles.pillCompact,
        { backgroundColor: spec.bg, borderColor: spec.border },
      ]}
    >
      <View style={[styles.dotGlow, { backgroundColor: spec.glow }]}>
        <View style={[styles.dot, { backgroundColor: spec.dot }]} />
      </View>
      <Text style={[styles.label, compact && styles.labelCompact, { color: spec.fg }]}>
        {spec.label}
      </Text>
    </View>
  );
}

function tone(state: 'online' | 'offline' | 'syncing', queued: number) {
  if (state === 'offline') {
    return {
      bg:     colors.warningSoft,
      border: '#F8D6A1',
      fg:     colors.warningDeep,
      dot:    colors.warning,
      glow:   'rgba(245,158,11,0.18)',
      label:  queued > 0 ? `Offline · ${queued}` : 'Offline',
    };
  }
  if (state === 'syncing') {
    return {
      bg:     colors.infoSoft,
      border: '#BFD8FB',
      fg:     colors.infoDeep,
      dot:    colors.info,
      glow:   'rgba(37,99,235,0.18)',
      label:  queued > 0 ? `Syncing · ${queued}` : 'Syncing',
    };
  }
  return {
    bg:     colors.creamSoft,
    border: colors.creamDeep,
    fg:     colors.ink,
    dot:    colors.success,
    glow:   'rgba(16,185,129,0.18)',
    label:  'Online',
  };
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    paddingHorizontal: spacing.s3,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  pillCompact: { paddingHorizontal: 10, paddingVertical: 4 },
  dotGlow: {
    width: 14, height: 14, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label:        { fontFamily: fonts.bodyMedium, fontSize: 13, fontWeight: '500' },
  labelCompact: { fontSize: 11 },
});
