/**
 * Clerque Counter — Offline banner
 * Amber pill that slides down from the top of the screen whenever connectivity
 * drops. Auto-hides 2s after recovery so cashiers know the reconnect happened.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSync } from '@/offline/SyncProvider';
import { colors, radii, spacing, text } from '@/theme';

export function OfflineBanner(): React.ReactElement | null {
  const { state } = useSync();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const slide = useRef(new Animated.Value(-80)).current;
  const recoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state === 'offline') {
      if (recoverTimeout.current) {
        clearTimeout(recoverTimeout.current);
        recoverTimeout.current = null;
      }
      setRecovered(false);
      setVisible(true);
    } else if (visible && !recovered) {
      // Just came back online — show recovery for 2s before hiding.
      setRecovered(true);
      recoverTimeout.current = setTimeout(() => {
        setVisible(false);
        setRecovered(false);
      }, 2000);
    }
    return () => {
      if (recoverTimeout.current) {
        clearTimeout(recoverTimeout.current);
        recoverTimeout.current = null;
      }
    };
  }, [state, visible, recovered]);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : -80,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  const bg = recovered ? colors.successSoft : colors.warningSoft;
  const fg = recovered ? colors.successDeep : colors.warningDeep;
  const label = recovered ? 'Back online — syncing now' : 'Working offline — sales will sync';

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.wrap,
        { top: insets.top + spacing.s2, transform: [{ translateY: slide }] },
      ]}
    >
      <Pressable
        // Tap target intentionally large; drawer navigation hookup happens
        // via the global drawer ref pattern in a follow-up.
        onPress={() => {}}
        style={[styles.pill, { backgroundColor: bg }]}
      >
        <View style={[styles.dot, { backgroundColor: fg }]} />
        <Text style={[styles.label, { color: fg }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s2,
    borderRadius: radii.pill,
    gap: spacing.s2,
  },
  dot: { width: 8, height: 8, borderRadius: 999 },
  label: { ...text.bodySm, fontWeight: '600' },
});
