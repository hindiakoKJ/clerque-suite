/**
 * Clerque Counter — Top app bar
 * 64dp tall. Houses the tenant chip, a placeholder search field, the sync
 * pill (driven by SyncProvider), bell icon, and the role chip. Mirrors the
 * .appbar styles in screens-styles-v2.css.
 */

import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAuth } from '@/auth/AuthProvider';
import { useSync } from '@/offline/SyncProvider';
import { colors, radii, spacing, text } from '@/theme';

interface Props {
  onMenuPress?: () => void;
}

export default function TopBar({ onMenuPress }: Props): React.ReactElement {
  const { tenant, session, cashier } = useAuth();
  const { state, queuedCount } = useSync();

  const pill = pillForState(state, queuedCount);

  return (
    <View style={styles.appbar}>
      <Pressable onPress={onMenuPress} style={styles.iconBtn} hitSlop={12}>
        <MaterialCommunityIcons name="menu" size={24} color={colors.ink} />
      </Pressable>

      <View style={styles.tenant}>
        <Text style={styles.tenantName}>{tenant?.name ?? 'Clerque · Counter'}</Text>
        <Text style={styles.tenantSub}>
          {tenant ? `Tenant · ${tenant.id.slice(0, 8)}` : 'Not signed in'}
        </Text>
      </View>

      <View style={styles.search}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.faint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search products, orders, customers"
          placeholderTextColor={colors.faint}
          editable
        />
      </View>

      <View style={styles.right}>
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <View style={[styles.pillDot, { backgroundColor: pill.fg }]} />
          <Text style={[styles.pillLabel, { color: pill.fg }]}>{pill.label}</Text>
        </View>

        <Pressable style={styles.iconBtn} hitSlop={12}>
          <MaterialCommunityIcons name="bell-outline" size={22} color={colors.ink} />
        </Pressable>

        {cashier ? (
          <View style={styles.roleChip}>
            <Text style={styles.roleChipText}>{cashier.name}</Text>
          </View>
        ) : session ? (
          <View style={styles.roleChip}>
            <Text style={styles.roleChipText}>{session.user.role}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function pillForState(state: 'online' | 'offline' | 'syncing', queued: number) {
  if (state === 'offline') {
    return { bg: colors.warningSoft, fg: colors.warningDeep, label: `Offline · ${queued} queued` };
  }
  if (state === 'syncing') {
    return { bg: colors.infoSoft, fg: colors.infoDeep, label: `Syncing · ${queued} left` };
  }
  return { bg: colors.successSoft, fg: colors.successDeep, label: 'Online' };
}

const styles = StyleSheet.create({
  appbar: {
    height: 64,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.s4,
    gap: spacing.s3,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tenant: { justifyContent: 'center', minWidth: 140 },
  tenantName: { ...text.bodyLg, color: colors.ink, fontWeight: '700' },
  tenantSub: { ...text.caption, color: colors.muted },
  search: {
    flex: 1,
    height: 40,
    backgroundColor: colors.creamSoft,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.s3,
    gap: spacing.s2,
  },
  searchInput: { flex: 1, ...text.body, color: colors.ink, paddingVertical: 0 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s1,
    borderRadius: radii.pill,
    gap: spacing.s2,
    height: 28,
  },
  pillDot: { width: 6, height: 6, borderRadius: 999 },
  pillLabel: { ...text.caption, fontWeight: '700' },
  roleChip: {
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s1,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryContainer,
    height: 28,
    justifyContent: 'center',
  },
  roleChipText: { ...text.caption, color: colors.primaryInk, fontWeight: '700' },
});
