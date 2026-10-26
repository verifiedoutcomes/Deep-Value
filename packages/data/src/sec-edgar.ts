/**
 * SEC EDGAR XBRL company-facts fallback (free, US filers only).
 *
 * Degrades gracefully when the paid provider is down or rate-limited:
 * covers the fundamentals that appear in filings; per-year market cap,
 * enterprise value, ROIC and ownership are NOT in company facts and
 * surface as null (the engine and UI tolerate that).
 *
 * EDGAR asks for a descriptive User-Agent; requests are proxied through
 * apps/api which sets one.
 */
import type { Maybe, OwnershipStats, PricePoint } from '@dvh/engine';
import type {
  AnnualFundamentals,
  DataProvider,
  QuoteData,
  SymbolRef,
  TtmFundamentals,
} from './provider';

interface FactUnit {
  end: string;
  start?: string;
  val: number;
  fy: number;
  fp: string; // 'FY' | 'Q1'...
  form: string;
  frame?: string;
}

interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: { 'us-gaap'?: Record<string, { units: Record<string, FactUnit[]> }> };
}

/** us-gaap tags per model field, first match wins. */
const TAGS: Record<string, string[]> = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
  operatingIncome: ['OperatingIncomeLoss'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
  ],
  sbc: ['ShareBasedCompensation'],
  depreciationAmortization: [
    'DepreciationDepletionAndAmortization',
    'DepreciationAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
  ],
  grossProfit: ['GrossProfit'],
  netIncome: ['NetIncomeLoss'],
  cash: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'CashAndCashEquivalentsAtCarryingValue'],
  longTermDebt: ['LongTermDebt', 'LongTermDebtNoncurrent'],
  shortTermDebt: ['LongTermDebtCurrent', 'DebtCurrent'],
  equity: ['StockholdersEquity'],
  goodwill: ['Goodwill'],
  intangibles: ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet'],
  shares: ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'],
};

