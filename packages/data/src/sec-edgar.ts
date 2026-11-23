/**
 * SEC EDGAR XBRL company-facts provider (free, US filers only).
 *
 * Degrades gracefully when the paid provider is down or rate-limited:
 * covers the fundamentals that appear in filings; per-year market cap,
 * enterprise value, ROIC and ownership are NOT in company facts and
 * surface as null (the engine and UI tolerate that).
 *
 * EDGAR asks for a descriptive User-Agent; requests are proxied through
 * apps/api which sets one.
 */
import type { OwnershipStats, PricePoint } from '@dvh/engine';
import { extractAnnuals, extractTtm, type SecCompanyFacts } from './sec-facts';
import type {
  AnnualFundamentals,
  DataProvider,
  QuoteData,
  SymbolRef,
  TtmFundamentals,
} from './provider';

/**
 * Statements only: extraction lives in sec-facts.ts (shared with the
 * free provider); this adapter fetches one ticker's companyfacts through
 * a proxy route and returns raw (as-filed) share counts.
 */
export class SecEdgarProvider implements DataProvider {
  readonly id = 'sec-edgar';
  constructor(
    private readonly baseUrl: string, // proxy path, e.g. ".../edgar"
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async facts(symbol: SymbolRef): Promise<SecCompanyFacts[]> {
    const res = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, '')}/companyfacts/${symbol.ticker.toUpperCase()}`,
    );
    if (!res.ok) throw new Error(`EDGAR companyfacts ${symbol.ticker}: HTTP ${res.status}`);
    return [(await res.json()) as SecCompanyFacts];
  }

  async annualFundamentals(symbol: SymbolRef, sinceYear: number): Promise<AnnualFundamentals[]> {
    const docs = await this.facts(symbol);
    return extractAnnuals(docs, sinceYear).map(({ sharesDated: _sd, ...a }) => a);
  }

  /** True TTM from 10-Q year-to-date figures (see extractTtm). */
  async ttmFundamentals(symbol: SymbolRef): Promise<TtmFundamentals> {
    const docs = await this.facts(symbol);
    const annuals = extractAnnuals(docs, new Date().getFullYear() - 3);
    if (!annuals.length) throw new Error(`EDGAR: no recent annual data for ${symbol.ticker}`);
    const { sharesDated: _sd, ...ttm } = extractTtm(docs, annuals);
    return ttm;
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
