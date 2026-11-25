import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import { useRecorder } from '@/hooks/services';
import { recorder } from '@/recording';
import { Body, Button, Card, Eyebrow, Notice, Screen, Title } from '@/ui/components';
import { formatDateTime } from '@/ui/format';
import { colors, radius, spacing } from '@/ui/theme';

export default function NewHikeScreen() {
  const rec = useRecorder();
  const [name, setName] = useState('');
  const [createdAt] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  function next() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give your hike a name.');
      return;
    }
    recorder.prepareResume(null);
    router.replace({ pathname: '/record', params: { name: trimmed } });
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Eyebrow>New hike</Eyebrow>
      <Title>Plan your hike</Title>
      {rec.session ? (
        <Notice tone="warning">A hike is already being recorded. Finish it before starting another.</Notice>
      ) : (
        <Card>
          <Text style={styles.label} nativeID="hike-name-label">
            Hike name
          </Text>
          <TextInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            placeholder="e.g. Pine Ridge Loop"
            placeholderTextColor={colors.muted}
            maxLength={100}
            autoFocus
            returnKeyType="next"
            onSubmitEditing={next}
            style={styles.input}
            accessibilityLabel="Hike name"
            accessibilityLabelledBy="hike-name-label"
          />
          <Text style={styles.label}>Created</Text>
          <Body muted>{formatDateTime(createdAt)}</Body>
          {error && <Notice tone="error">{error}</Notice>}
          <Button label="Continue to sensor connection" onPress={next} />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
