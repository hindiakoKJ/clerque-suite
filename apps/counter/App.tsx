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
import { ShiftProvider } from '@/shift/ShiftProvider';
import { navigationRef } from '@/shell/navigationRef';

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

  // Boot-time orientation: pick LANDSCAPE on tablet-class devices,
  // PORTRAIT on phone-class. We CAN'T use useDeviceSize() here directly
  // because it's a hook designed for the shells; we replicate its
  // breakpoint (600dp shorter edge = tablet) locally to keep this side
  // effect-free of context.
  //
  // The shells (PhoneTabNavigator + AppDrawer) re-assert their own
  // lock on mount, so this boot lock is just to avoid the cosmetic
  // flash of the wrong orientation during the auth flow.
  //
  // Caveat — Expo Go's HOST Android activity declares orientation as
  // "unspecified" so even after lockAsync the OS may let the wrapper
  // re-rotate. The native lock only takes effect in a development /
  // production build.
  useEffect(() => {
    const { width: w, height: h } = require('react-native').Dimensions.get('window');
    const isTablet = Math.min(w, h) >= 600;

    const enforce = async () => {
      try {
        if (isTablet) {
          await ScreenOrientation.lockPlatformAsync({
            screenOrientationConstantAndroid: 0, // SCREEN_ORIENTATION_LANDSCAPE
            screenOrientationArrayIOS: [
              ScreenOrientation.Orientation.LANDSCAPE_LEFT,
              ScreenOrientation.Orientation.LANDSCAPE_RIGHT,
            ],
          });
        } else {
          await ScreenOrientation.lockPlatformAsync({
            screenOrientationConstantAndroid: 1, // SCREEN_ORIENTATION_PORTRAIT
            screenOrientationArrayIOS: [
              ScreenOrientation.Orientation.PORTRAIT_UP,
            ],
          });
        }
      } catch {
        try {
          await ScreenOrientation.lockAsync(
            isTablet
              ? ScreenOrientation.OrientationLock.LANDSCAPE_LEFT
              : ScreenOrientation.OrientationLock.PORTRAIT_UP,
          );
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
                  <ShiftProvider>
                    <NavigationContainer ref={navigationRef}>
                      <RootNavigator />
                      <OfflineBanner />
                      <SupervisorPinHost />
                      <BarcodeScannerHost />
                      <TenderingHost />
                    </NavigationContainer>
                  </ShiftProvider>
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
