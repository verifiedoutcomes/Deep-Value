/**
 * Company screen: summary card, ownership strip, price chart, historical
 * table as horizontally scrollable metric columns with sparklines and the
 * summary-stats row pinned.
 */
import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import type { DerivedRow, HistoricalRowInput, Maybe, SummaryStats } from '@dvh/engine';
import { momentumFromHistory, sparklineWindow } from '@dvh/engine';
import { useTickerAnalysis } from '../../src/analysis';
import { useRefreshSnapshot } from '../../src/data';
import { useAppStore, BUNDLED_META } from '../../src/store';
import { colors, deltaColor, space } from '../../src/theme';
import { Banner, Card, KV, Mono, SectionTitle } from '../../src/components/ui';
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

const COLUMNS: ColumnSpec[] = [
  { key: 'rev', title: 'Revenue', value: (r) => r.revenue, fmt: money, summary: (s) => s.revenueCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'yoy', title: 'Y/Y Δ', value: (_r, d) => d.revenueYoY, fmt: pctSigned, summary: (s) => s.revenueYoyAvg4, summaryFmt: pct, summaryLabel: 'avg 4' },
  { key: 'opinc', title: 'Op Income', value: (r) => r.operatingIncome, fmt: money, summary: (s) => s.operatingIncomeCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'opmar', title: 'Op Margin', value: (_r, d) => d.operatingMargin, fmt: pct, summary: (s) => s.operatingMarginAvg4, summaryFmt: pct, summaryLabel: 'avg 4' },
  { key: 'ocf', title: 'Op Cash Flow', value: (r) => r.operatingCashFlow, fmt: money, summary: (s) => s.ocfCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'capex', title: 'Capex', value: (r) => r.capex, fmt: money, summary: (s) => s.capexCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'sbc', title: 'SBC', value: (r) => r.sbc, fmt: money, summary: (s) => s.sbcCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'fcf', title: 'Adj FCF', value: (_r, d) => d.adjFcf, fmt: money, summary: (s) => s.adjFcfCagr8, summaryFmt: pct, summaryLabel: '8y cagr' },
  { key: 'fcfm', title: 'Adj FCF Mgn', value: (_r, d) => d.adjFcfMargin, fmt: pct, summary: (s) => s.adjFcfMarginAvg4, summaryFmt: pct, summaryLabel: 'avg 4' },
  { key: 'nd', title: 'Net Debt', value: (r) => r.netDebt, fmt: money, summary: () => null, summaryLabel: '' },
  { key: 'ndebit', title: 'ND / EBIT', value: (_r, d) => d.netDebtToEbit, fmt: (v) => num(v, 2), summary: (s) => s.netDebtEbitAvg13, summaryFmt: (v) => num(v, 2), summaryLabel: 'avg 13' },
  { key: 'sh', title: 'Shares', value: (r) => r.shares, fmt: shares, summary: (s) => s.sharesCagr10, summaryFmt: pct, summaryLabel: '10y cagr' },
  { key: 'mc', title: 'Market Cap', value: (r) => r.marketCap, fmt: money, summary: (s) => s.marketCapCagr10, summaryFmt: pct, summaryLabel: '10y cagr' },
  { key: 'ev', title: 'EV', value: (_r, d) => d.enterpriseValue, fmt: money, summary: (s) => s.evCagr10, summaryFmt: pct, summaryLabel: '10y cagr' },
  { key: 'fcfy', title: 'Adj FCF Yield', value: (_r, d) => d.adjFcfYield, fmt: pct, summary: (s) => s.adjFcfYieldTrimmean, summaryFmt: pct, summaryLabel: 'trim mean' },
  { key: 'evebit', title: 'EV/EBIT', value: (_r, d) => d.evToEbit, fmt: (v) => num(v, 1), summary: (s) => s.evEbitTrimmean, summaryFmt: (v) => num(v, 1), summaryLabel: 'trim mean' },
  { key: 'tb', title: 'Tang Book', value: (r) => r.tangibleBook, fmt: money, summary: (s) => s.tangibleBookCagr10, summaryFmt: pct, summaryLabel: '10y cagr' },
  { key: 'gp', title: 'Gross Profit', value: (r) => r.grossProfit, fmt: money, summary: () => null, summaryLabel: '' },
  { key: 'gm', title: 'Gross Mgn', value: (_r, d) => d.grossMargin, fmt: pct, summary: () => null, summaryLabel: '' },
  { key: 'ni', title: 'Net Income', value: (r) => r.netIncome, fmt: money, summary: () => null, summaryLabel: '' },
  { key: 'nm', title: 'Net Mgn', value: (_r, d) => d.netMargin, fmt: pct, summary: () => null, summaryLabel: '' },
];

const ROW_H = 22;
const COL_W = 96;

export default function CompanyScreen() {
  const { width } = useWindowDimensions();
  const { ticker, snapshot, analysis } = useTickerAnalysis();
  const refresh = useRefreshSnapshot(ticker);
  const capexTreatment = useAppStore((s) => s.capexTreatment);

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
        <RefreshControl
          refreshing={refresh.isPending}
          onRefresh={() => refresh.mutate()}
          tintColor={colors.accent}
        />
      }
      contentContainerStyle={{ paddingBottom: space.xl }}
    >
      <Banner tone={isBundled || stale || refresh.isError ? 'warn' : 'info'}>{bannerText}</Banner>

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

function HistoryTable({
  snapshotRows,
  derived,
  summary,
}: {
  snapshotRows: HistoricalRowInput[];
  derived: DerivedRow[];
  summary: SummaryStats;
}) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {/* pinned year column */}
      <View style={styles.yearCol}>
        <View style={{ height: 42 }}>
          <Mono size="xs" color={colors.textFaint}>FY</Mono>
        </View>
        {snapshotRows.map((r, i) => (
          <View key={i} style={{ height: ROW_H, justifyContent: 'center' }}>
            <Mono size="xs" color={r.yearLabel === 'TTM' ? colors.amber : colors.textDim} bold={r.yearLabel === 'TTM'}>
              {String(r.yearLabel)}
            </Mono>
          </View>
        ))}
        <View style={{ height: ROW_H + 6, justifyContent: 'center' }}>
          <Mono size="xs" color={colors.textFaint}>Σ</Mono>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {COLUMNS.map((col) => {
          const values = snapshotRows.map((r, i) => col.value(r, derived[i]!));
          const summaryVal = col.summary(summary);
          return (
            <View key={col.key} style={{ width: COL_W, paddingRight: space.sm }}>
              <View style={{ height: 42 }}>
                <Mono size="xs" color={colors.textDim}>{col.title}</Mono>
                <Sparkline values={sparklineWindow(values)} width={COL_W - 12} height={18} />
              </View>
              {values.map((v, i) => (
                <View key={i} style={{ height: ROW_H, justifyContent: 'center' }}>
                  <Mono size="xs" color={i === values.length - 1 ? colors.text : colors.textDim}>
                    {col.fmt(v)}
                  </Mono>
                </View>
              ))}
              <View
                style={{
                  height: ROW_H + 6,
                  justifyContent: 'center',
                  borderTopColor: colors.border,
                  borderTopWidth: StyleSheet.hairlineWidth,
                }}
              >
                <Mono size="xs" color={colors.blue} bold>
                  {summaryVal == null ? '' : `${(col.summaryFmt ?? col.fmt)(summaryVal)} ${col.summaryLabel}`}
                </Mono>
              </View>
            </View>
          );
        })}
      </ScrollView>
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
});
