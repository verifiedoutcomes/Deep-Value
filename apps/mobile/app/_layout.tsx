import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { colors } from '../src/theme';
import { hydrateSecureState } from '../src/store';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

export default function RootLayout() {
  React.useEffect(() => {
    void hydrateSecureState();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: 'Menlo' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal', title: 'Settings' }} />
        <Stack.Screen
          name="saved"
          options={{ presentation: 'modal', title: 'Saved Analyses' }}
        />
        <Stack.Screen name="inspiration" options={{ title: 'Inspiration' }} />
        <Stack.Screen
          name="dev-parity"
          options={{ presentation: 'modal', title: 'Data Parity (dev)' }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
