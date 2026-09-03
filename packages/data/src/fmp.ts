/**
 * Financial Modeling Prep adapter.
 *
 * Provider choice (verified 2026-07, see DECISIONS.md): FMP's Starter tier
 * is the cheapest plan covering every field the model needs for US
 * equities with 30+ years of annual history -- income/balance/cash-flow
 * statements (incl. SBC and capex), enterprise values, key metrics (ROIC),
 * historical market cap and EOD price history. EODHD needs its dearer
 * fundamentals tier, Alpha Vantage lacks EV/ROIC endpoints, Polygon's
 * fundamentals carry no EV/ROIC either.
 *
 * `baseUrl` should point at the apps/api proxy (which holds the API key and
 * caches closed fiscal years); pointing it straight at FMP with an apikey
 * is supported for development only.
 */
import type { Maybe, OwnershipStats, PricePoint } from '@dvh/engine';
import type {
  AnnualFundamentals,
  DataProvider,
  QuoteData,
  SymbolRef,
  TtmFundamentals,
} from './provider';

export interface FmpClientOptions {
  /** e.g. "https://dvh-proxy.example.workers.dev/fmp" */
  baseUrl: string;
  /** Dev only; production traffic goes through the proxy key. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

type Json = Record<string, unknown>;

const num = (v: unknown): Maybe => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export class FmpProvider implements DataProvider {
  readonly id = 'fmp';
  constructor(private readonly opts: FmpClientOptions) {}

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(this.opts.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (this.opts.apiKey) url.searchParams.set('apikey', this.opts.apiKey);
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(url.toString());
    if (!res.ok) throw new Error(`FMP ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /**
   * FMP's free tier returns HTTP 402 when `limit` exceeds its 5-year
   * history cap. Retry once at the cap so the app degrades to five years
   * of history instead of failing (full 2007+ history needs Starter).
   */
  private async getWithLimitFallback<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    try {
      return await this.get<T>(path, params);
    } catch (e) {
      const capped = Number(params.limit) > 5;
      if (capped && e instanceof Error && e.message.includes('HTTP 402')) {
        return this.get<T>(path, { ...params, limit: '5' });
      }
      throw e;
    }
  }

  async search(query: string): Promise<SymbolRef[]> {
    const rows = await this.get<Json[]>('/stable/search-symbol', {
      query,
      exchange: 'NASDAQ,NYSE,AMEX',
    });
    return rows.map((r) => ({
      ticker: String(r.symbol),
      exchange: String(r.exchange ?? 'US'),
      reportingCurrency: String(r.currency ?? 'USD'),
    }));
  }

  async quote(symbol: SymbolRef): Promise<QuoteData> {
    const [q] = await this.get<Json[]>('/stable/quote', { symbol: symbol.ticker });
    if (!q) throw new Error(`no quote for ${symbol.ticker}`);
    const price = num(q.price) ?? 0;
    const marketCap = num(q.marketCap) ?? 0;
    return {
      price,
      marketCap,
      // /stable/quote carries no share count; derive it from the two
      // fields that do move together (O53 = P53 / I6 by construction).
      shares: num(q.sharesOutstanding) ?? (price > 0 ? marketCap / price : 0),
      name: String(q.name ?? symbol.ticker),
      fiftyTwoWeekHigh: num(q.yearHigh),
      fiftyTwoWeekLow: num(q.yearLow),
    };
  }

  async annualFundamentals(symbol: SymbolRef, sinceYear: number): Promise<AnnualFundamentals[]> {
    const limit = String(new Date().getFullYear() - sinceYear + 2);
    const params = { symbol: symbol.ticker, period: 'annual', limit };
    const [income, cashflow, balance, ev, metrics] = await Promise.all([
      this.getWithLimitFallback<Json[]>('/stable/income-statement', params),
      this.getWithLimitFallback<Json[]>('/stable/cash-flow-statement', params),
      this.getWithLimitFallback<Json[]>('/stable/balance-sheet-statement', params),
      this.getWithLimitFallback<Json[]>('/stable/enterprise-values', params),
      this.getWithLimitFallback<Json[]>('/stable/key-metrics', params),
    ]);

    const byYear = new Map<number, Partial<AnnualFundamentals>>();
    const yearOf = (r: Json): number | null => {
      // fiscalYear arrives as a string; enterprise-values rows carry only
      // a period-end date, so fall back to its year.
      const fy = Number(r.fiscalYear ?? r.calendarYear);
      if (Number.isFinite(fy)) return fy;
      const d = new Date(String(r.date ?? ''));
      return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
    };
    const merge = (rows: Json[], map: (r: Json) => Partial<AnnualFundamentals>) => {
      for (const r of rows) {
        const y = yearOf(r);
        if (y == null || y < sinceYear) continue;
        byYear.set(y, { ...byYear.get(y), ...map(r) });
      }
    };

    merge(income, (r) => ({
      revenue: num(r.revenue),
      operatingIncome: num(r.operatingIncome),
      grossProfit: num(r.grossProfit),
      netIncome: num(r.netIncome),
      fiscalYearEnd: typeof r.date === 'string' ? r.date : undefined,
    }));
    merge(cashflow, (r) => ({
      operatingCashFlow: num(r.operatingCashFlow ?? r.netCashProvidedByOperatingActivities),
      // FMP reports capitalExpenditure as a negative cash outflow, which is
      // exactly the sheet's stored convention -- passed through unchanged.
      capex: num(r.capitalExpenditure),
      sbc: num(r.stockBasedCompensation),
      depreciationAmortization: num(r.depreciationAndAmortization),
    }));
    merge(balance, (r) => ({
      totalDebt: num(r.totalDebt),
      // DVH's net debt = total debt - cash & EQUIVALENTS (not incl. short
      // term investments): verified against fixture M48..M53, where FMP's
      // own netDebt field reproduces the sheet exactly.
      cash: num(r.cashAndCashEquivalents),
      tangibleBook:
        num(r.totalStockholdersEquity) == null
          ? null
          : (num(r.totalStockholdersEquity) ?? 0) -
            (num(r.goodwillAndIntangibleAssets) ?? 0),
    }));
    merge(ev, (r) => ({
      marketCap: num(r.marketCapitalization),
      enterpriseValue: num(r.enterpriseValue),
      shares: num(r.numberOfShares),
    }));
    merge(metrics, (r) => ({
      roic: num(r.returnOnInvestedCapital ?? r.roic),
    }));

    return [...byYear.entries()]
      .sort(([a], [b]) => a - b)
      .map(([fiscalYear, f]) => ({
        fiscalYear,
        fiscalYearEnd: f.fiscalYearEnd,
        revenue: f.revenue ?? null,
        operatingIncome: f.operatingIncome ?? null,
        operatingCashFlow: f.operatingCashFlow ?? null,
        capex: f.capex ?? null,
        sbc: f.sbc ?? null,
        depreciationAmortization: f.depreciationAmortization ?? null,
        grossProfit: f.grossProfit ?? null,
        netIncome: f.netIncome ?? null,
        totalDebt: f.totalDebt ?? null,
        cash: f.cash ?? null,
        tangibleBook: f.tangibleBook ?? null,
        shares: f.shares ?? null,
        marketCap: f.marketCap ?? null,
        enterpriseValue: f.enterpriseValue ?? null,
        roic: f.roic ?? null,
      }));
  }

  async ttmFundamentals(symbol: SymbolRef): Promise<TtmFundamentals> {
    // TTM statements: sum of the last four quarters. Eight quarters are
    // requested so the PRIOR trailing window is available too (true
    // TTM Y/Y); free-tier keys fall back to five and the engine then
    // uses the sheet's proxy formula instead.
    const params = { symbol: symbol.ticker, period: 'quarter', limit: '4' };
    const [income, cashflow, balance, metricsTtm] = await Promise.all([
      this.getWithLimitFallback<Json[]>('/stable/income-statement', { ...params, limit: '8' }),
      this.get<Json[]>('/stable/cash-flow-statement', params),
      this.get<Json[]>('/stable/balance-sheet-statement', { ...params, limit: '1' }),
      this.get<Json[]>('/stable/key-metrics-ttm', { symbol: symbol.ticker }),
    ]);
    const sum = (rows: Json[], key: string): Maybe => {
      if (rows.length < 4) return null;
      let acc = 0;
      for (const r of rows.slice(0, 4)) {
        const v = num(r[key]);
        if (v == null) return null;
        acc += v;
      }
      return acc;
    };
    // quarters 5..8 back = the prior trailing-twelve-month window
    const priorWindow = income.slice(4, 8);
    const priorTtmRevenue = priorWindow.length === 4 ? sum(priorWindow, 'revenue') : null;
    const b = balance[0] ?? {};
    const m = metricsTtm[0] ?? {};
    const equity = num((b as Json).totalStockholdersEquity);
    const cashEq = num((b as Json).cashAndCashEquivalents);
    return {
      asOf: String((income[0] as Json | undefined)?.date ?? new Date().toISOString().slice(0, 10)),
      priorTtmRevenue,
      revenue: sum(income, 'revenue'),
      operatingIncome: sum(income, 'operatingIncome'),
      grossProfit: sum(income, 'grossProfit'),
      netIncome: sum(income, 'netIncome'),
      operatingCashFlow: sum(cashflow, 'operatingCashFlow'),
      capex: sum(cashflow, 'capitalExpenditure'),
      sbc: sum(cashflow, 'stockBasedCompensation'),
      depreciationAmortization: sum(cashflow, 'depreciationAndAmortization'),
      totalDebt: num((b as Json).totalDebt),
      cash: cashEq,
      tangibleBook:
        equity == null ? null : equity - (num((b as Json).goodwillAndIntangibleAssets) ?? 0),
      shares: null, // TTM shares come from the live quote (sheet O53)
      marketCap: null, // ditto (sheet P53)
      enterpriseValue: null, // derived: P53 + M53
      roic: num((m as Json).returnOnInvestedCapitalTTM ?? (m as Json).roicTTM),
    };
  }

  async ownership(_symbol: SymbolRef): Promise<OwnershipStats> {
    // Sourced from the provider, NOT scraped from Finviz. FMP's Starter
    // plan does not expose Finviz-style insider/institutional/short-float
    // ratios, so these surface as null -> the UI renders "unavailable"
    // rather than inventing values. Momentum is computed by the engine
    // from weekly closes, replicating the sheet's price-history formula.
    return {
      insiderOwnership: null,
      insiderOwnershipChange: null,
      institutionalOwnership: null,
      shortInterest: null,
      momentum: null,
    };
  }

  async weeklyPrices(symbol: SymbolRef, years: number): Promise<PricePoint[]> {
    const to = new Date();
    const from = new Date(to.getTime() - years * 365 * 24 * 3600 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const rows = await this.get<Json[]>('/stable/historical-price-eod/full', {
      symbol: symbol.ticker,
      from: iso(from),
      to: iso(to),
    });
    // Reduce daily closes to weekly (last close of each ISO week).
    const byWeek = new Map<string, PricePoint>();
    for (const r of rows) {
      const date = String(r.date);
      const close = num(r.close ?? r.adjClose);
      if (close == null) continue;
      const d = new Date(date);
      const week = `${d.getUTCFullYear()}-${Math.floor(dayOfYear(d) / 7)}`;
      const existing = byWeek.get(week);
      if (!existing || existing.date < date) byWeek.set(week, { date, close });
    }
    return [...byWeek.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}

function dayOfYear(d: Date): number {
  return Math.floor(
    (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / (24 * 3600 * 1000),
  );
}
