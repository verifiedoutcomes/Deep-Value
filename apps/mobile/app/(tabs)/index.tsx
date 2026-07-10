/**
 * Watchlist: searchable ticker list with price, P/E, EV/EBIT, FCF yield
 * and a verdict chip where a base forecast exists.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { analyzeCompany } from '@dvh/engine';
import { activeSnapshot, useAppStore } from '../../src/store';
import { useTickerSearch } from '../../src/data';
import { colors, space, type } from '../../src/theme';
import { Chip, Mono } from '../../src/components/ui';
import { pct, price, ratio } from '../../src/format';

function WatchRow({ ticker }: { ticker: string }) {
  const router = useRouter();
  const state = useAppStore((s) => s.tickers[ticker]);
  const capexTreatment = useAppStore((s) => s.capexTreatment);
  const selectTicker = useAppStore((s) => s.selectTicker);
  const snapshot = activeSnapshot(state);
  const analysis = useMemo(
    () => (snapshot ? analyzeCompany(snapshot, state?.overrides ?? {}, capexTreatment) : null),
    [snapshot, state?.overrides, capexTreatment],
  );

  const base5 = analysis?.scenarios.base[5];
  const hasForecast = base5?.status === 'ok' && base5.fairValuePerShare != null;
  const upside =
    hasForecast && snapshot ? base5!.fairValuePerShare! / snapshot.quote.price - 1 : null;

  return (
    <Pressable
      style={styles.row}
      onPress={() => {
        selectTicker(ticker);
        router.navigate('/company');
      }}
    >
      <View style={{ flex: 1.2 }}>
        <Mono bold>{ticker}</Mono>
        <Mono size="xs" color={colors.textFaint}>
          {snapshot?.name ?? 'no data'}
        </Mono>
      </View>
      <View style={styles.cell}>
        <Mono size="sm">{price(snapshot?.quote.price ?? null)}</Mono>
        <Mono size="xs" color={colors.textFaint}>px</Mono>
      </View>
      <View style={styles.cell}>
        <Mono size="sm">{ratio(analysis?.header.peLiveCap ?? null)}</Mono>
        <Mono size="xs" color={colors.textFaint}>p/e</Mono>
      </View>
      <View style={styles.cell}>
        <Mono size="sm">{ratio(analysis?.header.evOverOperatingIncome ?? null)}</Mono>
        <Mono size="xs" color={colors.textFaint}>ev/ebit</Mono>
      </View>
      <View style={styles.cell}>
        <Mono size="sm">{pct(analysis?.header.adjFcfYield ?? null)}</Mono>
        <Mono size="xs" color={colors.textFaint}>fcf yld</Mono>
      </View>
      <View style={[styles.cell, { alignItems: 'flex-end' }]}>
        {hasForecast ? (
          <Chip
            label={`${upside! >= 0 ? '+' : ''}${(upside! * 100).toFixed(0)}%`}
            tone={upside! >= 0 ? 'good' : 'bad'}
            active
          />
        ) : (
          <Mono size="xs" color={colors.textFaint}>–</Mono>
        )}
      </View>
    </Pressable>
  );
}

export default function WatchlistScreen() {
  const [query, setQuery] = useState('');
  const watchlist = useAppStore((s) => s.watchlist);
  const addToWatchlist = useAppStore((s) => s.addToWatchlist);
  const search = useTickerSearch(query);

  const addManual = () => {
    const t = query.trim().toUpperCase();
    if (/^[A-Z.\-]{1,10}$/.test(t)) {
      addToWatchlist(t);
      setQuery('');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="search ticker…"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={addManual}
          returnKeyType="done"
        />
        <Link href="/settings" asChild>
          <Pressable style={styles.gear}>
            <Mono size="lg" color={colors.textDim}>⚙</Mono>
          </Pressable>
        </Link>
      </View>
      {query.length > 0 && (
        <View style={styles.results}>
          {(search.data ?? []).slice(0, 6).map((r) => (
            <Pressable
              key={r.ticker}
              style={styles.resultRow}
              onPress={() => {
                addToWatchlist(r.ticker);
                setQuery('');
              }}
            >
              <Mono size="sm">{r.ticker}</Mono>
              <Mono size="xs" color={colors.textFaint}>{r.exchange}</Mono>
            </Pressable>
          ))}
          <Pressable style={styles.resultRow} onPress={addManual}>
            <Mono size="sm" color={colors.accent}>
              add "{query.trim().toUpperCase()}" directly
            </Mono>
          </Pressable>
        </View>
      )}
      <FlatList
        data={watchlist}
        keyExtractor={(t) => t}
        renderItem={({ item }) => <WatchRow ticker={item} />}
        contentContainerStyle={{ paddingBottom: space.xl }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    gap: space.sm,
  },
  search: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    color: colors.text,
    fontFamily: type.mono,
    fontSize: type.size.md,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  gear: { padding: 6 },
  results: {
    marginHorizontal: space.md,
    marginTop: space.xs,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  cell: { flex: 0.8, alignItems: 'flex-start' },
});
