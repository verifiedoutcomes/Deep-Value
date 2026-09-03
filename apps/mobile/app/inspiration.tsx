/**
 * Inspiration: a simple Apple Notes-style page of investing quotes.
 * Block-quote format (left rule + indented text, "— attribution"),
 * add your own at the bottom, long-press to remove.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { showAlert } from '../src/alert';
import { useAppStore } from '../src/store';
import { colors, space, type } from '../src/theme';
import { Mono } from '../src/components/ui';
import { tapHaptic, warningHaptic } from '../src/haptics';

export default function InspirationScreen() {
  const quotes = useAppStore((s) => s.quotes);
  const addQuote = useAppStore((s) => s.addQuote);
  const removeQuote = useAppStore((s) => s.removeQuote);
  const [draft, setDraft] = useState('');
  const [who, setWho] = useState('');

  const add = () => {
    if (!draft.trim()) return;
    tapHaptic();
    addQuote(draft, who);
    setDraft('');
    setWho('');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={96}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 2 }}
        keyboardShouldPersistTaps="handled"
      >
        {quotes.map((q, i) => (
          <Pressable
            key={`${i}-${q.text.slice(0, 16)}`}
            onLongPress={() => {
              warningHaptic();
              showAlert('Remove quote?', `“${q.text.slice(0, 60)}…”`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => removeQuote(i) },
              ]);
            }}
            delayLongPress={400}
            style={styles.quoteBlock}
          >
            <Text style={styles.quoteText}>“{q.text}”</Text>
            {q.attribution.length > 0 && (
              <Text style={styles.attribution}>— {q.attribution}</Text>
            )}
          </Pressable>
        ))}

        <View style={styles.composer}>
          <TextInput
            style={[styles.input, styles.quoteInput]}
            placeholder="add a quote…"
            placeholderTextColor={colors.textFaint}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="attribution (e.g. Warren Buffett)"
              placeholderTextColor={colors.textFaint}
              value={who}
              onChangeText={setWho}
              onSubmitEditing={add}
              returnKeyType="done"
            />
            <Pressable
              style={[styles.addBtn, !draft.trim() && { opacity: 0.4 }]}
              onPress={add}
              disabled={!draft.trim()}
            >
              <Mono size="md" color={colors.accent} bold>+</Mono>
            </Pressable>
          </View>
          <Mono size="xs" color={colors.textFaint}>
            long-press a quote to remove it
          </Mono>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Apple Notes' "quote" block: a left rule with indented text.
  quoteBlock: {
    borderLeftWidth: 3,
    borderLeftColor: colors.textFaint,
    paddingLeft: space.lg,
    paddingVertical: 2,
    marginBottom: space.xl,
  },
  quoteText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  attribution: {
    color: colors.textDim,
    fontSize: 14,
    marginTop: space.sm,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontStyle: 'italic',
  },
  composer: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.lg,
    gap: space.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  quoteInput: { minHeight: 72, textAlignVertical: 'top' },
  addBtn: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 6,
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: colors.accentDim,
  },
});
