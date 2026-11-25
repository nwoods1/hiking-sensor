import { useRef, useState, type ComponentRef } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Body, Button, Card, Notice, Screen, Title } from '@/ui/components';
import { colors, radius, spacing } from '@/ui/theme';

type Mode = 'signin' | 'signup';

export default function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  async function submit() {
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setMessage({ text: 'Enter your email and password.', error: true });
      return;
    }
    setBusy(true);
    setMessage({ text: mode === 'signup' ? 'Creating your account…' : 'Signing in…', error: false });
    try {
      if (mode === 'signup') {
        const { needsConfirmation } = await signUp(trimmed, password);
        if (needsConfirmation) {
          setMessage({
            text: 'Check your email to confirm your account, then sign in here.',
            error: false,
          });
          setMode('signin');
          return;
        }
      } else {
        await signIn(trimmed, password);
      }
      // The root layout switches to the app when the session changes.
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Authentication failed.', error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} contentStyle={styles.content}>
      <View style={styles.brand}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.logo}
          accessibilityIgnoresInvertColors
          accessible
          accessibilityLabel="Soft Steps logo"
        />
        <Title>Soft Steps</Title>
        <Body muted style={styles.center}>
          Record your knee angle and the impact of every step while you hike.
        </Body>
      </View>

      <Card>
        <View style={styles.tabs} accessibilityRole="tablist">
          {(['signin', 'signup'] as const).map((m) => (
            <Text
              key={m}
              onPress={() => {
                setMode(m);
                setMessage(null);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
              style={[styles.tab, mode === m && styles.tabActive]}>
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </Text>
          ))}
        </View>

        <Text style={styles.label} nativeID="email-label">
          Email
        </Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          style={styles.input}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          accessibilityLabelledBy="email-label"
          accessibilityLabel="Email"
          editable={!busy}
        />
        <Text style={styles.label} nativeID="password-label">
          Password
        </Text>
        <TextInput
          ref={passwordRef}
          value={password}
          onChangeText={setPassword}
          style={styles.input}
          secureTextEntry
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          textContentType={mode === 'signup' ? 'newPassword' : 'password'}
          returnKeyType="go"
          onSubmitEditing={submit}
          accessibilityLabelledBy="password-label"
          accessibilityLabel="Password"
          editable={!busy}
        />

        {message && <Notice tone={message.error ? 'error' : 'info'}>{message.text}</Notice>}

        <Button label={mode === 'signup' ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', flexGrow: 1 },
  brand: { alignItems: 'center', gap: spacing.sm },
  logo: { width: 110, height: 102 },
  center: { textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  tab: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    color: colors.muted,
    fontWeight: '600',
    overflow: 'hidden',
  },
  tabActive: { backgroundColor: colors.green2, color: colors.text },
  label: { color: colors.text, fontWeight: '600', marginTop: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
});
