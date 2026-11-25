import { Platform } from 'react-native';

// Soft Steps palette, from frontend/style.css :root.
export const colors = {
  background: '#f5f7f2',
  primary: '#6f9283',
  secondary: '#fac9b8',
  accent: '#8d9f87',
  secondaryAccent: '#f0dcca',
  text: '#3a3c44',
  green: '#dce5da',
  green2: '#e8f0e7',
  surface: '#ffffff',
  eyebrow: '#526957',
  muted: '#66736a',
  timer: '#355b43',
  error: '#9a352c',
  errorBackground: '#fbe9e5',
  warningBackground: '#fdf3e4',
  // Chart colors from frontend/hike-charts.js.
  series: '#2a78d6',
  bad: '#d03b3b',
  grid: '#e6ebe4',
} as const;

export const fonts = {
  // Header font on the web app; Clarity City (body) isn't on Google Fonts,
  // so body text uses the system font.
  header: 'Chango_400Regular',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16 } as const;

// Native tab bar height not covered by safe-area insets (value from the
// Expo SDK 58 template). Tab screens pad their content by this much.
export const TAB_BAR_INSET = Platform.select({ ios: 50, android: 80 }) ?? 0;
