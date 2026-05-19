/**
 * Clerque Counter — Phone app-bar (56dp)
 *
 * Pixel-faithful to `.appbar` block in design-source-v3/phone-414x900.html
 * (see P-04 dashboard, P-05 sell, etc.). Two layouts:
 *
 *   variant="brand"  — used on tab roots (Dashboard / Sell list / Shift /
 *                      Orders): brand lockup on the left, sync pill + cashier
 *                      avatar on the right. Optional sub-row with a screen
 *                      title for screens like "Today · Sun May 18".
 *
 *   variant="title"  — used on pushed stack screens (Cart, Modifier, Receipt,
 *                      Settings): back chevron + title/subtitle + optional
 *                      right slot (avatar by default).
 *
 * No drawer button — phones use the bottom-tab navigator, not a drawer.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import BrandLockup from '@/components/BrandLockup';
import SyncPill from '@/components/SyncPill';
import { colors, fonts, radii, spacing, text as textTokens } from '@/theme';

type Variant = 'brand' | 'title';

interface Props {
  variant?: Variant;
  /** title variant only. */
  title?:    string;
  subtitle?: string;
  /** title variant only. Tap → goes back. */
  onBack?: () => void;
  /** Hide the right-side cashier avatar + sync pill. */
  hideRight?: boolean;
  /** Replace the default right slot. */
  right?: React.ReactNode;
}

export default function PhoneHeader({
  variant = 'title',
  title,
  subtitle,
  onBack,
  hideRight,
  right,
}: Props): React.ReactElement {
  const { cashier, session } = useAuth();
  const insets = useSafeAreaInsets();
  const initials = (cashier?.name ?? session?.user.name ?? '·')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  const rightSlot = hideRight ? null : right ?? (
    <View style={styles.rightGroup}>
      <SyncPill compact />
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
      {variant === 'brand' ? (
        <>
          <BrandLockup size="sm" />
          <View style={styles.spacer} />
          {rightSlot}
        </>
      ) : (
        <>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={8} style={styles.iconBtn}>
              <MaterialCommunityIcons name="arrow-left" size={22} color={colors.muted} />
            </Pressable>
          ) : (
            <View style={styles.iconBtn} />
          )}
          <View style={styles.titleWrap}>
            {title ?    <Text style={styles.title}    numberOfLines={1}>{title}</Text>    : null}
            {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          {rightSlot}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 56,
    paddingHorizontal: spacing.s4,
    paddingBottom: spacing.s2,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.s2,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  spacer: { flex: 1 },
  iconBtn: {
    width: 36, height: 36, borderRadius: radii.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title:    { fontFamily: fonts.displayBold, fontSize: 15, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },
  subtitle: { ...textTokens.caption, color: colors.muted, marginTop: 1, fontSize: 10 },
  rightGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  avatar: {
    width: 32, height: 32, borderRadius: radii.sm,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onPrimary, fontFamily: fonts.displayBold, fontWeight: '800', fontSize: 12 },
});