export class SecEdgarProvider implements DataProvider {
  readonly id = 'sec-edgar';
  constructor(
    private readonly baseUrl: string, // proxy path, e.g. ".../edgar"
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async facts(symbol: SymbolRef): Promise<CompanyFacts> {
    const res = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, '')}/companyfacts/${symbol.ticker.toUpperCase()}`,
    );
    if (!res.ok) throw new Error(`EDGAR companyfacts ${symbol.ticker}: HTTP ${res.status}`);
    return (await res.json()) as CompanyFacts;
  }

  private static annualFact(
    facts: CompanyFacts,
    tags: string[],
    fiscalYear: number,
    flow: boolean,
  ): { val: number; end: string } | null {
    const gaap = facts.facts['us-gaap'];
    if (!gaap) return null;
    for (const tag of tags) {
      const units = gaap[tag]?.units;
      if (!units) continue;
      const series = units.USD ?? units.shares ?? Object.values(units)[0];
      if (!series) continue;
      const candidates = series.filter(
        (u) =>
          u.form === '10-K' &&
          u.fp === 'FY' &&
          new Date(u.end).getFullYear() === fiscalYear &&
          (!flow || (u.start != null && monthsBetween(u.start, u.end) > 9)),
      );
      const hit = candidates[candidates.length - 1];
      if (hit) return { val: hit.val, end: hit.end };
    }
    return null;
  }

  async annualFundamentals(symbol: SymbolRef, sinceYear: number): Promise<AnnualFundamentals[]> {
    const facts = await this.facts(symbol);
    const out: AnnualFundamentals[] = [];
    // include this calendar year: a fiscal year ending mid-year (MSFT:
    // June) already has its 10-K; years without one are skipped below
    const thisYear = new Date().getFullYear();
    for (let y = sinceYear; y <= thisYear; y++) {
      const fact = (key: string, flow = true) =>
        SecEdgarProvider.annualFact(facts, TAGS[key] ?? [], y, flow);
      const v = (key: string, flow = true): Maybe => fact(key, flow)?.val ?? null;
      const revenueFact = fact('revenue');
      const revenue = revenueFact?.val ?? null;
      const netIncomeFact = fact('netIncome');
      const netIncome = netIncomeFact?.val ?? null;
      if (revenue == null && netIncome == null) continue;
      const capexOutflow = v('capex');
      const ltd = v('longTermDebt', false);
      const std = v('shortTermDebt', false);
      const equity = v('equity', false);
      out.push({
        fiscalYear: y,
        fiscalYearEnd: revenueFact?.end ?? netIncomeFact?.end,
        revenue,
        operatingIncome: v('operatingIncome'),
        operatingCashFlow: v('operatingCashFlow'),
        // XBRL reports capex as a positive outflow; the model stores it
        // NEGATIVE (sheet convention), so negate here at the boundary.
        capex: capexOutflow == null ? null : -capexOutflow,
        sbc: v('sbc'),
        depreciationAmortization: v('depreciationAmortization'),
        grossProfit: v('grossProfit'),
        netIncome,
        totalDebt: ltd == null && std == null ? null : (ltd ?? 0) + (std ?? 0),
        cash: v('cash', false),
        tangibleBook:
          equity == null ? null : equity - (v('goodwill', false) ?? 0) - (v('intangibles', false) ?? 0),
        shares: v('shares', false),
        marketCap: null, // not in company facts
        enterpriseValue: null, // not in company facts
        roic: null, // not in company facts
      });
    }
    return out;
  }

  /**
   * True trailing twelve months from 10-Q filings: for every flow item,
   * TTM = latest fiscal year + this year's year-to-date − the same
   * year-to-date a year earlier (10-Qs report cumulative YTD figures, and
   * carry the prior-year comparative). Balance-sheet items take the
   * latest reported instant. Falls back to the latest fiscal year when no
   * 10-Q has been filed since it (or the comparative is missing).
   */
  async ttmFundamentals(symbol: SymbolRef): Promise<TtmFundamentals> {
    const facts = await this.facts(symbol);
    const annuals = await this.annualFundamentals(symbol, new Date().getFullYear() - 2);
    const latest = annuals[annuals.length - 1];
    if (!latest) throw new Error(`EDGAR: no recent annual data for ${symbol.ticker}`);
    const prior = annuals.find((a) => a.fiscalYear === latest.fiscalYear - 1);
    const { fiscalYear: fy, ...base } = latest;
    const fyEnd = latest.fiscalYearEnd ?? `${fy}-12-31`;

    // the YTD window: starts the day after the fiscal year ended
    const window = SecEdgarProvider.latestYtdWindow(facts, TAGS.revenue!, fyEnd);
    if (!window) {
      return { ...base, asOf: fyEnd, priorTtmRevenue: prior?.revenue ?? null };
    }
    const flow = (key: string, fyValue: Maybe): Maybe => {
      if (fyValue == null) return null;
      const cur = SecEdgarProvider.durationFact(facts, TAGS[key] ?? [], window.start, window.end);
      const ago = SecEdgarProvider.durationFact(
        facts,
        TAGS[key] ?? [],
        shiftYears(window.start, -1),
        shiftYears(window.end, -1),
      );
      return cur == null || ago == null ? null : fyValue + cur - ago;
    };
    const instant = (key: string, fallback: Maybe): Maybe =>
      SecEdgarProvider.latestInstant(facts, TAGS[key] ?? [], fyEnd) ?? fallback;

    const revenue = flow('revenue', latest.revenue);
    // Any flow item missing its YTD pair would mix windows: if revenue
    // itself can't be rolled forward, keep the whole fiscal year instead.
    if (revenue == null) {
      return { ...base, asOf: fyEnd, priorTtmRevenue: prior?.revenue ?? null };
    }
    const capexFy = latest.capex == null ? null : -latest.capex; // positive outflow
    const capex = flow('capex', capexFy);
    const ltd = instant('longTermDebt', null);
    const std = instant('shortTermDebt', null);
    const equity = instant('equity', null);
    // prior TTM window = prior FY + YTD a year ago − YTD two years ago
    const ytdAgo = SecEdgarProvider.durationFact(
      facts, TAGS.revenue!, shiftYears(window.start, -1), shiftYears(window.end, -1),
    );
    const ytd2Ago = SecEdgarProvider.durationFact(
      facts, TAGS.revenue!, shiftYears(window.start, -2), shiftYears(window.end, -2),
    );
    const priorTtmRevenue =
      prior?.revenue != null && ytdAgo != null && ytd2Ago != null
        ? prior.revenue + ytdAgo - ytd2Ago
        : null;

    return {
      ...base,
      asOf: window.end,
      revenue,
      operatingIncome: flow('operatingIncome', latest.operatingIncome),
      operatingCashFlow: flow('operatingCashFlow', latest.operatingCashFlow),
      capex: capex == null ? null : -capex,
      sbc: flow('sbc', latest.sbc),
      depreciationAmortization: flow('depreciationAmortization', latest.depreciationAmortization ?? null),
      grossProfit: flow('grossProfit', latest.grossProfit),
      netIncome: flow('netIncome', latest.netIncome),
      totalDebt:
        ltd == null && std == null ? latest.totalDebt : (ltd ?? 0) + (std ?? 0),
      cash: instant('cash', latest.cash),
      tangibleBook:
        equity == null
          ? latest.tangibleBook
          : equity - (instant('goodwill', 0) ?? 0) - (instant('intangibles', 0) ?? 0),
      shares: instant('shares', latest.shares),
      priorTtmRevenue,
    };
  }

  /** The latest 10-Q year-to-date window that begins right after fyEnd. */
  private static latestYtdWindow(
    facts: CompanyFacts,
    tags: string[],
    fyEnd: string,
  ): { start: string; end: string } | null {
    // scan every tag: filers switch revenue tags over the years
    const series = tags.flatMap((t) => SecEdgarProvider.series(facts, [t]));
    const fyEndMs = new Date(fyEnd).getTime();
    let best: { start: string; end: string } | null = null;
    for (const u of series) {
      if (u.start == null || u.form !== '10-Q') continue;
      const startGap = (new Date(u.start).getTime() - fyEndMs) / DAY;
      if (startGap < 0 || startGap > 20) continue; // must start the new year
      if (!best || u.end > best.end) best = { start: u.start, end: u.end };
    }
    return best;
  }

  /** A duration fact matching [start, end] within a few days, else null. */
  private static durationFact(
    facts: CompanyFacts,
    tags: string[],
    start: string,
    end: string,
  ): Maybe {
    const near = (a: string, b: string) =>
      Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= 10 * DAY;
    for (const tag of tags) {
      const series = SecEdgarProvider.series(facts, [tag]);
      const hits = series.filter((u) => u.start != null && near(u.start, start) && near(u.end, end));
      if (hits.length) return hits[hits.length - 1]!.val;
    }
    return null;
  }

  /** The most recent point-in-time value reported on or after `since`. */
  private static latestInstant(facts: CompanyFacts, tags: string[], since: string): Maybe {
    for (const tag of tags) {
      const series = SecEdgarProvider.series(facts, [tag]).filter(
        (u) => u.start == null && u.end >= since,
      );
      if (series.length) {
        return series.reduce((a, b) => (b.end >= a.end ? b : a)).val;
      }
    }
    return null;
  }

  private static series(facts: CompanyFacts, tags: string[]): FactUnit[] {
    const gaap = facts.facts['us-gaap'];
    if (!gaap) return [];
    for (const tag of tags) {
      const units = gaap[tag]?.units;
      if (!units) continue;
      const s = units.USD ?? units.shares ?? Object.values(units)[0];
      if (s?.length) return s;
    }
    return [];
  }

  async quote(_symbol: SymbolRef): Promise<QuoteData> {
    throw new Error('SEC EDGAR provides fundamentals only; quotes need the market provider');
  }

  async search(_query: string): Promise<SymbolRef[]> {
    throw new Error('SEC EDGAR fallback does not implement search');
  }

  async ownership(_symbol: SymbolRef): Promise<OwnershipStats> {
    return {
      insiderOwnership: null,
      insiderOwnershipChange: null,
      institutionalOwnership: null,
      shortInterest: null,
      momentum: null,
    };
  }

  async weeklyPrices(_symbol: SymbolRef, _years: number): Promise<PricePoint[]> {
    throw new Error('SEC EDGAR provides fundamentals only; prices need the market provider');
  }
}

const DAY = 24 * 3600 * 1000;

function shiftYears(iso: string, years: number): string {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function monthsBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (30 * 24 * 3600 * 1000);
}
