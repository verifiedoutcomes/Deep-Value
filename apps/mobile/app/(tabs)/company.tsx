/**
 * Company screen: summary card, ownership strip, price chart, historical
 * table as horizontally scrollable metric columns with sparklines and the
 * summary-stats row pinned.
 */
import React from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import type { DerivedRow, HistoricalRowInput, Maybe, SummaryStats } from '@dvh/engine';
import { momentumFromHistory, sparklineWindow } from '@dvh/engine';
import { useTickerAnalysis } from '../../src/analysis';
import { useRefreshSnapshot } from '../../src/data';
import { useAppStore, BUNDLED_META } from '../../src/store';
import { colors, deltaColor, space, type } from '../../src/theme';
import { tapHaptic } from '../../src/haptics';
import { Banner, Card, Chip, KV, Mono, SectionTitle } from '../../src/components/ui';
import { AnalysisBar } from '../../src/components/AnalysisBar';
import { PriceChart } from '../../src/components/PriceChart';
import { Sparkline } from '../../src/components/Sparkline';
import { money, num, pct, pctSigned, price, ratio, shares } from '../../src/format';

interface ColumnSpec {
  key: string;
  title: string;
  value: (row: HistoricalRowInput, d: DerivedRow) => Maybe;
  fmt: (v: Maybe) => string;
  summary: (s: SummaryStats) => Maybe;
  summaryFmt?: (v: Maybe) => string;
  summaryLabel: string;
}

/** All the sheet's columns (D..AB), grouped for readability. */
const COLUMNS: ColumnSpec[] = [
  { key: 'rev', title: 'Revenue', value: (r) => r.revenue, fmt: money, summary: (s) => s.revenueCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'yoy', title: 'Y/Y Δ', value: (_r, d) => d.revenueYoY, fmt: pctSigned, summary: (s) => s.revenueYoyAvg4, summaryFmt: pct, summaryLabel: 'avg 4' },
  { key: 'gp', title: 'Gross Profit', value: (r) => r.grossProfit, fmt: money, summary: () => null, summaryLabel: '' },
  { key: 'gm', title: 'Gross Mgn', value: (_r, d) => d.grossMargin, fmt: pct, summary: () => null, summaryLabel: '' },
  { key: 'opinc', title: 'Op Income', value: (r) => r.operatingIncome, fmt: money, summary: (s) => s.operatingIncomeCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'opmar', title: 'Op Margin', value: (_r, d) => d.operatingMargin, fmt: pct, summary: (s) => s.operatingMarginAvg4, summaryFmt: pct, summaryLabel: 'avg 4' },
  { key: 'ni', title: 'Net Income', value: (r) => r.netIncome, fmt: money, summary: () => null, summaryLabel: '' },
  { key: 'nm', title: 'Net Mgn', value: (_r, d) => d.netMargin, fmt: pct, summary: () => null, summaryLabel: '' },
  { key: 'ocf', title: 'Op Cash Flow', value: (r) => r.operatingCashFlow, fmt: money, summary: (s) => s.ocfCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'capex', title: 'Capex', value: (r) => r.capex, fmt: money, summary: (s) => s.capexCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'sbc', title: 'SBC', value: (r) => r.sbc, fmt: money, summary: (s) => s.sbcCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'fcf', title: 'Adj FCF', value: (_r, d) => d.adjFcf, fmt: money, summary: (s) => s.adjFcfCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'fcfm', title: 'Adj FCF Mgn', value: (_r, d) => d.adjFcfMargin, fmt: pct, summary: (s) => s.adjFcfMarginAvg4, summaryFmt: pct, summaryLabel: 'avg 4' },
  { key: 'fcfy', title: 'Adj FCF Yield', value: (_r, d) => d.adjFcfYield, fmt: pct, summary: (s) => s.adjFcfYieldTrimmean, summaryFmt: pct, summaryLabel: 'trim mean' },
  { key: 'nd', title: 'Net Debt', value: (r) => r.netDebt, fmt: money, summary: () => null, summaryLabel: '' },
  { key: 'ndebit', title: 'ND / EBIT', value: (_r, d) => d.netDebtToEbit, fmt: (v) => num(v, 2), summary: (s) => s.netDebtEbitAvg13, summaryFmt: (v) => num(v, 2), summaryLabel: 'avg 13' },
  { key: 'sh', title: 'Shares', value: (r) => r.shares, fmt: shares, summary: (s) => s.sharesCagr10, summaryFmt: pct, summaryLabel: '10y cagr' },
  { key: 'mc', title: 'Market Cap', value: (r) => r.marketCap, fmt: money, summary: (s) => s.marketCapCagr10, summaryFmt: pct, summaryLabel: '10y cagr' },
  { key: 'ev', title: 'EV', value: (_r, d) => d.enterpriseValue, fmt: money, summary: (s) => s.evCagr10, summaryFmt: pct, summaryLabel: '10y cagr' },
  { key: 'evebit', title: 'EV/EBIT', value: (_r, d) => d.evToEbit, fmt: (v) => num(v, 1), summary: (s) => s.evEbitTrimmean, summaryFmt: (v) => num(v, 1), summaryLabel: 'trim mean' },
  { key: 'tb', title: 'Tang Book', value: (r) => r.tangibleBook, fmt: money, summary: (s) => s.tangibleBookCagr10, summaryFmt: pct, summaryLabel: '10y cagr' },
  // income-split waterfall components (sheet Z, AA, AB)
  { key: 'opni', title: 'OpInc − NetInc', value: (_r, d) => d.opIncMinusNetInc, fmt: money, summary: () => null, summaryLabel: '' },
  { key: 'gpop', title: 'GP − OpInc', value: (_r, d) => d.grossProfitMinusOpInc, fmt: money, summary: () => null, summaryLabel: '' },
  { key: 'revgp', title: 'Rev − GP', value: (_r, d) => d.revenueMinusGrossProfit, fmt: money, summary: () => null, summaryLabel: '' },
];

