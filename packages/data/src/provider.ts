/**
 * Provider abstraction for market + fundamentals data. Google Finance has
 * no public API, so concrete adapters (FMP primary, SEC EDGAR fallback)
 * implement this one interface. All calls are routed through the apps/api
 * proxy in production so keys never ship in the app binary.
 */
import type { Maybe, OwnershipStats, PricePoint } from '@dvh/engine';

/**
 * Symbol model, designed for international expansion from day one: every
 * fundamental fetched for a symbol is multiplied by the FX factor for
 * {reportingCurrency, fiscalYear} (1 for USD) before entering the engine.
 */
export interface SymbolRef {
  ticker: string;
  exchange: string;
  reportingCurrency: string;
}

export interface QuoteData {
  price: number;
  marketCap: number;
  shares: number;
  name: string;
  fiftyTwoWeekHigh: Maybe;
  fiftyTwoWeekLow: Maybe;
}

/** Raw annual fundamentals for one fiscal year, in REPORTING currency. */
export interface AnnualFundamentals {
  fiscalYear: number;
  /**
   * Period-end date (ISO), when the provider reports it. Non-December
   * fiscal years (MSFT: June) need this for price-based enrichment.
   */
  fiscalYearEnd?: string;
  revenue: Maybe;
  operatingIncome: Maybe;
  operatingCashFlow: Maybe;
  /** NEGATIVE (cash outflow), matching the sheet convention I34:I53. */
  capex: Maybe;
  sbc: Maybe;
  grossProfit: Maybe;
  netIncome: Maybe;
  totalDebt: Maybe;
  cash: Maybe;
  tangibleBook: Maybe;
  shares: Maybe;
  /** Fiscal-year market cap and EV, already in USD from the provider. */
  marketCap: Maybe;
  enterpriseValue: Maybe;
  roic: Maybe;
}

export interface TtmFundamentals extends Omit<AnnualFundamentals, 'fiscalYear'> {
  asOf: string; // ISO date
}

export interface DataProvider {
  readonly id: string;
  search(query: string): Promise<SymbolRef[]>;
  quote(symbol: SymbolRef): Promise<QuoteData>;
  /** Annual fundamentals back to `sinceYear` (2007) where available. */
  annualFundamentals(symbol: SymbolRef, sinceYear: number): Promise<AnnualFundamentals[]>;
  ttmFundamentals(symbol: SymbolRef): Promise<TtmFundamentals>;
  /**
   * Ownership/sentiment strip. Fields a provider cannot supply MUST be
   * null (rendered "unavailable"), never invented.
   */
  ownership(symbol: SymbolRef): Promise<OwnershipStats>;
  /** Weekly closes for the trailing `years` years. */
  weeklyPrices(symbol: SymbolRef, years: number): Promise<PricePoint[]>;
}
