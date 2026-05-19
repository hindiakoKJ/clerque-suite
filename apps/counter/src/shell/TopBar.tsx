/**
 * Clerque Counter — Top app bar
 * 64dp tall. Houses the tenant chip, a placeholder search field, the sync
 * pill (driven by SyncProvider), bell icon, and the role chip. Mirrors the
 * .appbar styles in screens-styles-v2.css.
 */

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { useSync } from '@/offline/SyncProvider';
import { useBranchContext } from '@/api/BranchContext';
import BrandLockup from '@/components/BrandLockup';
import SyncPill from '@/components/SyncPill';
import { colors, radii, spacing, text } from '@/theme';

interface Props {
  onMenuPress?: () => void;
}

export default function TopBar({ onMenuPress }: Props): React.ReactElement {
  const { tenant, session, cashier } = useAuth();
  const { branches, activeBranch, setActiveBranch } = useBranchContext();
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);

  const showBranchPicker = branches.length > 1;
  // Add OS status-bar inset on top — without this the bar draws under
  // the clock / signal / battery icons on Android phones (the tablet
  // drawer's `headerShown: false` doesn't reserve the space for us).
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.appbar, { paddingTop: insets.top }]}>
      <Pressable onPress={onMenuPress} style={styles.iconBtn} hitSlop={12}>
        <MaterialCommunityIcons name="menu" size={24} color={colors.muted} />
      </Pressable>

      <BrandLockup size="md" />

      <View style={styles.tenant}>
        <Text style={styles.tenantName} numberOfLines={1}>{tenant?.name ?? '—'}</Text>
        <Text style={styles.tenantSub}>
          {tenant ? (tenant.planCode ? `${tenant.planCode.replace('_', ' ')} plan` : 'Tenant') : 'Not signed in'}
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
        {showBranchPicker && activeBranch && (
          <Pressable
            onPress={() => setBranchPickerOpen(true)}
            style={styles.branchChip}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="store-outline" size={14} color={colors.primaryInk} />
            <Text style={styles.branchChipText} numberOfLines={1}>{activeBranch.name}</Text>
            <MaterialCommunityIcons name="chevron-down" size={14} color={colors.primaryInk} />
          </Pressable>
        )}
        <Modal
          visible={branchPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setBranchPickerOpen(false)}
        >
          <Pressable style={styles.modalScrim} onPress={() => setBranchPickerOpen(false)}>
            <View style={styles.branchSheet}>
              <Text style={styles.branchSheetTitle}>Switch branch</Text>
              {branches.map((b) => {
                const isActive = b.id === activeBranch?.id;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => {
                      setActiveBranch(b);
                      setBranchPickerOpen(false);
                    }}
                    style={[styles.branchOption, isActive && styles.branchOptionActive]}
                  >
                    <Text style={[styles.branchOptionText, isActive && styles.branchOptionTextActive]}>
                      {b.name}
                    </Text>
                    {b.address ? <Text style={styles.branchAddr}>{b.address}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>
        <SyncPill />

        <Pressable style={styles.iconBtn} hitSlop={12}>
          <MaterialCommunityIcons name="bell-outline" size={22} color={colors.ink} />
        </Pressable>

        {cashier ? (
          <View style={styles.roleChip}>
            <Text style={styles.roleChipText}>{cashier.name}</Text>
          </View>
        ) : session?.user?.role ? (
          <View style={styles.roleChip}>
            <Text style={styles.roleChipText}>{session.user.role}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  appbar: {
    // height removed — inset padding (added inline at render) drives total
    // height now. minHeight keeps the 64dp content row intact.
    minHeight: 64,
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

  branchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.s2,
    paddingVertical: spacing.s1,
    borderRadius: radii.pill,
    backgroundColor: colors.creamSoft,
    borderWidth: 1,
    borderColor: colors.rule,
    height: 28,
    maxWidth: 180,
  },
  branchChipText: { ...text.caption, color: colors.primaryInk, fontWeight: '700' },

  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
    alignItems: 'flex-end',
    paddingTop: 68,
    paddingRight: spacing.s4,
  },
  branchSheet: {
    minWidth: 260,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.s3,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  branchSheetTitle: { ...text.caption, color: colors.muted, marginBottom: spacing.s2, textTransform: 'uppercase', fontWeight: '700' },
  branchOption: {
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s3,
    borderRadius: radii.sm,
  },
  branchOptionActive: { backgroundColor: colors.primaryContainer },
  branchOptionText: { ...text.body, color: colors.ink, fontWeight: '600' },
  branchOptionTextActive: { color: colors.primaryInk, fontWeight: '700' },
  branchAddr: { ...text.caption, color: colors.muted, marginTop: 2 },
});
