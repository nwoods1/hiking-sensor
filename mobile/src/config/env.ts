// Public configuration, inlined at build time from EXPO_PUBLIC_* variables
// (see .env.example). These values ship inside the app binary: only the
// Supabase publishable/anon key belongs here, never a service-role key or
// Snowflake credentials.
//
// Expo only inlines `process.env.EXPO_PUBLIC_X` written out in full, so
// each variable is read explicitly.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy mobile/.env.example to mobile/.env, fill it in, ` +
        'and restart `npx expo start --clear`.',
    );
  }
  return value.replace(/\/+$/, '');
}

export const env = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseKey: required('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  backendUrl: required('EXPO_PUBLIC_BACKEND_URL', process.env.EXPO_PUBLIC_BACKEND_URL),
  // Shows the "simulated sensor" option outside development builds too.
  enableMockSensor: process.env.EXPO_PUBLIC_ENABLE_MOCK_SENSOR === 'true',
};

export const HIKE_DATA_BUCKET = 'hike-data';