/** Column groups: the full sheet table, split so it reads on a phone. */
const GROUPS: { key: string; label: string; cols: string[] | null }[] = [
  { key: 'all', label: 'All', cols: null },
  { key: 'pnl', label: 'P&L', cols: ['rev', 'yoy', 'gp', 'gm', 'opinc', 'opmar', 'ni', 'nm'] },
  { key: 'cash', label: 'Cash Flow', cols: ['ocf', 'capex', 'sbc', 'fcf', 'fcfm', 'fcfy'] },
  { key: 'bal', label: 'Balance & Val', cols: ['nd', 'ndebit', 'sh', 'mc', 'ev', 'evebit', 'tb'] },
  { key: 'split', label: 'Income Split', cols: ['opni', 'gpop', 'revgp'] },
];

const ROW_H = 22;
const COL_W = 96;
const HEAD_H = 44;

export default function CompanyScreen() {
  const { width } = useWindowDimensions();
  const { ticker, snapshot, analysis, capexTreatment, reviewing } = useTickerAnalysis();
  const refresh = useRefreshSnapshot(ticker);

  if (!snapshot || !analysis) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
        <Banner>
          No snapshot for {ticker} yet — pull live data with the refresh gesture, or configure
          the data proxy in Settings.
        </Banner>
      </View>
    );
  }

  const h = analysis.header;
  const own = snapshot.ownership;
  const momentum =
    own.momentum ?? momentumFromHistory(snapshot.priceHistory, snapshot.snapshotDate);
  const isBundled = snapshot === BUNDLED_META;
  const ageDays = Math.floor(
    (Date.now() - new Date(snapshot.snapshotDate).getTime()) / (24 * 3600 * 1000),
  );
  const stale = ageDays > 7;
  const bannerText = isBundled
    ? `Bundled snapshot ${snapshot.snapshotDate} — pull down to refresh live.`
    : refresh.isError
      ? `Refresh failed (${refresh.error instanceof Error ? refresh.error.message : 'network'}). Showing snapshot ${snapshot.snapshotDate}.`
      : stale
        ? `Snapshot is ${ageDays} days old (${snapshot.snapshotDate}) — pull down to refresh.`
        : `Snapshot ${snapshot.snapshotDate} — pull down to refresh.`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      refreshControl={
        // no live refresh while reviewing a frozen analysis
        reviewing ? undefined : (
          <RefreshControl
            refreshing={refresh.isPending}
            onRefresh={() => refresh.mutate()}
            tintColor={colors.accent}
          />
        )
      }
      contentContainerStyle={{ paddingBottom: space.xl }}
    >
      <AnalysisBar reviewing={reviewing} />
      {!reviewing && (
        <Banner tone={isBundled || stale || refresh.isError ? 'warn' : 'info'}>{bannerText}</Banner>
      )}

      <Card>
        <View style={styles.headRow}>
          <View>
            <Mono size="xl" bold>{snapshot.ticker}</Mono>
            <Mono size="xs" color={colors.textDim}>{snapshot.name}</Mono>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Mono size="xl" bold>{price(snapshot.quote.price)}</Mono>
            <Mono size="xs" color={colors.textDim}>{money(h.marketCapLive)} mkt cap</Mono>
          </View>
        </View>
        <View style={styles.grid}>
          <View style={styles.gridCol}>
            <KV label="P/E (live)" value={num(h.peLiveCap)} />
            <KV label="P/E (snap)" value={num(h.peSnapshotCap)} />
            <KV label="EV / Op Inc" value={num(h.evOverOperatingIncome)} />
            <KV label="Adj FCF Yield" value={pct(h.adjFcfYield, 2)} />
            <KV label="ND / Op Inc" value={num(h.netDebtOverOpIncome)} />
          </View>
          <View style={styles.gridCol}>
            <KV label="Op Margin" value={pct(h.operatingMargin)} />
            <KV label="ROIC" value={pct(h.roic, 2)} />
            <KV label="P/Tang Book" value={num(h.priceToTangibleBook)} />
            <KV label="P/Adj OCF" value={num(h.priceToAdjOcf)} />
            <KV
              label="Adj ROIC"
              value={h.adjRoic === 'Neg Book' ? 'Neg Book' : pct(h.adjRoic as Maybe, 2)}
            />
          </View>
        </View>
      </Card>

      <Card>
        <SectionTitle>Ownership · Sentiment</SectionTitle>
        <View style={styles.ownStrip}>
          <OwnCell label="insider" value={pct(own.insiderOwnership, 2)} />
          <OwnCell label="insider Δ" value={pctSigned(own.insiderOwnershipChange, 2)} v={own.insiderOwnershipChange} />
          <OwnCell label="institut." value={pct(own.institutionalOwnership, 2)} />
          <OwnCell label="short int" value={own.shortInterest ?? '–'} />
          <OwnCell label="momentum" value={pctSigned(momentum, 1)} v={momentum} />
        </View>
      </Card>

      <Card>
        <SectionTitle>Price · 7y weekly</SectionTitle>
        <PriceChart history={snapshot.priceHistory} width={width - 2 * space.md - 2 * space.md} />
      </Card>

      <Card style={{ paddingHorizontal: 0 }}>
        <View style={{ paddingHorizontal: space.md }}>
          <SectionTitle>
            Historical Data{capexTreatment === 'sheet' ? '  ·  Adj FCF = OCF + |capex| − SBC (sheet default)' : ''}
          </SectionTitle>
          <Mono size="xs" color={colors.textFaint}>
            tap a column header to chart that metric
          </Mono>
        </View>
        <HistoryTable snapshotRows={snapshot.rows} derived={analysis.derived} summary={analysis.summary} />
      </Card>
    </ScrollView>
  );
}

