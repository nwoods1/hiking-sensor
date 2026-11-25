import { Chango_400Regular, useFonts } from '@expo-google-fonts/chango';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { syncService } from '@/sync/syncService';
import { colors, fonts } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const { session, initializing } = useAuth();
  const [fontsLoaded, fontError] = useFonts({ Chango_400Regular });
  const ready = !initializing && (fontsLoaded || !!fontError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Upload pending hikes whenever there's a signed-in user.
  useEffect(() => {
    if (!session) return;
    return syncService.start();
  }, [session]);

  if (!ready) return null;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.header },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="new-hike" options={{ title: 'New hike' }} />
        <Stack.Screen name="record" options={{ title: 'Record hike' }} />
        <Stack.Screen name="hike/[id]" options={{ title: 'Hike' }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootStack />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
