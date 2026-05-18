/**
 * Clerque Counter — Phone top app-bar (56dp).
 *
 * Mirrors the `.appbar` block in design-source-v3/phone-414x900.html — left
 * slot for a back chevron or brand mark, centre title, right slot for an
 * online pill + cashier avatar.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAuth } from '@/auth/AuthProvider';
import { colors, radii, spacing, text as textTokens } from '@/theme';

interface Props {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /** Hide the right-side cashier avatar + sync pill. */
  hideRight?: boolean;
  right?: React.ReactNode;
}

export default function PhoneHeader({ title, subtitle, onBack, hideRight, right }: Props): React.ReactElement {
  const { cashier, session } = useAuth();
  const initials = (cashier?.name ?? session?.user.name ?? '·')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View style={styles.bar}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} style={styles.iconBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.ink} />
        </Pressable>
      ) : (
        <View style={styles.iconBtn} />
      )}
      <View style={styles.titleWrap}>
        {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
        {subtitle ? <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {hideRight ? null : right ?? (
        <View style={styles.right}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 56,
    paddingHorizontal: spacing.s4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { ...textTokens.displaySm, color: colors.ink, fontSize: 16 },
  sub: { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  avatar: {
    width: 32, height: 32, borderRadius: radii.sm,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onPrimary, fontWeight: '800', fontSize: 12 },
});
