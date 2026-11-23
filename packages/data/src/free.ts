/**
 * The free, keyless data source: SEC EDGAR for every statement figure and
 * share count (public domain), Yahoo Finance's public chart endpoint for
 * prices, 52-week range and split history.
 *
 * Market cap is never taken on trust from a price feed: it is the SEC
 * share count × the price, with the count carried forward through any
 * stock split after the filing that reported it (Yahoo prices are
 * split-adjusted; old filings are not). The same rule gives every
 * fiscal-year-end market cap, hence historical EV and EV/EBIT.
 *
 * Licensing: SEC data is public domain. Yahoo's chart endpoint is
 * unofficial and its terms restrict commercial redistribution, so it
 * suits personal use and this app's free tier; a paid release should
 * swap `fetchYahooChart` for a licensed price feed (one function).
 */
import type { OwnershipStats, PricePoint } from '@dvh/engine';
import type {
  AnnualFundamentals,
  DataProvider,
  QuoteData,
  SymbolRef,
  TtmFundamentals,
} from './provider';
import { closeNearest } from './composite';
import {
  extractAnnuals,
  extractTtm,
  isBankLike,
  reportsInUsd,
  type Dated,
  type SecCompanyFacts,
} from './sec-facts';

export interface YahooChart {
  symbol: string;
  currency: string;
  price: number;
  name: string | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** Weekly closes, split-adjusted, oldest first. */
  points: PricePoint[];
  /** Splits, oldest first; ratio = new shares per old share (4 for 4:1). */
  splits: { date: string; ratio: number }[];
}

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/** Yahoo uses '-' for share classes (BRK-B); indexes often print '.'. */
export const yahooSymbol = (ticker: string) => ticker.toUpperCase().replace(/\./g, '-');

