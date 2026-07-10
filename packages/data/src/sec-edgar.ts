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

  private static annualValue(
    facts: CompanyFacts,
    tags: string[],
    fiscalYear: number,
    flow: boolean,
  ): Maybe {
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
          new Date(u.end).getFullYear() === fiscalYear + (flow ? 0 : 0) &&
          (!flow || (u.start != null && monthsBetween(u.start, u.end) > 9)),
      );
      const hit = candidates[candidates.length - 1];
      if (hit) return hit.val;
    }
    return null;
  }

  async annualFundamentals(symbol: SymbolRef, sinceYear: number): Promise<AnnualFundamentals[]> {
    const facts = await this.facts(symbol);
    const out: AnnualFundamentals[] = [];
    const thisYear = new Date().getFullYear();
    for (let y = sinceYear; y < thisYear; y++) {
      const v = (key: string, flow = true) =>
        SecEdgarProvider.annualValue(facts, TAGS[key] ?? [], y, flow);
      const revenue = v('revenue');
      const netIncome = v('netIncome');
      if (revenue == null && netIncome == null) continue;
      const capexOutflow = v('capex');
      const ltd = v('longTermDebt', false);
      const std = v('shortTermDebt', false);
      const equity = v('equity', false);
      out.push({
        fiscalYear: y,
        revenue,
        operatingIncome: v('operatingIncome'),
        operatingCashFlow: v('operatingCashFlow'),
        // XBRL reports capex as a positive outflow; the model stores it
        // NEGATIVE (sheet convention), so negate here at the boundary.
        capex: capexOutflow == null ? null : -capexOutflow,
        sbc: v('sbc'),
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

  async ttmFundamentals(symbol: SymbolRef): Promise<TtmFundamentals> {
    // Company facts quarterly windows are irregular across filers; the
    // fallback keeps it simple and reuses the latest full fiscal year.
    const annuals = await this.annualFundamentals(symbol, new Date().getFullYear() - 2);
    const latest = annuals[annuals.length - 1];
    if (!latest) throw new Error(`EDGAR: no recent annual data for ${symbol.ticker}`);
    const { fiscalYear: _fy, ...rest } = latest;
    return { ...rest, asOf: `${_fy}-12-31` };
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

function monthsBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (30 * 24 * 3600 * 1000);
}
