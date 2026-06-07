/**
 * Clerque Counter — Phone "More" tab
 *
 * List of secondary links — the drawer-less phone shell uses this as the
 * settings / approvals / displays / sign-out catch-all.
 */
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import PhoneHeader from '@/shell/phone/PhoneHeader';
import { useAuth } from '@/auth/AuthProvider';
import { useBranchContext } from '@/api/BranchContext';
import { api, ApiHttpError } from '@/api/client';
import { clearDeviceMode } from '@/device-mode/storage';
import { colors, radii, spacing, text as textTokens } from '@/theme';
import type { PhoneMoreStackParamList } from '@/shell/phone/types';

type Props = NativeStackScreenProps<PhoneMoreStackParamList, 'MoreRoot'>;

export default function PhoneMoreScreen({ navigation }: Props): React.ReactElement {
  const { tenant, session, cashier, signOut, lockToPin } = useAuth();
  const { activeBranch } = useBranchContext();

  const approvals = useQuery<{ count: number }>({
    queryKey: ['void-approvals', 'pending-count'],
    queryFn: async () => {
      try {
        const list = await api.get<unknown[]>('/void-approvals?status=PENDING');
        return { count: Array.isArray(list) ? list.length : 0 };
      } catch (err) {
        if (err instanceof ApiHttpError) return { count: 0 };
        throw err;
      }
    },
    retry: 0,
    staleTime: 30_000,
  });

  const onChangeDeviceMode = async () => {
    Alert.alert(
      'Change device mode',
      'This signs you out and returns to the device-mode picker.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: async () => {
            await clearDeviceMode();
            await signOut();
          },
        },
      ],
    );
  };

  const isOwner = session?.user.role === 'BUSINESS_OWNER' || session?.user.role === 'BRANCH_MANAGER';
  const pendingCount = approvals.data?.count ?? 0;

  return (
    <View style={styles.root}>
      <PhoneHeader title="More" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          <Text style={styles.tenant}>{tenant?.name ?? '—'}</Text>
          <Text style={styles.sub}>
            {activeBranch?.name ?? 'No branch'} · {cashier?.name ?? session?.user.name ?? ''}
          </Text>
        </View>

        <Section title="Account">
          <Item
            icon="account-switch"
            label="Switch cashier"
            onPress={() => { lockToPin(); }}
          />
          <Item
            icon="store"
            label={`Tenant · ${tenant?.name ?? '—'}`}
            sub={activeBranch?.name ?? undefined}
          />
        </Section>

        <Section title="Bakery">
          <Item
            icon="weather-night"
            label="Close & Plan"
            sub="Evening routine — review today, plan tomorrow"
            onPress={() => navigation.navigate('CloseAndPlan')}
          />
          <Item
            icon="cake-variant"
            label="Today's pickups"
            sub="Custom cake reservations"
            onPress={() => navigation.navigate('Pickups')}
          />
        </Section>

        <Section title="Devices">
          <Item
            icon="television"
            label="Displays"
            sub="Generate pairing codes"
            onPress={() => navigation.navigate('Displays')}
          />
          <Item
            icon="printer-outline"
            label="Printer"
            sub="Bluetooth thermal (tablet only)"
            onPress={() => navigation.navigate('Printer')}
          />
        </Section>

        {isOwner ? (
          <Section title="Owner">
            <Item
              icon="shield-check"
              label="Approvals"
              sub={pendingCount > 0 ? `${pendingCount} waiting` : 'No pending'}
              badge={pendingCount > 0 ? String(pendingCount) : undefined}
              onPress={() => navigation.navigate('Approvals')}
            />
          </Section>
        ) : null}

        <Section title="Settings">
          <Item
            icon="cog-outline"
            label="App settings"
            onPress={() => navigation.navigate('Settings')}
          />
          <Item
            icon="cellphone-cog"
            label="Change device mode"
            onPress={onChangeDeviceMode}
          />
        </Section>

        <Pressable style={styles.signOut} onPress={signOut}>
          <MaterialCommunityIcons name="logout" size={20} color={colors.errorDeep} />
          <Text style={styles.signOutLabel}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

interface ItemProps {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  sub?: string;
  badge?: string;
  onPress?: () => void;
}
function Item({ icon, label, sub, badge, onPress }: ItemProps): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={colors.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.itemLabel}>{label}</Text>
        {sub ? <Text style={styles.itemSub}>{sub}</Text> : null}
      </View>
      {badge ? (
        <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>
      ) : null}
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.s4, gap: spacing.s4, paddingBottom: spacing.s7 },
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.s4,
  },
  tenant: { ...textTokens.displaySm, color: colors.ink },
  sub: { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  section: { gap: spacing.s2 },
  sectionTitle: { ...textTokens.caption, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, paddingLeft: spacing.s2 },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rule,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    minHeight: 56,
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  itemPressed: { backgroundColor: colors.creamSoft },
  itemLabel: { ...textTokens.body, color: colors.ink, fontWeight: '600' },
  itemSub: { ...textTokens.caption, color: colors.muted, marginTop: 2 },
  badge: {
    minWidth: 24, height: 24, paddingHorizontal: spacing.s2,
    borderRadius: 999, backgroundColor: colors.warning,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { ...textTokens.caption, color: colors.onPrimary, fontWeight: '800' },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s2,
    justifyContent: 'center',
    padding: spacing.s4,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.errorSoft,
    backgroundColor: colors.errorSoft,
  },
  signOutLabel: { ...textTokens.body, color: colors.errorDeep, fontWeight: '800' },
});
