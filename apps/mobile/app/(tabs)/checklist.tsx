/**
 * Checklist: the fourteen qualitative questions (sheet C111:C124), each a
 * Yes/No toggle persisted per ticker, defaulting to No.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CHECKLIST_QUESTIONS } from '@dvh/engine';
import { useAppStore } from '../../src/store';
import { colors, space } from '../../src/theme';
import { Banner, Mono } from '../../src/components/ui';
import { toggleHaptic } from '../../src/haptics';

export default function ChecklistScreen() {
  const ticker = useAppStore((s) => s.selectedTicker);
  const answers = useAppStore((s) => s.tickers[ticker]?.checklist) ?? Array(14).fill(false);
  const setChecklist = useAppStore((s) => s.setChecklist);
  const yesCount = answers.filter(Boolean).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: space.xl }}>
      <Banner>
        {ticker} · {yesCount}/{CHECKLIST_QUESTIONS.length} yes — questions to check yourself
      </Banner>
      <View style={styles.progressTrack}>
        <View
          style={[styles.progressFill, { width: `${(yesCount / CHECKLIST_QUESTIONS.length) * 100}%` }]}
        />
      </View>
      {CHECKLIST_QUESTIONS.map((q, i) => {
        const yes = answers[i] ?? false;
        return (
          <Pressable
            key={i}
            style={styles.row}
            onPress={() => {
              toggleHaptic();
              setChecklist(ticker, i, !yes);
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: yes }}
            accessibilityLabel={q}
          >
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Mono size="sm" color={colors.text}>{q}</Mono>
            </View>
            <View style={[styles.toggle, yes ? styles.yes : styles.no]}>
              <Mono size="xs" bold color={yes ? colors.accent : colors.textFaint}>
                {yes ? 'YES' : 'NO'}
              </Mono>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
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
});
