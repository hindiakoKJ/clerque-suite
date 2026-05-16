/**
 * Clerque Counter — Root navigator
 * Switches between the Auth stack (sign-in → cashier PIN) and the App drawer
 * based on AuthProvider state. The "ready" flag prevents a flash of the
 * sign-in screen on cold boot while we're still rehydrating from storage.
 */

import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '@/auth/AuthProvider';
import SignInScreen from '@/auth/SignInScreen';
import CashierPinScreen from '@/auth/CashierPinScreen';
import AppDrawer from '@/shell/AppDrawer';
import { colors } from '@/theme';

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

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const signedIn = !!session && !!cashier?.pinVerifiedAt;

  return (
    <Root.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {signedIn ? (
        <Root.Screen name="App" component={AppDrawer} />
      ) : (
        <Root.Screen name="Auth" component={AuthFlow} />
      )}
    </Root.Navigator>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
