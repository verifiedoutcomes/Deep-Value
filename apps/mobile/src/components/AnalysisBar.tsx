/**
 * The save/review strip shared by the Company and Valuation tabs.
 *
 *  - Live mode: a compact "save analysis" action that freezes the whole
 *    Company + Valuation state, then offers to jump straight to
 *    researching the next ticker.
 *  - Review mode: an amber banner naming the frozen analysis with
 *    exit/delete actions; the tabs render the original results exactly.
 */
import React from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore, type SavedAnalysis } from '../store';
import { colors, space } from '../theme';
import { Mono } from './ui';
import { successHaptic, tapHaptic, warningHaptic } from '../haptics';

export function AnalysisBar({ reviewing }: { reviewing: SavedAnalysis | null }) {
  const router = useRouter();
  const saveAnalysis = useAppStore((s) => s.saveAnalysis);
  const exitReview = useAppStore((s) => s.exitReview);
  const deleteAnalysis = useAppStore((s) => s.deleteAnalysis);
  const savedCount = useAppStore((s) => s.savedAnalyses.length);

  if (reviewing) {
    const when = reviewing.savedAt.replace('T', ' ').slice(0, 16);
    return (
      <View style={[styles.bar, styles.reviewBar]}>
        <View style={{ flex: 1 }}>
          <Mono size="xs" color={colors.amber} bold>
            SAVED ANALYSIS · {reviewing.ticker} · {when}
          </Mono>
          <Mono size="xs" color={colors.textDim}>
            original results, read-only — edits are disabled
          </Mono>
        </View>
        <Pressable
          onPress={() => {
            warningHaptic();
            Alert.alert('Delete this saved analysis?', `${reviewing.ticker} · ${when}`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => deleteAnalysis(reviewing.id),
              },
            ]);
          }}
          hitSlop={8}
          style={styles.action}
        >
          <Mono size="xs" color={colors.red}>delete</Mono>
        </Pressable>
        <Pressable
          onPress={() => {
            tapHaptic();
            exitReview();
          }}
          hitSlop={8}
          style={styles.action}
        >
          <Mono size="xs" color={colors.accent} bold>exit ✕</Mono>
        </Pressable>
      </View>
    );
  }

  const onSave = () => {
    const result = saveAnalysis();
    if ('error' in result) {
      warningHaptic();
      Alert.alert('Nothing to save', result.error);
      return;
    }
    successHaptic();
    Alert.alert(
      'Analysis saved',
      'Company + Valuation frozen as of now. Revisit it anytime from ⌸ Saved on the Watchlist.',
      [
        { text: 'Stay here', style: 'cancel' },
        {
          text: 'Research next ticker →',
          onPress: () => router.navigate({ pathname: '/', params: { focus: '1' } }),
        },
      ],
    );
  };

  return (
    <View style={styles.bar}>
      <Pressable onPress={onSave} hitSlop={8} style={styles.saveBtn}>
        <Mono size="xs" color={colors.accent} bold>⌸ save analysis</Mono>
      </Pressable>
      <Pressable
        onPress={() => {
          tapHaptic();
          router.navigate('/saved');
        }}
        hitSlop={8}
        style={styles.action}
      >
        <Mono size="xs" color={colors.textDim}>saved ({savedCount})</Mono>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: space.md,
    marginTop: space.sm,
  },
  reviewBar: {
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 6,
    backgroundColor: colors.surfaceAlt,
    padding: space.sm,
    gap: space.sm,
  },
  saveBtn: {
    borderWidth: 1,
    borderColor: colors.accentDim,
    backgroundColor: colors.accentDim,
    borderRadius: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
  },
  action: { paddingHorizontal: 4, paddingVertical: 5 },
});
