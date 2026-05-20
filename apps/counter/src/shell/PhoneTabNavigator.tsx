/**
 * Clerque Counter — Phone shell
 *
 * 5-tab bottom-tab navigator that replaces the tablet drawer on phones.
 * Phone is portrait-locked at startup (see App.tsx). Sell and More tabs
 * own nested native stacks so cart / modifier / approvals push naturally.
 *
 * Tabs (per design-source-v3/phone-414x900.html bottom bar):
 *   Dashboard · Sell · Orders · Shift · More
 */
import React, { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import OrdersScreen from '@/shell/OrdersScreen';
import SettingsScreen from '@/shell/SettingsScreen';
import PrinterSettingsScreen from '@/shell/PrinterSettingsScreen';

import PhoneDashboardScreen from '@/shell/phone/PhoneDashboardScreen';
import PhoneSellScreen from '@/shell/phone/PhoneSellScreen';
import PhoneModifierScreen from '@/shell/phone/PhoneModifierScreen';
import PhoneCartDrawer from '@/shell/phone/PhoneCartDrawer';
import PhoneShiftScreen from '@/shell/phone/PhoneShiftScreen';
import PhoneMoreScreen from '@/shell/phone/PhoneMoreScreen';
import PhoneApprovalsScreen from '@/shell/phone/PhoneApprovalsScreen';
import PhoneDisplaysCodegen from '@/shell/phone/PhoneDisplaysCodegen';
import PhonePickupsScreen from '@/shell/phone/PhonePickupsScreen';
import PhonePumpsScreen from '@/shell/phone/PhonePumpsScreen';
import PhoneRentalsScreen from '@/shell/phone/PhoneRentalsScreen';
import { useAuth } from '@/auth/AuthProvider';

import type {
  PhoneSellStackParamList,
  PhoneMoreStackParamList,
  PhoneTabParamList,
} from '@/shell/phone/types';
import { colors, fonts, spacing } from '@/theme';

const Tab = createBottomTabNavigator<PhoneTabParamList>();
const SellStack = createNativeStackNavigator<PhoneSellStackParamList>();
const MoreStack = createNativeStackNavigator<PhoneMoreStackParamList>();

function SellStackNavigator(): React.ReactElement {
  return (
    <SellStack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <SellStack.Screen name="SellList" component={PhoneSellScreen} />
      <SellStack.Screen name="Modifier" component={PhoneModifierScreen} />
      <SellStack.Screen name="Cart" component={PhoneCartDrawer} options={{ animation: 'slide_from_bottom' }} />
    </SellStack.Navigator>
  );
}

function MoreStackNavigator(): React.ReactElement {
  return (
    <MoreStack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <MoreStack.Screen name="MoreRoot" component={PhoneMoreScreen} />
      <MoreStack.Screen name="Approvals">
        {(p) => <PhoneApprovalsScreen onBack={() => p.navigation.goBack()} />}
      </MoreStack.Screen>
      <MoreStack.Screen name="Displays">
        {(p) => <PhoneDisplaysCodegen onBack={() => p.navigation.goBack()} />}
      </MoreStack.Screen>
      <MoreStack.Screen name="Printer">
        {(p) => <PrinterSettingsScreen onMenuPress={() => p.navigation.goBack()} />}
      </MoreStack.Screen>
      <MoreStack.Screen name="Settings">
        {(p) => <SettingsScreen onMenuPress={() => p.navigation.goBack()} />}
      </MoreStack.Screen>
      <MoreStack.Screen name="Pickups" component={PhonePickupsScreen} />
    </MoreStack.Navigator>
  );
}

function OrdersTabScreen(): React.ReactElement {
  return <OrdersScreen />;
}

export default function PhoneTabNavigator(): React.ReactElement {
  // Re-assert portrait lock on mount — phone class should never go landscape
  // even if the system thinks otherwise.
  useEffect(() => {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
  }, []);

  // Bottom system-gesture inset — Android gesture nav reserves ~24dp at the
  // very bottom that we must not paint into. Without this the tab labels
  // and icons sit right on top of the gesture bar.
  const insets = useSafeAreaInsets();

  // Vertical-aware primary tab: gas stations get a Pumps tab in the Sell
  // slot, DME (medical equipment) gets a Rentals tab between Sell and Orders.
  // Every other vertical sees the default Sell flow.
  const { tenant } = useAuth();
  const isGasStation = tenant?.businessType === 'GAS_STATION';
  const isDme        = tenant?.businessType === 'MEDICAL_EQUIPMENT';

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: [styles.tabBar, { height: 56 + insets.bottom, paddingBottom: insets.bottom }],
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: { paddingTop: 4 },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={PhoneDashboardScreen}
        options={{
          tabBarIcon: ({ color }: { color: string }) => <MaterialCommunityIcons name="view-dashboard-outline" size={22} color={color} />,
        }}
      />
      {isGasStation ? (
        <Tab.Screen
          name="Pumps"
          component={PhonePumpsScreen}
          options={{
            tabBarIcon: ({ color }: { color: string }) => <MaterialCommunityIcons name="gas-station" size={22} color={color} />,
          }}
        />
      ) : null}
      <Tab.Screen
        name="Sell"
        component={SellStackNavigator}
        options={{
          tabBarIcon: ({ color }: { color: string }) => <MaterialCommunityIcons name="cart-outline" size={22} color={color} />,
          // For gas stations, "Sell" is the c-store side — relabel.
          tabBarLabel: isGasStation ? 'C-store' : 'Sell',
        }}
      />
      {isDme ? (
        <Tab.Screen
          name="Rentals"
          component={PhoneRentalsScreen}
          options={{
            tabBarIcon: ({ color }: { color: string }) => <MaterialCommunityIcons name="package-variant" size={22} color={color} />,
          }}
        />
      ) : null}
      <Tab.Screen
        name="Orders"
        component={OrdersTabScreen}
        options={{
          tabBarIcon: ({ color }: { color: string }) => <MaterialCommunityIcons name="receipt" size={22} color={color} />,
        }}
      />
      <Tab.Screen
        name="Shift"
        component={PhoneShiftScreen}
        options={{
          tabBarIcon: ({ color }: { color: string }) => <MaterialCommunityIcons name="clock-outline" size={22} color={color} />,
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreStackNavigator}
        options={{
          tabBarIcon: ({ color }: { color: string }) => <MaterialCommunityIcons name="dots-horizontal" size={22} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

// Silence unused-import warnings when the View/Text imports are only required
// in commented-out states above.
void View;
void Text;
void spacing;

const styles = StyleSheet.create({
  tabBar: {
    height: 56 + 16, // 56dp surface + small safe-area padding
    paddingBottom: 8,
    paddingTop: 4,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  tabLabel: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
