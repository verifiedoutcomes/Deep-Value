/**
 * Checklist: seeded with the sheet's fourteen questions (C111:C124), each
 * a Yes/No toggle persisted per ticker — but fully yours: add as many
 * items as you like, remove any baseline question, or restore the
 * baseline set.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { showAlert } from '../../src/alert';
import { useAppStore } from '../../src/store';
import { colors, space, type } from '../../src/theme';
import { Banner, Mono } from '../../src/components/ui';
import { tapHaptic, toggleHaptic, warningHaptic } from '../../src/haptics';

export default function ChecklistScreen() {
  const ticker = useAppStore((s) => s.selectedTicker);
  const items = useAppStore((s) => s.tickers[ticker]?.checklist) ?? [];
  const setChecklist = useAppStore((s) => s.setChecklist);
  const addChecklistItem = useAppStore((s) => s.addChecklistItem);
  const removeChecklistItem = useAppStore((s) => s.removeChecklistItem);
  const restoreChecklistBaseline = useAppStore((s) => s.restoreChecklistBaseline);
  const [draft, setDraft] = useState('');

  const yesCount = items.filter((it) => it.answer).length;

  const add = () => {
    if (!draft.trim()) return;
    tapHaptic();
    addChecklistItem(ticker, draft);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={96}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Banner>
          {ticker} · {yesCount}/{items.length} yes — questions to check yourself
        </Banner>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: items.length ? `${(yesCount / items.length) * 100}%` : '0%' },
            ]}
          />
        </View>
        {items.map((item, i) => (
          <Pressable
            key={`${i}-${item.question}`}
            style={styles.row}
            onPress={() => {
              toggleHaptic();
              setChecklist(ticker, i, !item.answer);
            }}
            onLongPress={() => {
              warningHaptic();
              showAlert('Remove question?', item.question, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => removeChecklistItem(ticker, i),
                },
              ]);
            }}
            delayLongPress={400}
            accessibilityRole="switch"
            accessibilityState={{ checked: item.answer }}
            accessibilityLabel={item.question}
          >
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Mono size="sm" color={colors.text}>{item.question}</Mono>
            </View>
            <View style={[styles.toggle, item.answer ? styles.yes : styles.no]}>
              <Mono size="xs" bold color={item.answer ? colors.accent : colors.textFaint}>
                {item.answer ? 'YES' : 'NO'}
              </Mono>
            </View>
          </Pressable>
        ))}

        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder="add your own question…"
            placeholderTextColor={colors.textFaint}
            value={draft}
            onChangeText={setDraft}
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

        <View style={styles.footer}>
          <Mono size="xs" color={colors.textFaint}>
            long-press a question to remove it
          </Mono>
          <Pressable
            onPress={() =>
              showAlert(
                'Restore baseline?',
                'Replaces this list with the original 14 questions. Answers reset to No.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Restore', onPress: () => restoreChecklistBaseline(ticker) },
                ],
              )
            }
            hitSlop={8}
          >
            <Mono size="xs" color={colors.blue}>↺ restore baseline 14</Mono>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  progressTrack: {
    height: 4,
    backgroundColor: colors.chipBg,
    borderRadius: 2,
    marginHorizontal: space.md,
    marginTop: space.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggle: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 48,
    alignItems: 'center',
  },
  yes: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  no: { borderColor: colors.border, backgroundColor: colors.chipBg },
  addRow: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    alignItems: 'center',
  },
  addInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    color: colors.text,
    fontFamily: type.mono,
    fontSize: type.size.sm,
    paddingHorizontal: space.md,
    paddingVertical: 9,
  },
  addBtn: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.accentDim,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
});
