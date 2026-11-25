import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, fonts, radius, spacing, TAB_BAR_INSET } from './theme';

// Scrolling screen with safe-area padding. On iOS the scroll view moves
// focused inputs above the keyboard (automaticallyAdjustKeyboardInsets);
// Android resizes the window for the keyboard by default.
export function Screen({
  children,
  edges = ['top', 'left', 'right'],
  tabs = false,
  refreshControl,
  contentStyle,
}: {
  children: ReactNode;
  edges?: Edge[];
  // Inside the tab navigator: leave room for the tab bar.
  tabs?: boolean;
  refreshControl?: ScrollViewProps['refreshControl'];
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={tabs ? [...edges, 'bottom'] : edges}>
      <ScrollView
        contentContainerStyle={[styles.content, tabs && { paddingBottom: TAB_BAR_INSET + spacing.lg }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={refreshControl}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.title, style]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.heading} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function Body({
  children,
  muted,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.body, muted && styles.muted, style]}>{children}</Text>;
}

export function Card({
  children,
  tone = 'surface',
  style,
}: {
  children: ReactNode;
  tone?: 'surface' | 'green';
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, tone === 'green' && styles.cardGreen, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'text';
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      hitSlop={variant === 'text' ? 8 : undefined}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'text' && styles.buttonText,
        pressed && !inactive && styles.buttonPressed,
        inactive && styles.buttonDisabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={[styles.buttonLabel, variant === 'danger' && styles.buttonLabelDanger]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'warning' }) {
  return (
    <View
      style={[styles.notice, tone === 'error' && styles.noticeError, tone === 'warning' && styles.noticeWarning]}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite">
      <Text style={[styles.body, tone === 'error' && styles.errorText]}>{children}</Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={styles.loading} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.primary} />
      <Body muted>{label}</Body>
    </View>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card tone="green" style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {children}
    </Card>
  );
}

export function Metric({
  label,
  value,
  unit,
  large,
}: {
  label: string;
  value: string;
  unit?: string;
  large?: boolean;
}) {
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, large && styles.metricValueLarge]}>
        {value}
        {unit ? <Text style={styles.metricUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.header, fontSize: 28, color: colors.text },
  heading: { fontFamily: fonts.header, fontSize: 19, color: colors.text, marginBottom: spacing.xs },
  eyebrow: {
    color: colors.eyebrow,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  body: { color: colors.text, fontSize: 16, lineHeight: 23 },
  muted: { color: colors.muted },
  errorText: { color: colors.error },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.green,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: colors.text,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  cardGreen: { backgroundColor: colors.green2, shadowOpacity: 0, elevation: 0 },
  button: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.green },
  buttonDanger: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.error },
  buttonText: { backgroundColor: 'transparent', minHeight: 44, paddingHorizontal: spacing.sm },
  buttonPressed: { backgroundColor: colors.secondary },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: colors.text, fontWeight: '700', fontSize: 16 },
  buttonLabelDanger: { color: colors.error },
  notice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.green2 },
  noticeError: { backgroundColor: colors.errorBackground },
  noticeWarning: { backgroundColor: colors.warningBackground },
  loading: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  empty: { alignItems: 'flex-start' },
  emptyTitle: { fontFamily: fonts.header, fontSize: 17, color: colors.text },
  metric: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.green2,
    borderColor: colors.green,
    borderWidth: 1,
  },
  metricLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricValueLarge: { fontSize: 32, color: colors.timer },
  metricUnit: { fontSize: 14, fontWeight: '600', color: colors.muted },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.green,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailLabel: { color: colors.muted, fontSize: 15, flexShrink: 1 },
  detailValue: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
});
