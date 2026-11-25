import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { askAssistant } from '@/api/chat';
import { Body, Eyebrow, Title } from '@/ui/components';
import { colors, radius, spacing, TAB_BAR_INSET } from '@/ui/theme';

type Message = { id: number; sender: 'user' | 'assistant'; text: string; error?: boolean };

// Suggested questions from frontend/chat.html.
const SUGGESTIONS = [
  { label: 'Highest impact', question: 'Which hike had the highest maximum impact?' },
  { label: 'Lowest knee angle', question: 'Which hike had the lowest average knee angle at impact?' },
  { label: 'Compare fatigue', question: 'Compare the fatigue ratio across all hikes.' },
  { label: 'Most demanding hike', question: 'Which hike looks the most physically demanding based on the data?' },
];

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setVisible(true),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, sender: 'assistant', text: 'Hi! Ask me a question about your hiking data.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const list = useRef<FlatList<Message>>(null);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setInput('');
    setBusy(true);
    setMessages((m) => [...m, { id: nextId.current++, sender: 'user', text: trimmed }]);
    try {
      const answer = await askAssistant(trimmed);
      setMessages((m) => [...m, { id: nextId.current++, sender: 'assistant', text: answer }]);
    } catch (error) {
      setMessages((m) => [
        ...m,
        {
          id: nextId.current++,
          sender: 'assistant',
          text: error instanceof Error ? error.message : 'Something went wrong.',
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Eyebrow>AI assistant</Eyebrow>
          <Title>Soft Steps Assistant</Title>
          <Body muted>Ask about your recorded hikes: knee angles, impacts, cadence, fatigue and more.</Body>
        </View>

        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.sender === 'user' ? styles.user : styles.assistant,
                item.error && styles.errorBubble,
              ]}
              accessible
              accessibilityLabel={`${item.sender === 'user' ? 'You' : 'Assistant'}: ${item.text}`}>
              <Text style={styles.sender}>{item.sender === 'user' ? 'You' : 'Soft Steps Assistant'}</Text>
              <Text style={styles.text} selectable>
                {item.text}
              </Text>
            </View>
          )}
          ListFooterComponent={
            busy ? (
              <View style={styles.thinking} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colors.primary} />
                <Body muted>Analyzing hiking data…</Body>
              </View>
            ) : undefined
          }
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestions}
          keyboardShouldPersistTaps="handled">
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s.label}
              onPress={() => void ask(s.question)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Ask: ${s.question}`}
              style={({ pressed }) => [styles.chip, pressed && styles.chipPressed, busy && styles.disabled]}>
              <Text style={styles.chipText}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Above the tab bar; the keyboard covers the tab bar when open. */}
        <View style={[styles.composer, { marginBottom: keyboardVisible ? 0 : insets.bottom + TAB_BAR_INSET }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask about your hiking data…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
            editable={!busy}
            accessibilityLabel="Question"
          />
          <Pressable
            onPress={() => void ask(input)}
            disabled={busy || !input.trim()}
            accessibilityRole="button"
            accessibilityLabel="Ask"
            style={({ pressed }) => [
              styles.send,
              pressed && styles.chipPressed,
              (busy || !input.trim()) && styles.disabled,
            ]}>
            <Text style={styles.sendText}>Ask</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs },
  messages: { padding: spacing.lg, gap: spacing.md },
  bubble: { maxWidth: '85%', padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  user: { alignSelf: 'flex-end', backgroundColor: colors.secondaryAccent, borderColor: colors.secondary },
  assistant: { alignSelf: 'flex-start', backgroundColor: colors.green2, borderColor: colors.green },
  errorBubble: { backgroundColor: colors.errorBackground, borderColor: colors.errorBackground },
  sender: { fontSize: 12, fontWeight: '700', color: colors.eyebrow, marginBottom: 2 },
  text: { fontSize: 16, lineHeight: 23, color: colors.text },
  thinking: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.sm },
  suggestions: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: colors.surface,
  },
  chipPressed: { backgroundColor: colors.secondary },
  chipText: { color: colors.text, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  composer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.green,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  send: {
    minWidth: 64,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontWeight: '700', color: colors.text, fontSize: 16 },
});
