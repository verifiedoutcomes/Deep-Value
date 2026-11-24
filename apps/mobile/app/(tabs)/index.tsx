/**
 * Watchlist: subcategories (max 50 names each), searchable/filterable,
 * virtualized for thousands of names across groups. Rows show price,
 * P/E, EV/EBIT, FCF yield and a verdict chip where a base forecast
 * exists. Long-press a row to move or remove it; long-press a group
 * chip to delete the group.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { showAlert } from '../../src/alert';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { analyzeCompany } from '@dvh/engine';
import { activeSnapshot, DEFAULT_HORIZON, MAX_GROUP_SIZE, useAppStore } from '../../src/store';
import { APP_ANALYZE_OPTIONS } from '../../src/analysis';
import { useTickerSearch } from '../../src/data';
import { colors, space, type } from '../../src/theme';
import { Chip, Mono } from '../../src/components/ui';
import { pct, price, ratio } from '../../src/format';
import { tapHaptic, warningHaptic } from '../../src/haptics';
import { NETWORK_BLOCKED } from '../../src/host';
import { LIBRARY_AS_OF, LIBRARY_TICKERS } from '../../src/library';
import { UNIVERSE, normalizeTicker as normalizeSymbol } from '@dvh/data';
import type { SearchHit } from '../../src/data';

const ROW_HEIGHT = 50;
const DELETE_W = 84;

/** "$MSFT ", "brk.b" -> "MSFT", "BRK-B" (the SEC / Yahoo spelling). */
const normalizeTicker = normalizeSymbol;

/**
 * Swipe-left-to-delete row (PanResponder + Animated — no extra native
 * deps, works in Expo Go). Horizontal drags reveal a Remove button;
 * vertical drags stay with the list scroll.
 */