function OwnCell({ label, value, v }: { label: string; value: string; v?: Maybe }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Mono size="sm" color={v !== undefined ? deltaColor(v) : colors.text} bold>
        {value}
      </Mono>
      <Mono size="xs" color={colors.textFaint}>{label}</Mono>
    </View>
  );
}

/**
 * Full-width single-metric history chart (tap a column header to open).
 * Tap a bar to read its exact value; 10Y/All period toggle.
 */
function MetricChart({
  col,
  snapshotRows,
  derived,
  width,
  onClose,
}: {
  col: ColumnSpec;
  snapshotRows: HistoricalRowInput[];
  derived: DerivedRow[];
  width: number;
  onClose: () => void;
}) {
  const [period, setPeriod] = React.useState<'10y' | 'all'>('10y');
  const all = snapshotRows.map((r, i) => ({
    label: String(r.yearLabel),
    value: col.value(r, derived[i]!),
  }));
  const data = period === '10y' ? all.slice(Math.max(0, all.length - 11)) : all;
  const [selected, setSelected] = React.useState(data.length - 1);
  React.useEffect(() => setSelected(data.length - 1), [period, data.length]);

  const H = 150;
  const nums = data.map((d) => (typeof d.value === 'number' ? d.value : 0));
  const min = Math.min(...nums, 0);
  const max = Math.max(...nums, 0);
  const range = max - min || 1;
  const barW = width / data.length;
  const zeroY = H - 18 - ((0 - min) / range) * (H - 26);
  const y = (v: number) => H - 18 - ((v - min) / range) * (H - 26);
  const sel = data[Math.min(selected, data.length - 1)];

  return (
    <View style={{ paddingHorizontal: space.md, marginBottom: space.sm }}>
      <View style={metricStyles.head}>
        <View>
          <Mono size="sm" bold>{col.title}</Mono>
          <Mono size="xs" color={colors.accent}>
            {sel ? `${sel.label} · ${col.fmt(sel.value)}` : ''}
          </Mono>
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Chip label="10Y" active={period === '10y'} onPress={() => setPeriod('10y')} />
          <Chip label="All" active={period === 'all'} onPress={() => setPeriod('all')} />
          <Chip label="✕" onPress={onClose} />
        </View>
      </View>
      <Svg width={width} height={H}>
        {data.map((d, i) => {
          const v = typeof d.value === 'number' ? d.value : 0;
          const top = Math.min(y(v), zeroY);
          const h = Math.max(Math.abs(zeroY - y(v)), 1);
          const isSel = i === selected;
          const isTTM = d.label === 'TTM';
          return (
            <Rect
              key={i}
              x={i * barW + 1.5}
              y={top}
              width={Math.max(barW - 3, 2)}
              height={h}
              rx={2}
              fill={isSel ? colors.accent : isTTM ? colors.red : colors.blue}
              opacity={isSel ? 1 : 0.85}
              onPress={() => {
                tapHaptic();
                setSelected(i);
              }}
            />
          );
        })}
        {data.map((d, i) =>
          // sparse x labels: first, last and every ~4th
          i === 0 || i === data.length - 1 || i % 4 === 0 ? (
            <SvgText
              key={`l${i}`}
              x={i * barW + barW / 2}
              y={H - 4}
              fontSize={type.size.xs}
              fill={colors.textFaint}
              textAnchor="middle"
            >
              {d.label === 'TTM' ? 'TTM' : `'${d.label.slice(2)}`}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
}

const metricStyles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: space.xs,
  },
});

function HistoryTable({
  snapshotRows,
  derived,
  summary,
}: {
  snapshotRows: HistoricalRowInput[];
  derived: DerivedRow[];
  summary: SummaryStats;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const [chartKey, setChartKey] = React.useState<string | null>(null);
  const [group, setGroup] = React.useState('all');
  const active = GROUPS.find((g) => g.key === group) ?? GROUPS[0]!;
  const cols = active.cols
    ? active.cols.map((k) => COLUMNS.find((c) => c.key === k)!).filter(Boolean)
    : COLUMNS;

  const chartCol = chartKey ? COLUMNS.find((c) => c.key === chartKey) : null;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.groupRow}
      >
        {GROUPS.map((g) => (
          <Chip key={g.key} label={g.label} active={group === g.key} onPress={() => setGroup(g.key)} />
        ))}
      </ScrollView>
      {chartCol && (
        <MetricChart
          col={chartCol}
          snapshotRows={snapshotRows}
          derived={derived}
          width={screenWidth - 4 * space.md}
          onClose={() => setChartKey(null)}
        />
      )}
      <View style={{ flexDirection: 'row' }}>
        {/* pinned year column: header height matches data-column headers
            exactly so every row lines up across the whole table */}
        <View style={styles.yearCol}>
          <View style={[styles.colHead, { alignItems: 'flex-start' }]}>
            <Mono size="xs" color={colors.textFaint}>FY</Mono>
          </View>
          {snapshotRows.map((r, i) => (
            <View key={i} style={styles.cellRow}>
              <Mono size="xs" color={r.yearLabel === 'TTM' ? colors.amber : colors.textDim} bold={r.yearLabel === 'TTM'}>
                {String(r.yearLabel)}
              </Mono>
            </View>
          ))}
          <View style={styles.sumRowYear}>
            <Mono size="xs" color={colors.textFaint}>Σ</Mono>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {cols.map((col) => {
            const values = snapshotRows.map((r, i) => col.value(r, derived[i]!));
            const summaryVal = col.summary(summary);
            return (
              <View key={col.key} style={styles.dataCol}>
                {/* header: title and sparkline share the column's right edge
                    with the numbers below; tap to open the metric chart */}
                <Pressable
                  style={styles.colHead}
                  onPress={() => {
                    tapHaptic();
                    setChartKey((k) => (k === col.key ? null : col.key));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`chart ${col.title}`}
                >
                  <Mono size="xs" color={chartKey === col.key ? colors.accent : colors.textDim}>
                    {col.title}
                  </Mono>
                  <Sparkline values={sparklineWindow(values)} width={COL_W - 12} height={18} />
                </Pressable>
                {values.map((v, i) => (
                  <View key={i} style={[styles.cellRow, { alignItems: 'flex-end' }]}>
                    <Mono size="xs" color={i === values.length - 1 ? colors.text : colors.textDim}>
                      {col.fmt(v)}
                    </Mono>
                  </View>
                ))}
                <View style={styles.sumRow}>
                  <Mono size="xs" color={colors.blue} bold>
                    {summaryVal == null ? '' : (col.summaryFmt ?? col.fmt)(summaryVal)}
                  </Mono>
                  {summaryVal != null && (
                    <Mono size="xs" color={colors.textFaint}>{col.summaryLabel}</Mono>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  grid: { flexDirection: 'row', gap: space.lg },
  gridCol: { flex: 1 },
  ownStrip: { flexDirection: 'row', justifyContent: 'space-between' },
  yearCol: {
    width: 44,
    paddingLeft: space.md,
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    marginRight: space.sm,
  },
  groupRow: {
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    flexDirection: 'row',
  },
  dataCol: {
    width: COL_W,
    paddingRight: space.sm,
    alignItems: 'flex-end',
  },
  colHead: {
    height: HEAD_H,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    alignSelf: 'stretch',
  },
  cellRow: {
    height: ROW_H,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  sumRow: {
    height: ROW_H + 12,
    justifyContent: 'center',
    alignItems: 'flex-end',
    alignSelf: 'stretch',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sumRowYear: {
    height: ROW_H + 12,
    justifyContent: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
