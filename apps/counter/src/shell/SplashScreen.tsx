/**
 * Clerque Counter — Splash (P-01)
 *
 * Cold-boot loading state. Pixel-faithful to design-source-v3 P-01:
 *   • Linear-gradient backdrop (creamSoft → creamDeep)
 *   • XL brand lockup, column orientation
 *   • "Loading tenant…" muted caption
 *   • 140×3dp progress bar with a 64% filled bar in primary brown
 *   • Mono version label pinned to the bottom
 *
 * Rendered by RootNavigator while `ready` is false (cached JWT decoding,
 * device-mode + tenant config hydration).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { Text } from 'react-native-paper';

import BrandLockup from '@/components/BrandLockup';
import { colors, fonts } from '@/theme';

export default function SplashScreen(): React.ReactElement {
  const version = (Constants.expoConfig?.version ?? '0.0.0');
  const build   = String(Constants.expoConfig?.runtimeVersion ?? '—');

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <BrandLockup size="lg" direction="column" />
        <Text style={styles.loading}>Loading tenant…</Text>
        <View style={styles.barTrack}>
          <View style={styles.barFill} />
        </View>
      </View>
      <Text style={styles.version}>v{version} · build {build}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.creamSoft },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  loading: { fontFamily: fonts.bodyMedium, fontSize: 13, fontWeight: '500', color: colors.muted },
  barTrack: {
    width: 140, height: 3, borderRadius: 2,
    backgroundColor: colors.creamDeep,
    overflow: 'hidden',
  },
  barFill: { width: '64%', height: '100%', backgroundColor: colors.primary },
  version: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.faint,
    textAlign: 'center',
    paddingBottom: 24,
  },
});