function SwipeableRow({
  children,
  onDelete,
}: {
  children: React.ReactNode;
  onDelete: () => void;
}) {
  const tx = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const settle = (open: boolean) => {
    openRef.current = open;
    Animated.spring(tx, {
      toValue: open ? -DELETE_W : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 24,
    }).start();
  };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => {
        const base = openRef.current ? -DELETE_W : 0;
        tx.setValue(Math.min(0, Math.max(-DELETE_W - 24, base + g.dx)));
      },
      onPanResponderRelease: (_e, g) => {
        const end = (openRef.current ? -DELETE_W : 0) + g.dx;
        settle(end < -DELETE_W / 2);
      },
      onPanResponderTerminate: () => settle(openRef.current),
    }),
  ).current;

  return (
    <View style={{ height: ROW_HEIGHT }}>
      {/* hidden at rest: sub-pixel gaps would otherwise show a red hairline */}
      <Animated.View
        style={[
          swipeStyles.deleteUnder,
          { opacity: tx.interpolate({ inputRange: [-1, 0], outputRange: [1, 0], extrapolate: 'clamp' }) },
        ]}
      >
        <Pressable
          style={swipeStyles.deleteBtn}
          onPress={() => {
            warningHaptic();
            settle(false);
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel="Remove from watchlist"
        >
          <Mono size="sm" color={colors.text} bold>Remove</Mono>
        </Pressable>
      </Animated.View>
      <Animated.View
        style={{ transform: [{ translateX: tx }], backgroundColor: colors.bg }}
        {...pan.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const swipeStyles = StyleSheet.create({
  deleteUnder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
    backgroundColor: colors.red,
  },
  deleteBtn: {
    width: DELETE_W,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

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
    () =>
      snapshot
        ? analyzeCompany(snapshot, state?.overrides ?? {}, capexTreatment, APP_ANALYZE_OPTIONS)
        : null,
    [snapshot, state?.overrides, capexTreatment],
  );

  // the base case at the horizon this company's Valuation tab is set to
  const horizon = state?.horizon ?? DEFAULT_HORIZON;
  const base = analysis?.scenarios.base[horizon];
  const hasForecast = base?.status === 'ok' && base.fairValuePerShare != null;
  const upside =
    hasForecast && snapshot ? base!.fairValuePerShare! / snapshot.quote.price - 1 : null;

  const showActions = () => {
    warningHaptic();
    const moveButtons = groups
      .filter((g) => !g.tickers.includes(ticker))
      .slice(0, 5)
      .map((g) => ({
        text: `Move to ${g.name}`,
        onPress: () => {
          const err = moveToGroup(ticker, g.name);
          if (err) showAlert('Cannot move', err);
        },
      }));
    showAlert(ticker, 'Snapshots and scenario edits are kept either way.', [
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
        <Mono size="xs" color={colors.textFaint} lines={1}>
          {snapshot?.name ?? 'No data yet'}
        </Mono>
      </View>
      <View style={styles.cell}>
        <Mono size="sm">{price(snapshot?.quote.price ?? null)}</Mono>
      </View>
      <View style={styles.cell}>
        <Mono size="sm">{ratio(analysis?.header.peLiveCap ?? null)}</Mono>
      </View>
      <View style={styles.cell}>
        <Mono size="sm">{ratio(analysis?.header.evOverOperatingIncome ?? null)}</Mono>
      </View>
      <View style={styles.cell}>
        <Mono size="sm">{pct(analysis?.header.adjFcfYield ?? null)}</Mono>
      </View>
      <View
        style={[styles.cell, { alignItems: 'flex-end' }]}
        accessibilityLabel={
          hasForecast
            ? `Base case ${horizon}-year fair value ${upside! >= 0 ? 'above' : 'below'} price by ${Math.abs(upside! * 100).toFixed(0)}%`
            : 'No base case forecast'
        }
      >
        {hasForecast ? (
          <Mono size="sm" bold color={upside! >= 0 ? colors.accent : colors.red}>
            {`${upside! >= 0 ? '+' : ''}${(upside! * 100).toFixed(0)}%`}
          </Mono>
        ) : (
          <Mono size="sm" color={colors.textFaint}>–</Mono>
        )}
      </View>
    </Pressable>
  );
}

const UPSIDE_HELP =
  "Upside compares the base case's fair value per share with today's price, at each " +
  "company's forecast horizon (3 years unless you switch it on the Valuation tab).\n\n" +
  '+25% means the base case says the share is worth 25% more than today; −30% means 30% ' +
  'less. A dash means there is no base-case value yet. Bear and Bull are not included.';

/** One header row for the list, so the cells don't each repeat a label. */
function ColumnHeaders() {
  const head = (label: string) => (
    <Mono size="xs" color={colors.textFaint} bold>
      {label}
    </Mono>
  );
  return (
    <View style={styles.headerRow}>
      <View style={{ flex: 1.2 }}>{head('Company')}</View>
      <View style={styles.cell}>{head('Price')}</View>
      <View style={styles.cell}>{head('P/E')}</View>
      <View style={styles.cell}>{head('EV/EBIT')}</View>
      <View style={styles.cell}>{head('FCF yield')}</View>
      <Pressable
        style={[styles.cell, { alignItems: 'flex-end' }]}
        onPress={() => {
          tapHaptic();
          showAlert('Upside', UPSIDE_HELP);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="What upside means"
      >
        <Mono size="xs" color={colors.blue} bold>
          Upside ⓘ
        </Mono>
      </Pressable>
    </View>
  );
}

export default function WatchlistScreen() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'added' | 'az'>('added');
  const searchRef = useRef<TextInput>(null);
  const savedCount = useAppStore((s) => s.savedAnalyses.length);
  // "Research next ticker" hand-off: /?focus=1 lands here with the
  // search box focused and the keyboard up, ready for the next name.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  useEffect(() => {
    if (focus === '1') {
      const t = setTimeout(() => searchRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [focus]);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState('');
  const groups = useAppStore((s) => s.watchlistGroups);
  const activeGroupName = useAppStore((s) => s.activeGroup);
  const setActiveGroup = useAppStore((s) => s.setActiveGroup);
  const addGroup = useAppStore((s) => s.addGroup);
  const removeGroup = useAppStore((s) => s.removeGroup);
  const addToWatchlist = useAppStore((s) => s.addToWatchlist);
  // Search with the normalised ticker ("$MSFT " -> "MSFT"): FMP returns
  // nothing for $-prefixed queries.
  const search = useTickerSearch(normalizeTicker(query));

  const activeGroup = groups.find((g) => g.name === activeGroupName) ?? groups[0];
  const tickers = activeGroup?.tickers ?? [];
  const allTickers = useMemo(() => new Set(groups.flatMap((g) => g.tickers)), [groups]);
  const removeFromWatchlist = useAppStore((s) => s.removeFromWatchlist);

  const tryAdd = (t: string) => {
    const err = addToWatchlist(t);
    if (err) {
      warningHaptic();
      showAlert('Cannot add', err);
    } else {
      tapHaptic();
      setQuery('');
    }
  };

  const pickHit = (r: SearchHit) => {
    if (r.unsupported) {
      warningHaptic();
      showAlert(`${r.ticker} isn't supported yet`, r.unsupported);
      return;
    }
    tryAdd(r.ticker);
  };

  const addManual = () => {
    const t = normalizeTicker(query);
    if (!/^[A-Z.\-]{1,10}$/.test(t)) return;
    const hit = search.data.find((r) => r.ticker === t);
    if (hit) pickHit(hit);
    else tryAdd(t);
  };

  const commitGroup = () => {
    const err = addGroup(groupDraft);
    if (err) {
      warningHaptic();
      showAlert('Cannot create group', err);
    } else {
      tapHaptic();
      setGroupDraft('');
      setAddingGroup(false);
    }
  };

  const q = normalizeTicker(query);
  const tickerStates = useAppStore((s) => s.tickers);
  const visible = useMemo(() => {
    // match the ticker or the company name ("nike" finds NKE)
    const filtered = q
      ? tickers.filter(
          (t) =>
            t.includes(q) ||
            (activeSnapshot(tickerStates[t])?.name.toUpperCase().includes(q) ?? false),
        )
      : [...tickers];
    if (sort === 'az') filtered.sort();
    return filtered;
  }, [tickers, tickerStates, q, sort]);
  const newResults = search.data.filter((r) => !allTickers.has(r.ticker)).slice(0, 5);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.searchWrap}>
        <TextInput
          ref={searchRef}
          style={styles.search}
          placeholder="Search or filter tickers…"
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
        <Link href="/saved" asChild>
          <Pressable style={styles.gear} accessibilityLabel={`saved analyses (${savedCount})`}>
            <Mono size="lg" color={savedCount > 0 ? colors.accent : colors.textDim}>⌸</Mono>
          </Pressable>
        </Link>
        <Link href="/settings" asChild>
          <Pressable style={styles.gear} accessibilityLabel="settings">
            <Mono size="xl" color={colors.accent}>⚙</Mono>
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
              showAlert(
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
            placeholder="Group name"
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
            <Mono size="xs" color={colors.blue}>+ New group</Mono>
          </Pressable>
        )}
      </ScrollView>

      {q.length > 0 && (
        <View style={styles.results}>
          {search.isLoading && (
            <View style={styles.resultRow}>
              <Mono size="sm" color={colors.textFaint}>Searching…</Mono>
            </View>
          )}
          {search.isError && (
            <View style={styles.resultRow}>
              <Mono size="xs" color={colors.red}>
                Search failed: check the API key or proxy in Settings.
              </Mono>
            </View>
          )}
          {newResults.map((r) => (
            <Pressable key={r.ticker} style={styles.resultRow} onPress={() => pickHit(r)}>
              <View style={{ flex: 1, paddingRight: space.sm }}>
                <Mono size="sm" color={r.unsupported ? colors.textDim : colors.text}>
                  + {r.ticker}
                </Mono>
                {r.name ? (
                  <Mono size="xs" color={colors.textFaint} lines={1}>
                    {r.name}
                    {r.indexes?.length ? ` · ${r.indexes.join(' · ')}` : ''}
                  </Mono>
                ) : null}
              </View>
              <Mono
                size="xs"
                color={r.unsupported ? colors.amber : r.bundled ? colors.accent : colors.textFaint}
              >
                {r.unsupported
                  ? 'Not supported'
                  : r.bundled
                    ? 'Data bundled'
                    : search.source === 'free'
                      ? 'Free live data'
                      : r.exchange}
              </Mono>
            </Pressable>
          ))}
          {search.data.length === 0 && q.length >= 2 && (
            <View style={styles.resultRow}>
              <Mono size="xs" color={colors.textFaint}>
                Not in the S&P 500 or Nasdaq-100.
                {search.live ? ' Type the exact ticker and add it to pull it live.' : ''}
              </Mono>
            </View>
          )}
          <View style={styles.resultRow}>
            <Mono size="xs" color={colors.textFaint}>
              {NETWORK_BLOCKED
                ? `All ${LIBRARY_TICKERS.length} of ${UNIVERSE.length} S&P 500 + Nasdaq-100 names that SEC filings support are bundled (as of ${LIBRARY_AS_OF}); live refresh is off in the Claude preview.`
                : search.source === 'free'
                  ? `Search covers all ${UNIVERSE.length} S&P 500 + Nasdaq-100 names; data is free and live (SEC filings + Yahoo prices).`
                  : search.live
                    ? `Search covers all ${UNIVERSE.length} S&P 500 + Nasdaq-100 names.`
                    : `Search covers all ${UNIVERSE.length} S&P 500 + Nasdaq-100 names; live data in a browser needs the data proxy (Settings).`}
            </Mono>
          </View>
          {!allTickers.has(q) && /^[A-Z.\-]{1,10}$/.test(q) && (
            <Pressable style={styles.resultRow} onPress={addManual}>
              <Mono size="sm" color={colors.accent}>
                Add "{q}" to {activeGroup?.name}
              </Mono>
            </Pressable>
          )}
        </View>
      )}
      {visible.length > 0 && <ColumnHeaders />}
      <FlatList
        data={visible}
        keyExtractor={(t) => t}
        renderItem={({ item }) => (
          <SwipeableRow onDelete={() => removeFromWatchlist(item)}>
            <WatchRow ticker={item} />
          </SwipeableRow>
        )}
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
              Search above, or type a ticker and hit return. Swipe a row left to remove it;
              long-press to move it between groups; long-press a group chip to delete the group.
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    gap: 4,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingTop: 64,
    paddingHorizontal: space.xl,
  },
});
