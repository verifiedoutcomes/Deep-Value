/**
 * Saved analyses: every frozen Company + Valuation state, newest first.
 * Tap to revisit the original results exactly; long-press to delete.
 */
import React from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '../src/store';
import { colors, deltaColor, space } from '../src/theme';
import { Mono } from '../src/components/ui';
import { pct, pctSigned, price, ratio } from '../src/format';
import { tapHaptic, warningHaptic } from '../src/haptics';

export default function SavedScreen() {
  const router = useRouter();
  const saved = useAppStore((s) => s.savedAnalyses);
  const startReview = useAppStore((s) => s.startReview);
  const deleteAnalysis = useAppStore((s) => s.deleteAnalysis);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={saved}
      keyExtractor={(a) => a.id}
      contentContainerStyle={{ paddingBottom: space.xl }}
      renderItem={({ item }) => {
        const d = item.digest;
        return (
          <Pressable
            style={styles.row}
            onPress={() => {
              tapHaptic();
              startReview(item.id);
              router.dismiss();
              router.navigate('/company');
            }}
            onLongPress={() => {
              warningHaptic();
              Alert.alert('Delete saved analysis?', `${item.ticker} · ${item.savedAt.slice(0, 16)}`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteAnalysis(item.id) },
              ]);
            }}
            delayLongPress={400}
          >
            <View style={{ flex: 1.4 }}>
              <Mono bold>{item.ticker}</Mono>
              <Mono size="xs" color={colors.textFaint}>
                {item.savedAt.replace('T', ' ').slice(0, 16)}
              </Mono>
            </View>
            <View style={styles.cell}>
              <Mono size="sm">{price(d.price)}</Mono>
              <Mono size="xs" color={colors.textFaint}>px then</Mono>
            </View>
            <View style={styles.cell}>
              <Mono size="sm">{ratio(d.evEbit)}</Mono>
              <Mono size="xs" color={colors.textFaint}>ev/ebit</Mono>
            </View>
            <View style={styles.cell}>
              <Mono size="sm" color={colors.accent}>
                {d.fairValue5 == null ? '–' : price(d.fairValue5)}
              </Mono>
              <Mono size="xs" color={colors.textFaint}>fair val</Mono>
            </View>
            <View style={[styles.cell, { alignItems: 'flex-end' }]}>
              <Mono size="sm" color={deltaColor(d.priceDelta5)}>
                {d.priceDelta5 == null ? '–' : pctSigned(d.priceDelta5, 0)}
              </Mono>
              <Mono size="xs" color={colors.textFaint}>
                {d.irr5 == null ? '' : `irr ${pct(d.irr5, 0)}`}
              </Mono>
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Mono size="sm" color={colors.textDim}>No saved analyses yet.</Mono>
          <Mono size="xs" color={colors.textFaint}>
            Open a company and tap "⌸ save analysis" on the Company or Valuation tab. The full
            state of both tabs is frozen, so you can revisit the original results any time —
            even after prices and data move on.
          </Mono>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  cell: { flex: 0.9, alignItems: 'flex-start' },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 64,
    paddingHorizontal: space.xl,
  },
});
