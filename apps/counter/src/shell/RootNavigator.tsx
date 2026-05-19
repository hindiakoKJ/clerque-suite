/**
 * Clerque Counter — Root navigator
 *
 * Boot-time decision tree:
 *
 *   1. Read `clerque.deviceMode` from SecureStore.
 *   2. If missing                  → render the DeviceMode picker.
 *   3. CASHIER / OWNER_SPOTCHECK   → fall through to AuthStack / AppDrawer.
 *   4. CUSTOMER_DISPLAY            → render CustomerDisplayScreen (no auth).
 *   5. KDS                         → render KdsScreen           (no auth).
 *
 * On every boot for non-cashier modes we call GET /display-pairing/whoami
 * with the stored deviceToken; on 4xx the SecureStore key is wiped and the
 * user lands back on the picker (handled by the surface screens themselves).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '@/auth/AuthProvider';
import SignInScreen from '@/auth/SignInScreen';
import CashierPinScreen from '@/auth/CashierPinScreen';
import AppDrawer from '@/shell/AppDrawer';
import PhoneTabNavigator from '@/shell/PhoneTabNavigator';
import SplashScreen from '@/shell/SplashScreen';
import { useDeviceSize } from '@/shell/useDeviceSize';
import DeviceModePicker from '@/device-mode/DeviceMode';
import CustomerDisplayScreen from '@/device-mode/CustomerDisplayScreen';
import KdsScreen from '@/device-mode/KdsScreen';
import { readDeviceMode, type DeviceMode } from '@/device-mode/storage';

type AuthStackParamList = {
  SignIn: undefined;
  CashierPin: undefined;
};

type RootStackParamList = {
  Auth: undefined;
  App: undefined;
};

const Auth = createNativeStackNavigator<AuthStackParamList>();
const Root = createNativeStackNavigator<RootStackParamList>();

function AuthFlow(): React.ReactElement {
  const { session } = useAuth();
  return (
    <Auth.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {session ? (
        <Auth.Screen name="CashierPin" component={CashierPinScreen} />
      ) : (
        <Auth.Screen name="SignIn" component={SignInScreen} />
      )}
    </Auth.Navigator>
  );
}

export default function RootNavigator(): React.ReactElement {
  const { ready, session, cashier } = useAuth();
  const [modeReady, setModeReady] = useState(false);
  const [mode, setMode] = useState<DeviceMode | null>(null);

  const refreshMode = useCallback(async () => {
    const m = await readDeviceMode();
    setMode(m);
    setModeReady(true);
  }, []);

  useEffect(() => { void refreshMode(); }, [refreshMode]);

  if (!ready || !modeReady) {
    return <SplashScreen />;
  }

  // First-launch picker — nothing chosen yet.
  if (!mode) {
    return <DeviceModePicker onChosen={(m) => setMode(m)} />;
  }

  // Kiosk surfaces — no auth required, token is the credential.
  if (mode.kind === 'CUSTOMER_DISPLAY') {
    return (
      <CustomerDisplayScreen
        pairing={mode.pairing}
        onUnpaired={() => { setMode(null); }}
      />
    );
  }
  if (mode.kind === 'KDS') {
    return (
      <KdsScreen
        pairing={mode.pairing}
        onUnpaired={() => { setMode(null); }}
      />
    );
  }

  // CASHIER + OWNER_SPOTCHECK — same JWT-backed flow.
  const signedIn = !!session && !!cashier?.pinVerifiedAt;

  return (
    <Root.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {signedIn ? (
        <Root.Screen name="App" component={AppShellSwitch} />
      ) : (
        <Root.Screen name="Auth" component={AuthFlow} />
      )}
    </Root.Navigator>
  );
}

/**
 * Branches the post-auth shell on device size. Tablets get the existing
 * drawer + 3-pane terminal; phones get an owner-first bottom-tab shell that
 * intentionally is NOT a miniaturized till.
 */
function AppShellSwitch(): React.ReactElement {
  const size = useDeviceSize();
  return size === 'tablet' ? <AppDrawer /> : <PhoneTabNavigator />;
}

