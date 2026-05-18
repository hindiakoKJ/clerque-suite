/**
 * Clerque Counter — App drawer
 * React Navigation drawer with the cream surface + electric-blue active state
 * shown in key-screens-v2.html "04 · Terminal + nav drawer". Drawer width is
 * 320dp landscape / 280dp portrait. Bottom block carries sign-out, switch
 * cashier, and the current clock.
 */

import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from 'react-native-paper';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
  DrawerContentScrollView,
} from '@react-navigation/drawer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';

import { useAuth } from '@/auth/AuthProvider';
import { useSync } from '@/offline/SyncProvider';
import DisplaysScreen from '@/shell/DisplaysScreen';
import PrinterSettingsScreen from '@/shell/PrinterSettingsScreen';
import DashboardScreen from '@/shell/DashboardScreen';
import OrdersScreen from '@/shell/OrdersScreen';
import PendingSyncScreen from '@/shell/PendingSyncScreen';
import SettingsScreen from '@/shell/SettingsScreen';
import FleetScreen from '@/terminal/laundry/FleetScreen';
import TerminalRouter from '@/terminal/TerminalRouter';
import ShiftCoordinator from '@/shift/ShiftCoordinator';
import { clearDeviceMode } from '@/device-mode/storage';
import { colors, radii, spacing, text } from '@/theme';

export type AppDrawerParamList = {
  Dashboard: undefined;
  Terminal: undefined;
  Orders: undefined;
  Shift: undefined;
  ZRead: undefined;
  Fleet: undefined;
  Settings: undefined;
  Printer: undefined;
  Displays: undefined;
  PendingSync: undefined;
};

const Drawer = createDrawerNavigator<AppDrawerParamList>();

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface NavItem {
  key: keyof AppDrawerParamList;
  label: string;
  icon: IconName;
}

interface NavItemDef extends NavItem {
  /** When set, the item only renders for tenants of these business types. */
  showFor?: ReadonlyArray<string>;
  /** When set, the item only renders for users with these roles. */
  showForRoles?: ReadonlyArray<string>;
}

const ITEMS: NavItemDef[] = [
  { key: 'Dashboard',   label: 'Dashboard',         icon: 'view-dashboard-outline' },
  { key: 'Terminal',    label: 'Terminal',          icon: 'cash-register' },
  { key: 'Fleet',       label: 'Fleet',             icon: 'washing-machine', showFor: ['LAUNDRY'] },
  { key: 'Orders',      label: 'Orders',            icon: 'receipt' },
  { key: 'Shift',       label: 'Shift',             icon: 'clock-outline' },
  { key: 'ZRead',       label: "Today's Z-read",    icon: 'file-chart-outline' },
  { key: 'Settings',    label: 'Settings',          icon: 'cog-outline' },
  { key: 'Printer',     label: 'Printer',           icon: 'printer-outline' },
  { key: 'Displays',    label: 'Displays',          icon: 'television',
    showForRoles: ['BUSINESS_OWNER', 'BRANCH_MANAGER'] },
  { key: 'PendingSync', label: 'Pending sync',      icon: 'cloud-sync-outline' },
];

export default function AppDrawer(): React.ReactElement {
  const { width } = useWindowDimensions();
  const landscape = width >= 768;
  const drawerWidth = landscape ? 320 : 280;

  // Re-assert landscape lock on mount — tablet shell should never go portrait
  // even if a child screen previously tried to unlock the orientation.
  useEffect(() => {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      void ScreenOrientation
        .lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
        .catch(() => {});
    }
  }, []);

  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerBody {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: { width: drawerWidth, backgroundColor: colors.cream },
        drawerType: landscape ? 'slide' : 'front',
        swipeEdgeWidth: 32,
      }}
    >
      <Drawer.Screen name="Dashboard">
        {(p) => <DashboardScreen onMenuPress={() => p.navigation.openDrawer()} />}
      </Drawer.Screen>
      <Drawer.Screen name="Terminal">
        {() => <TerminalRouter />}
      </Drawer.Screen>
      <Drawer.Screen name="Orders">
        {(p) => <OrdersScreen onMenuPress={() => p.navigation.openDrawer()} />}
      </Drawer.Screen>
      <Drawer.Screen name="Shift">
        {(p) => <ShiftCoordinator onMenuPress={() => p.navigation.openDrawer()} />}
      </Drawer.Screen>
      <Drawer.Screen name="ZRead">
        {(p) => <ShiftCoordinator onMenuPress={() => p.navigation.openDrawer()} startInZRead />}
      </Drawer.Screen>
      <Drawer.Screen name="Fleet">
        {() => <FleetScreen />}
      </Drawer.Screen>
      <Drawer.Screen name="Settings">
        {(p) => <SettingsScreen onMenuPress={() => p.navigation.openDrawer()} />}
      </Drawer.Screen>
      <Drawer.Screen name="Printer">
        {(p) => <PrinterSettingsScreen onMenuPress={() => p.navigation.openDrawer()} />}
      </Drawer.Screen>
      <Drawer.Screen name="Displays">
        {(p) => <DisplaysScreen onMenuPress={() => p.navigation.openDrawer()} />}
      </Drawer.Screen>
      <Drawer.Screen name="PendingSync">
        {(p) => <PendingSyncScreen onMenuPress={() => p.navigation.openDrawer()} />}
      </Drawer.Screen>
    </Drawer.Navigator>
  );
}

