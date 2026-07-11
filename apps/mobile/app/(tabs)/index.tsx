/**
 * Watchlist: subcategories (max 50 names each), searchable/filterable,
 * virtualized for thousands of names across groups. Rows show price,
 * P/E, EV/EBIT, FCF yield and a verdict chip where a base forecast
 * exists. Long-press a row to move or remove it; long-press a group
 * chip to delete the group.
 */
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { analyzeCompany } from '@dvh/engine';
import { activeSnapshot, MAX_GROUP_SIZE, useAppStore } from '../../src/store';
import { useTickerSearch } from '../../src/data';
import { colors, space, type } from '../../src/theme';
import { Chip, Mono } from '../../src/components/ui';
import { pct, price, ratio } from '../../src/format';
import { tapHaptic, warningHaptic } from '../../src/haptics';

const ROW_HEIGHT = 56;

function WatchRow({ ticker }: { ticker: string }) {
  const router = useRouter();
  const state = useAppStore((s) => s.tickers[ticker]);
  const capexTreatment = useAppStore((s) => s.capexTreatment);
  const selectTicker = useAppStore((s) => s.selectTicker);
  const removeFromWatchlist = useAppStore((s) => s.removeFromWatchlist);
  const moveToGroup = useAppStore((s) => s.moveToGroup);
  const groups = useAppStore((s) => s.watchlistGroups);
  const snapshot = activeSnapshot(state);
  const analysis = useMemo(
    () => (snapshot ? analyzeCompany(snapshot, state?.overrides ?? {}, capexTreatment) : null),
    [snapshot, state?.overrides, capexTreatment],
  );

  const base5 = analysis?.scenarios.base[5];
  const hasForecast = base5?.status === 'ok' && base5.fairValuePerShare != null;
  const upside =
    hasForecast && snapshot ? base5!.fairValuePerShare! / snapshot.quote.price - 1 : null;

  const showActions = () => {
    warningHaptic();
    const moveButtons = groups
      .filter((g) => !g.tickers.includes(ticker))
      .slice(0, 5)
      .map((g) => ({
        text: `Move to ${g.name}`,
        onPress: () => {
          const err = moveToGroup(ticker, g.name);
          if (err) Alert.alert('Cannot move', err);
        },
      }));
    Alert.alert(ticker, 'Snapshots and scenario edits are kept either way.', [
      { text: 'Cancel', style: 'cancel' },
      ...moveButtons,
      {
        text: 'Remove from watchlist',
        style: 'destructive',
        onPress: () => removeFromWatchlist(ticker),
      },
    ]);
  };

  return (
    <Pressable
      style={styles.row}
      onPress={() => {
        tapHaptic();
        selectTicker(ticker);
        router.navigate('/company');
      }}
      onLongPress={showActions}
      delayLongPress={400}
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
  const [sort, setSort] = useState<'added' | 'az'>('added');
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState('');
  const groups = useAppStore((s) => s.watchlistGroups);
  const activeGroupName = useAppStore((s) => s.activeGroup);
  const setActiveGroup = useAppStore((s) => s.setActiveGroup);
  const addGroup = useAppStore((s) => s.addGroup);
  const removeGroup = useAppStore((s) => s.removeGroup);
  const addToWatchlist = useAppStore((s) => s.addToWatchlist);
  const search = useTickerSearch(query);

  const activeGroup = groups.find((g) => g.name === activeGroupName) ?? groups[0];
  const tickers = activeGroup?.tickers ?? [];
  const allTickers = useMemo(() => new Set(groups.flatMap((g) => g.tickers)), [groups]);

  const tryAdd = (t: string) => {
    const err = addToWatchlist(t);
    if (err) {
      warningHaptic();
      Alert.alert('Cannot add', err);
    } else {
      tapHaptic();
      setQuery('');
    }
  };

  const addManual = () => {
    const t = query.trim().toUpperCase();
    if (/^[A-Z.\-]{1,10}$/.test(t)) tryAdd(t);
  };

  const commitGroup = () => {
    const err = addGroup(groupDraft);
    if (err) {
      warningHaptic();
      Alert.alert('Cannot create group', err);
    } else {
      tapHaptic();
      setGroupDraft('');
      setAddingGroup(false);
    }
  };

  const q = query.trim().toUpperCase();
  const visible = useMemo(() => {
    const filtered = q ? tickers.filter((t) => t.includes(q)) : [...tickers];
    if (sort === 'az') filtered.sort();
    return filtered;
  }, [tickers, q, sort]);
  const newResults = (search.data ?? []).filter((r) => !allTickers.has(r.ticker)).slice(0, 5);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="search or filter tickers…"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={addManual}
          returnKeyType="done"
        />
        <Pressable
          style={styles.gear}
          onPress={() => {
            tapHaptic();
            setSort((s) => (s === 'added' ? 'az' : 'added'));
          }}
          accessibilityLabel={`sort ${sort === 'added' ? 'alphabetically' : 'by date added'}`}
        >
          <Mono size="sm" color={sort === 'az' ? colors.accent : colors.textDim}>A–Z</Mono>
        </Pressable>
        <Link href="/settings" asChild>
          <Pressable style={styles.gear}>
            <Mono size="lg" color={colors.textDim}>⚙</Mono>
          </Pressable>
        </Link>
      </View>

      {/* subcategory chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.groupChips}
        keyboardShouldPersistTaps="handled"
      >
        {groups.map((g) => (
          <Pressable
            key={g.name}
            onPress={() => {
              tapHaptic();
              setActiveGroup(g.name);
            }}
            onLongPress={() => {
              if (groups.length <= 1) return;
              warningHaptic();
              Alert.alert(
                `Delete "${g.name}"?`,
                g.tickers.length
                  ? `${g.tickers.length} tickers will leave the watchlist (their data is kept).`
                  : 'The group is empty.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => removeGroup(g.name) },
                ],
              );
            }}
            delayLongPress={500}
            style={[styles.groupChip, g.name === activeGroupName && styles.groupChipOn]}
          >
            <Mono size="xs" color={g.name === activeGroupName ? colors.accent : colors.textDim} bold={g.name === activeGroupName}>
              {g.name}
            </Mono>
            <Mono size="xs" color={g.tickers.length >= MAX_GROUP_SIZE ? colors.amber : colors.textFaint}>
              {' '}{g.tickers.length}/{MAX_GROUP_SIZE}
            </Mono>
          </Pressable>
        ))}
        {addingGroup ? (
          <TextInput
            style={styles.groupInput}
            placeholder="group name"
            placeholderTextColor={colors.textFaint}
            value={groupDraft}
            onChangeText={setGroupDraft}
            onSubmitEditing={commitGroup}
            onBlur={() => setAddingGroup(false)}
            autoFocus
            returnKeyType="done"
          />
        ) : (
          <Pressable style={styles.groupChip} onPress={() => setAddingGroup(true)}>
            <Mono size="xs" color={colors.blue}>+ new group</Mono>
          </Pressable>
        )}
      </ScrollView>

      {q.length > 0 && (
        <View style={styles.results}>
          {newResults.map((r) => (
            <Pressable key={r.ticker} style={styles.resultRow} onPress={() => tryAdd(r.ticker)}>
              <Mono size="sm">+ {r.ticker}</Mono>
              <Mono size="xs" color={colors.textFaint}>{r.exchange}</Mono>
            </Pressable>
          ))}
          {!allTickers.has(q) && /^[A-Z.\-]{1,10}$/.test(q) && (
            <Pressable style={styles.resultRow} onPress={addManual}>
              <Mono size="sm" color={colors.accent}>
                add "{q}" to {activeGroup?.name}
              </Mono>
            </Pressable>
          )}
        </View>
      )}
      <FlatList
        data={visible}
        keyExtractor={(t) => t}
        renderItem={({ item }) => <WatchRow ticker={item} />}
        contentContainerStyle={{ paddingBottom: space.xl }}
        getItemLayout={(_d, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        initialNumToRender={14}
        windowSize={7}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <Mono size="sm" color={colors.textDim}>
              {q
                ? `Nothing in ${activeGroup?.name} matches "${q}".`
                : `${activeGroup?.name} is empty.`}
            </Mono>
            <Mono size="xs" color={colors.textFaint}>
              Search above, or type a ticker and hit return. Long-press a row to move or remove
              it; long-press a group chip to delete the group.
            </Mono>
          </View>
        }
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
  groupChips: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.xs,
  },
  groupChip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    backgroundColor: colors.chipBg,
  },
  groupChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  groupInput: {
    borderWidth: 1,
    borderColor: colors.blue,
    borderRadius: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    color: colors.text,
    fontFamily: type.mono,
    fontSize: type.size.xs,
    minWidth: 110,
    backgroundColor: colors.surfaceAlt,
  },
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
    height: ROW_HEIGHT,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  cell: { flex: 0.8, alignItems: 'flex-start' },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingTop: 64,
    paddingHorizontal: space.xl,
  },
});
