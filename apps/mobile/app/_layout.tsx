import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { colors, type } from '../src/theme';
import { hydrateSecureState } from '../src/store';
import { DialogHost } from '../src/components/DialogHost';
import { installWebStyles } from '../src/webStyles';

installWebStyles();

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
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: type.mono },
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
      <DialogHost />
    </QueryClientProvider>
  );
}