export async function fetchYahooChart(
  ticker: string,
  fromYear: number,
  fetchImpl: typeof fetch = fetch,
): Promise<YahooChart> {
  const p1 = Math.floor(Date.UTC(fromYear, 0, 1) / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(ticker))}` +
    `?period1=${p1}&period2=${p2}&interval=1wk&events=split`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`prices ${ticker}: HTTP ${res.status}`);
  const j = (await res.json()) as {
    chart: { result?: YahooResult[] | null; error?: { description?: string } | null };
  };
  const r = j.chart.result?.[0];
  if (!r) throw new Error(`prices ${ticker}: ${j.chart.error?.description ?? 'no data'}`);
  const closes = r.indicators.quote[0]?.close ?? [];
  const points: PricePoint[] = [];
  (r.timestamp ?? []).forEach((t, i) => {
    const c = closes[i];
    if (typeof c === 'number' && Number.isFinite(c)) points.push({ date: iso(t), close: c });
  });
  const splits = Object.values(r.events?.splits ?? {})
    .map((s) => ({ date: iso(s.date), ratio: s.numerator / s.denominator }))
    .filter((s) => Number.isFinite(s.ratio) && s.ratio > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const m = r.meta;
  return {
    symbol: m.symbol,
    currency: m.currency,
    price: m.regularMarketPrice,
    name: m.longName ?? m.shortName ?? null,
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
    points,
    splits,
  };
}

interface YahooResult {
  meta: {
    symbol: string;
    currency: string;
    regularMarketPrice: number;
    longName?: string;
    shortName?: string;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
  };
  timestamp?: number[];
  indicators: { quote: { close?: (number | null)[] }[] };
  events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> };
}

/** Product of split ratios strictly after `date` (ISO). */
export function splitFactorAfter(splits: YahooChart['splits'], date: string): number {
  return splits.reduce((f, s) => (s.date > date ? f * s.ratio : f), 1);
}

/** A share count restated to today's share basis. */
export function sharesToday(d: Dated, splits: YahooChart['splits']): number {
  return d.val * splitFactorAfter(splits, d.filed);
}

/** A total share count from outside SEC's standard data (see share-overrides.json). */
export interface ShareOverride {
  shares: number;
  asOf: string;
  source: string;
}

/**
 * Drop share counts that can't be right once restated to today's basis:
 * more than 5× from today's count either way, or a one-year spike away
 * from two neighbours that agree with each other (a single-class or
 * mis-scaled figure in one filing). A dropped year gets no market cap,
 * which beats a wrong one in the EV/EBIT history.
 */
export function cleanShareSeries(series: (number | null)[], current: number | null): (number | null)[] {
  const out = series.map((v) =>
    v != null && current != null && (v / current > 5 || v / current < 0.2) ? null : v,
  );
  const within = (a: number, b: number, lo: number) => a / b >= lo && a / b <= 1 / lo;
  return out.map((v, i) => {
    const prev = out[i - 1];
    const next = out[i + 1];
    if (v == null || prev == null || next == null) return v;
    if (within(prev, next, 0.8) && !within(v, prev, 0.6) && !within(v, next, 0.6)) return null;
    return v;
  });
}

export interface FreeProviderOptions {
  /** companyfacts for a CIK (direct from data.sec.gov, a proxy or a cache). */
  loadFacts: (cik: number) => Promise<SecCompanyFacts>;
  /** Ticker -> CIK (the bundled universe, or SEC's ticker file). */
  cikFor: (ticker: string) => Promise<number | null>;
  /** Predecessor registrants whose history belongs to a ticker. */
  predecessors?: Record<string, number[]>;
  fetchImpl?: typeof fetch;
  /** First year of price history to request (FYE market caps need it). */
  firstYear?: number;
  /** Totals for share structures SEC's standard data can't sum. */
  shareOverrides?: Record<string, ShareOverride>;
}

interface Loaded {
  docs: SecCompanyFacts[];
  chart: YahooChart;
  annuals: ReturnType<typeof extractAnnuals>;
  ttm: ReturnType<typeof extractTtm>;
  notes: Set<string>;
}

export class FreeProvider implements DataProvider {
  readonly id = 'free:sec-edgar+yahoo';
  private readonly cache = new Map<string, Promise<Loaded>>();

  constructor(private readonly opts: FreeProviderOptions) {}

  private load(symbol: SymbolRef): Promise<Loaded> {
    const t = symbol.ticker.toUpperCase();
    let p = this.cache.get(t);
    if (!p) {
      p = this.loadUncached(t);
      this.cache.set(t, p);
      p.catch(() => this.cache.delete(t)); // allow a retry after a failure
    }
    return p;
  }

  private async loadUncached(ticker: string): Promise<Loaded> {
    const cik = await this.opts.cikFor(ticker);
    if (cik == null) throw new Error(`${ticker}: not an SEC filer (no CIK)`);
    const extra = this.opts.predecessors?.[ticker] ?? [];
    const [docs, chart] = await Promise.all([
      Promise.all([cik, ...extra].map((c) => this.opts.loadFacts(c))),
      fetchYahooChart(ticker, this.opts.firstYear ?? 2006, this.opts.fetchImpl ?? fetch),
    ]);
    if (chart.currency !== 'USD') throw new Error(`${ticker}: prices are in ${chart.currency}, not USD`);
    if (!reportsInUsd(docs)) {
      throw new Error(`${ticker}: no USD annual statements on Form 10-K (foreign filer?)`);
    }
    const notes = new Set<string>();
    if (extra.length) notes.add('History includes predecessor registrant filings.');
    if (isBankLike(docs)) {
      notes.add('Bank-style financials: EV/EBIT and free-cash-flow valuation fit banks poorly.');
    }
    const annuals = extractAnnuals(docs, 2007, notes);
    if (annuals.length === 0) throw new Error(`${ticker}: no annual report (10-K) filed yet`);
    // Refuse rather than mislead: the valuation needs these from the
    // LATEST annual report (an older one would pair stale fundamentals
    // with today's price).
    const latest = annuals[annuals.length - 1]!;
    const missing = (['revenue', 'operatingIncome', 'operatingCashFlow', 'netIncome'] as const).filter(
      (k) => latest[k] == null,
    );
    if (missing.length) {
      throw new Error(
        `${ticker}: the latest 10-K (FY${latest.fiscalYear}) doesn't report ${missing.join(', ')} in SEC's standard tags`,
      );
    }
    const ttm = extractTtm(docs, annuals, notes);
    const override = this.opts.shareOverrides?.[ticker];
    if (override) {
      notes.add(
        `Share count: ${override.source} (${override.asOf}); SEC's standard data has no single total for this share structure.`,
      );
      notes.add('Historical market caps are left blank (the listed class\'s share of ownership changed over time), so the exit multiple seeds from today\'s EV/EBIT.');
    }
    return { docs, chart, annuals, ttm, notes };
  }

  async search(_query: string): Promise<SymbolRef[]> {
    return []; // the app searches its bundled universe list instead
  }

  /** Today's total share count: an override if the structure needs one. */
  private currentShares(ticker: string, l: Loaded): number {
    const o = this.opts.shareOverrides?.[ticker.toUpperCase()];
    if (o) return o.shares * splitFactorAfter(l.chart.splits, o.asOf);
    if (!l.ttm.sharesDated) throw new Error(`${ticker}: no current share count in SEC filings`);
    return sharesToday(l.ttm.sharesDated, l.chart.splits);
  }

  private currentSharesOrNull(ticker: string, l: Loaded): number | null {
    try {
      return this.currentShares(ticker, l);
    } catch {
      return null;
    }
  }

  async quote(symbol: SymbolRef): Promise<QuoteData> {
    const loaded = await this.load(symbol);
    const { chart } = loaded;
    const shares = this.currentShares(symbol.ticker, loaded);
    return {
      price: chart.price,
      marketCap: shares * chart.price,
      shares,
      name: chart.name ?? symbol.ticker,
      fiftyTwoWeekHigh: chart.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: chart.fiftyTwoWeekLow,
    };
  }

  async annualFundamentals(symbol: SymbolRef, sinceYear: number): Promise<AnnualFundamentals[]> {
    const loaded = await this.load(symbol);
    const { annuals, chart } = loaded;
    const overridden = this.opts.shareOverrides?.[symbol.ticker.toUpperCase()] != null;
    const kept = annuals.filter((a) => a.fiscalYear >= sinceYear);
    const shareSeries = overridden
      ? kept.map(() => null)
      : cleanShareSeries(
          kept.map((a) => (a.sharesDated ? sharesToday(a.sharesDated, chart.splits) : null)),
          this.currentSharesOrNull(symbol.ticker, loaded),
        );
    return kept
      .map(({ sharesDated: _sd, ...a }, i) => {
        const close = closeNearest(chart.points, a.fiscalYearEnd!);
        const shares = shareSeries[i] ?? null;
        const marketCap = close != null && shares != null ? close * shares : null;
        const netDebt =
          a.totalDebt == null && a.cash == null ? null : (a.totalDebt ?? 0) - (a.cash ?? 0);
        return {
          ...a,
          // restated to today's share basis, like the split-adjusted prices
          shares,
          marketCap,
          enterpriseValue: marketCap != null && netDebt != null ? marketCap + netDebt : null,
        };
      });
  }

  async ttmFundamentals(symbol: SymbolRef): Promise<TtmFundamentals> {
    const loaded = await this.load(symbol);
    const { sharesDated: _sd, ...rest } = loaded.ttm;
    return { ...rest, shares: this.currentShares(symbol.ticker, loaded) };
  }

  async ownership(_symbol: SymbolRef): Promise<OwnershipStats> {
    return {
      insiderOwnership: null,
      insiderOwnershipChange: null,
      institutionalOwnership: null,
      shortInterest: null,
      momentum: null, // the engine derives momentum from price history
    };
  }

  async weeklyPrices(symbol: SymbolRef, years: number): Promise<PricePoint[]> {
    const { chart } = await this.load(symbol);
    const cutoff = new Date(Date.now() - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
    return chart.points.filter((p) => p.date >= cutoff);
  }

  async dataNotes(symbol: SymbolRef): Promise<string[]> {
    return [...(await this.load(symbol)).notes];
  }
}