function DrawerBody(props: DrawerContentComponentProps): React.ReactElement {
  const { tenant, session, cashier, signOut, lockToPin } = useAuth();
  const { queuedCount } = useSync();
  const activeRoute = props.state.routes[props.state.index]?.name;

  return (
    <DrawerContentScrollView
      {...props}
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}
    >
      <View style={styles.head}>
        <Text style={styles.tenantName}>{tenant?.name ?? 'Clerque'}</Text>
        <Text style={styles.tenantId}>{tenant ? `ID ${tenant.id.slice(0, 8)}` : '—'}</Text>
      </View>

      <View style={styles.nav}>
        {ITEMS.filter((it) => {
          if (it.showFor && !(tenant && it.showFor.includes(tenant.businessType))) return false;
          if (it.showForRoles && !(session?.user.role && it.showForRoles.includes(session.user.role))) return false;
          return true;
        }).map((it) => {
          const active = activeRoute === it.key;
          const badge = it.key === 'PendingSync' && queuedCount > 0 ? queuedCount : null;
          return (
            <Pressable
              key={it.key}
              onPress={() => props.navigation.navigate(it.key)}
              style={[styles.item, active && styles.itemActive]}
            >
              <MaterialCommunityIcons
                name={it.icon}
                size={20}
                color={active ? colors.primary : colors.muted}
                style={styles.itemIcon}
              />
              <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{it.label}</Text>
              {badge !== null ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.foot}>
        <Clock />
        <Text style={styles.footUser}>{cashier?.name ?? session?.user.name ?? ''}</Text>
        <Pressable onPress={lockToPin} style={styles.footBtn}>
          <Text style={styles.footBtnLabel}>Switch cashier</Text>
        </Pressable>
        <Pressable
          onPress={async () => { await clearDeviceMode(); await signOut(); }}
          style={styles.footBtn}
        >
          <Text style={styles.footBtnLabel}>Change device mode</Text>
        </Pressable>
        <Pressable onPress={signOut} style={[styles.footBtn, styles.footBtnDanger]}>
          <Text style={[styles.footBtnLabel, styles.footBtnDangerLabel]}>Sign out</Text>
        </Pressable>
      </View>
    </DrawerContentScrollView>
  );
}

function Clock(): React.ReactElement {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <Text style={styles.clock}>
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </Text>
  );
}

const styles = StyleSheet.create({
  scroll: { backgroundColor: colors.cream },
  scrollContent: { paddingTop: 0 },
  head: {
    padding: spacing.s5,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleStrong,
    backgroundColor: colors.cream,
  },
  tenantName: { ...text.displaySm, color: colors.ink },
  tenantId: { ...text.caption, color: colors.muted, marginTop: spacing.s1 },
  nav: { padding: spacing.s3, flex: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s3,
    borderRadius: radii.md,
    marginBottom: spacing.s1,
    gap: spacing.s3,
    minHeight: 48,
  },
  itemActive: { backgroundColor: colors.primaryContainer },
  itemIcon: { width: 22, textAlign: 'center' },
  itemLabel: { ...text.body, color: colors.ink, flex: 1, fontWeight: '500' },
  itemLabelActive: { color: colors.primaryInk, fontWeight: '700' },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: spacing.s2,
    borderRadius: 999,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...text.caption, color: colors.onPrimary, fontWeight: '700' },
  foot: {
    padding: spacing.s4,
    borderTopWidth: 1,
    borderTopColor: colors.ruleStrong,
    gap: spacing.s2,
  },
  clock: { ...text.displaySm, color: colors.ink, ...{ fontVariant: ['tabular-nums' as const] } },
  footUser: { ...text.caption, color: colors.muted, marginBottom: spacing.s2 },
  footBtn: {
    paddingVertical: spacing.s3,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    alignItems: 'center',
  },
  footBtnLabel: { ...text.body, color: colors.ink, fontWeight: '600' },
  footBtnDanger: { borderColor: colors.errorSoft, backgroundColor: colors.errorSoft },
  footBtnDangerLabel: { color: colors.errorDeep },
});
