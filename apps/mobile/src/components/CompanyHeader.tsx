/**
 * The selected company, always visible in the header of the per-company
 * tabs (Company, Valuation, Checklist), with a Change button back to the
 * watchlist search. In review mode it names the saved analysis instead.
 */
import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { activeSnapshot, useAppStore } from '../store';
import { colors, space } from '../theme';
import { price } from '../format';
import { tapHaptic } from '../haptics';
import { Mono } from './ui';

function useSelectedCompany() {
  const selected = useAppStore((s) => s.selectedTicker);
  const reviewing = useAppStore((s) =>
    s.reviewingId ? s.savedAnalyses.find((a) => a.id === s.reviewingId) ?? null : null,
  );
  const ticker = reviewing?.ticker ?? selected;
  const state = useAppStore((s) => s.tickers[ticker]);
  const snapshot = reviewing ? reviewing.snapshot : activeSnapshot(state);
  return { ticker, snapshot, reviewing };
}

export function CompanyHeaderTitle({ screen }: { screen: string }) {
  const { width } = useWindowDimensions();
  const { ticker, snapshot, reviewing } = useSelectedCompany();
  return (
    <View style={{ maxWidth: width - 120 }} accessibilityRole="header">
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Mono size="lg" bold color={colors.accent}>
          {ticker}
        </Mono>
        <View style={{ flexShrink: 1 }}>
          <Mono size="sm" color={colors.text} lines={1}>
            {snapshot?.name ?? 'No data yet'}
          </Mono>
        </View>
      </View>
      <Mono size="xs" color={colors.textFaint} lines={1}>
        {screen}
        {snapshot ? ` · ${price(snapshot.quote.price)} on ${snapshot.snapshotDate}` : ''}
        {reviewing ? ' · saved analysis' : ''}
      </Mono>
    </View>
  );
}

export function ChangeCompanyButton() {
  const router = useRouter();
  const reviewing = useAppStore((s) => s.reviewingId != null);
  if (reviewing) return null; // the review banner has its own exit
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        router.navigate({ pathname: '/', params: { focus: '1' } });
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Change company"
      style={{
        marginRight: space.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.chipBg,
        borderRadius: 4,
        paddingHorizontal: space.sm,
        paddingVertical: 5,
      }}
    >
      <Mono size="xs" color={colors.blue} bold>
        Change
      </Mono>
    </Pressable>
  );
}
