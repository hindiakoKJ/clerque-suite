import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Provider as PaperProvider } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Font from 'expo-font';

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
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    Font.loadAsync({
      'Inter': require('./assets/fonts/Inter-Regular.ttf'),
      'PlusJakartaSans': require('./assets/fonts/PlusJakartaSans-Bold.ttf'),
      'JetBrainsMono': require('./assets/fonts/JetBrainsMono-Medium.ttf'),
    })
      .catch(() => {/* allow boot without custom fonts in dev */})
      .finally(() => setFontsLoaded(true));
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
