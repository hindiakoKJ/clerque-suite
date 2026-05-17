import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Provider as PaperProvider } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useFonts as useInter,   Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts as useJakarta, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts as useMono,    JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';

import { paperTheme } from '@/theme';
import RootNavigator from '@/shell/RootNavigator';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import SupervisorPinHost from '@/auth/SupervisorPinHost';
import BarcodeScannerHost from '@/components/BarcodeScannerSheet';
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

  // Lock to landscape — app.json's `orientation: 'landscape'` only takes
  // effect in dev / production builds, NOT in Expo Go. Calling the
  // runtime API here keeps the tablet locked even while iterating in
  // Expo Go. Phone-portrait owner-spotcheck mode would override per
  // screen if/when we add it.
  useEffect(() => {
    ScreenOrientation
      .lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      .catch(() => {/* iOS simulator without orientation support — ignore */});
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
