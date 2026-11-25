// Supabase client set up per Expo's current guide
// (docs.expo.dev/guides/using-supabase): sessions persist in the
// expo-sqlite localStorage polyfill, and token auto-refresh only runs while
// the app is in the foreground.
import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { env } from '@/config/env';

export const supabase = createClient(env.supabaseUrl, env.supabaseKey, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

// Current session's user id, refreshing an expired access token if needed.
export async function currentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user.id ?? null;
}

export async function accessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('You are signed out. Sign in and try again.');
  return data.session.access_token;
}
