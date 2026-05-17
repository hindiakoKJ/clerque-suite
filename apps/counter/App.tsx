import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Provider as PaperProvider } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dimensions } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useFonts as useInter,   Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts as useJakarta, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts as useMono,    JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';

import { paperTheme } from '@/theme';
import RootNavigator from '@/shell/RootNavigator';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import SupervisorPinHost from '@/auth/SupervisorPinHost';
import BarcodeScannerHost from '@/components/BarcodeScannerSheet';
import TenderingHost from '@/payment/TenderingHost';
import { OfflineBanner } from '@/offline/OfflineBanner';
import { SyncProvider } from '@/offline/SyncProvider';
import { BranchProvider } from '@/api/BranchContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 2, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

export default function App() {
  // Fonts are bundled as JS via @expo-google-fonts/* packages, so no TTFs
  // on disk are needed. Each hook loads its family in parallel; we boot
  // the app when all three return true (or after their internal error).
  const [interLoaded]   = useInter({   Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [jakartaLoaded] = useJakarta({ PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  const [monoLoaded]    = useMono({    JetBrainsMono_500Medium, JetBrainsMono_600SemiBold });
  const fontsLoaded = interLoaded && jakartaLoaded && monoLoaded;

  // Lock to landscape.
  //
  // Caveat — Expo Go's HOST Android activity declares orientation as
  // "unspecified" so even after lockAsync the OS may let the wrapper
  // re-rotate. The native lock only takes effect in a development /
  // production build (where app.json's `orientation: 'landscape'`
  // injects android:screenOrientation="landscape" on the activity).
  //
  // We try three increasingly aggressive paths so Expo Go gets as
  // close as possible:
  //   1. lockPlatformAsync with the Android constant 0 (= SCREEN_ORIENTATION_LANDSCAPE)
  //      and the iOS landscape array — most direct lock available to JS.
  //   2. Fall back to lockAsync(LANDSCAPE_LEFT) — more specific than the
  //      generic LANDSCAPE which Expo Go sometimes ignores.
  //   3. Re-fire on every Dimensions / orientation change so any rotation
  //      that does sneak through gets snapped back within one frame.
  useEffect(() => {
    const enforce = async () => {
      try {
        // Android: SCREEN_ORIENTATION_LANDSCAPE = 0 (Android system constant)
        // iOS: list of allowed Orientation values
        await ScreenOrientation.lockPlatformAsync({
          screenOrientationConstantAndroid: 0,
          screenOrientationArrayIOS: [
            ScreenOrientation.Orientation.LANDSCAPE_LEFT,
            ScreenOrientation.Orientation.LANDSCAPE_RIGHT,
          ],
        });
      } catch {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_LEFT);
        } catch { /* Expo Go on this device / iOS sim — give up gracefully */ }
      }
    };

    void enforce();

    const orientationSub = ScreenOrientation.addOrientationChangeListener(() => { void enforce(); });
    const dimensionsSub  = Dimensions.addEventListener('change', () => { void enforce(); });

    return () => {
      ScreenOrientation.removeOrientationChangeListener(orientationSub);
      dimensionsSub.remove();
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <PaperProvider theme={paperTheme}>
            <AuthProvider>
              <SyncProvider>
                <BranchProvider>
                  <NavigationContainer>
                    <RootNavigator />
                    <OfflineBanner />
                    <SupervisorPinHost />
                    <BarcodeScannerHost />
                    <TenderingHost />
                  </NavigationContainer>
                </BranchProvider>
              </SyncProvider>
            </AuthProvider>
            <StatusBar style="dark" />
          </PaperProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
