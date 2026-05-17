/**
 * Clerque Counter — Settings
 *
 * A flat list of settings entries (Paper `List.Item` for consistent style).
 * Most rows fire imperative actions on AuthProvider / device-mode storage;
 * branch picker is inline. Printer / Displays / Receipt customization rows
 * navigate to dedicated screens (Printer is owned by the printer agent and
 * may not exist yet — we fall back to a "Coming soon" alert).
 */

import React, { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Divider, List, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';

import { useAuth } from '@/auth/AuthProvider';
import { useBranchContext } from '@/api/BranchContext';
import TopBar from '@/shell/TopBar';
import { clearDeviceMode } from '@/device-mode/storage';
import { colors, radii, spacing, text as textTokens } from '@/theme';
import type { AppDrawerParamList } from '@/shell/AppDrawer';

interface Props {
  onMenuPress?: () => void;
}

export default function SettingsScreen({ onMenuPress }: Props): React.ReactElement {
  const { tenant, session, cashier, signOut, lockToPin } = useAuth();
  const { branches, activeBranch, setActiveBranch } = useBranchContext();
  const navigation = useNavigation<DrawerNavigationProp<AppDrawerParamList>>();

  const [branchPickerOpen, setBranchPickerOpen] = useState(false);

  const receiptCustomization = tenant?.planFeatures?.receiptCustomization ?? 'none';

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will be returned to the sign-in screen.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const confirmChangeDeviceMode = () => {
    Alert.alert(
      'Change device mode?',
      'You will be returned to the device-mode picker and signed out.',
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

  const openPrinter = () => {
    try {
      navigation.navigate('Printer');
    } catch {
      Alert.alert('Printer settings', 'Printer settings screen is not available yet.');
    }
  };

  const openReceiptCustomization = () => {
    Linking.openURL('https://clerque.com/app/settings/receipt').catch(() => {
      Alert.alert('Receipt customization', 'Open clerque.com to customize your receipt.');
    });
  };

  return (
    <View style={styles.root}>
      <TopBar onMenuPress={onMenuPress} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.s6 }}>
        <SectionHeader label="Cashier" />
        <List.Item
          title={cashier?.name ?? session?.user.name ?? '—'}
          description={cashier ? 'Active cashier session' : 'No cashier verified'}
          left={(p) => <List.Icon {...p} icon="account-circle-outline" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={lockToPin}
        />
        <List.Item
          title="Switch cashier"
          description="Lock back to PIN entry"
          left={(p) => <List.Icon {...p} icon="account-switch-outline" />}
          onPress={lockToPin}
        />

        <Divider style={styles.divider} />
        <SectionHeader label="Tenant" />
        <List.Item
          title={tenant?.name ?? '—'}
          description={tenant ? `ID ${tenant.id}` : 'Not signed in'}
          left={(p) => <List.Icon {...p} icon="domain" />}
        />

        <Divider style={styles.divider} />
        <SectionHeader label="Branch" />
        <List.Item
          title={activeBranch?.name ?? 'No branch selected'}
          description={
            branches.length > 1
              ? `${branches.length} branches · tap to switch`
              : 'Single-branch tenant'
          }
          left={(p) => <List.Icon {...p} icon="store-outline" />}
          right={(p) =>
            branches.length > 1 ? <List.Icon {...p} icon="chevron-down" /> : null
          }
          onPress={() => branches.length > 1 && setBranchPickerOpen((v) => !v)}
        />
        {branchPickerOpen && branches.length > 1 ? (
          <View style={styles.branchPickerWrap}>
            {branches.map((b) => {
              const active = b.id === activeBranch?.id;
              return (
                <List.Item
                  key={b.id}
                  title={b.name}
                  left={(p) => (
                    <List.Icon
                      {...p}
                      icon={active ? 'check-circle' : 'circle-outline'}
                      color={active ? colors.primary : colors.muted}
                    />
                  )}
                  onPress={() => {
                    setActiveBranch(b);
                    setBranchPickerOpen(false);
                  }}
                />
              );
            })}
          </View>
        ) : null}

        <Divider style={styles.divider} />
        <SectionHeader label="Devices" />
        <List.Item
          title="Printer"
          description="Bluetooth thermal printer pairing"
          left={(p) => <List.Icon {...p} icon="printer-outline" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={openPrinter}
        />
        <List.Item
          title="Displays"
          description="Pair customer display or KDS"
          left={(p) => <List.Icon {...p} icon="television" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => navigation.navigate('Displays')}
        />

        {receiptCustomization !== 'none' ? (
          <>
            <Divider style={styles.divider} />
            <SectionHeader label="Receipt" />
            <List.Item
              title="Receipt customization"
              description={`Plan: ${receiptCustomization} · opens in browser`}
              left={(p) => <List.Icon {...p} icon="receipt" />}
              right={(p) => <List.Icon {...p} icon="open-in-new" />}
              onPress={openReceiptCustomization}
            />
          </>
        ) : null}

        <Divider style={styles.divider} />
        <SectionHeader label="Device" />
        <List.Item
          title="Change device mode"
          description="Return to the device-mode picker"
          left={(p) => <List.Icon {...p} icon="cellphone-cog" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={confirmChangeDeviceMode}
        />

        <Divider style={styles.divider} />
        <List.Item
          title="Sign out"
          titleStyle={{ color: colors.errorDeep, fontWeight: '700' }}
          left={(p) => (
            <View {...p}>
              <MaterialCommunityIcons name="logout" size={22} color={colors.errorDeep} />
            </View>
          )}
          onPress={confirmSignOut}
        />
      </ScrollView>
    </View>
  );
}

function SectionHeader({ label }: { label: string }): React.ReactElement {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  divider: { marginVertical: spacing.s2 },
  sectionLabel: {
    ...textTokens.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.s4,
    paddingTop: spacing.s4,
    paddingBottom: spacing.s1,
    fontWeight: '700',
  },
  branchPickerWrap: {
    backgroundColor: colors.creamSoft,
    borderRadius: radii.md,
    marginHorizontal: spacing.s3,
    marginBottom: spacing.s2,
  },
});
