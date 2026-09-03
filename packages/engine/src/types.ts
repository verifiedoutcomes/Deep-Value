/**
 * Core data model for the Deep Value Hunter valuation engine.
 *
 * The engine is a faithful re-implementation of the DVH Google Sheets
 * template. Cell references in comments point at the `META` sheet of
 * `Latest_Deep_Value_Hunter_Model.xlsx`, which is the executable
 * specification for every formula here.
 *
 * All monetary values are in the presentation currency (USD): the data
 * layer multiplies every fetched fundamental by the FX factor (column B,
 * = 1 for USD reporters) BEFORE rows reach the engine, exactly as the
 * sheet does inside each fetch formula.
 */

/** A value that Excel's IFERROR(...,"") would blank out. */
export type Maybe = number | null;

export type YearLabel = number | 'TTM';

/**
 * One row of the historical fundamentals table (sheet rows 34..53).
 * Rows are ordered: FY2007..FY(latest-1), FY-latest, TTM.
 * Sign convention: `capex` arrives NEGATIVE from the data layer (I34:I53).
 */
export interface HistoricalRowInput {
  yearLabel: YearLabel;
  /** FX factor already applied upstream; recorded for audit. Column B. */
  fx: number;
  revenue: Maybe; // D
  operatingIncome: Maybe; // F
  operatingCashFlow: Maybe; // H
  /** NEGATIVE as stored (sheet convention). */
  capex: Maybe; // I
  sbc: Maybe; // J
  /** Total debt minus cash. */
  netDebt: Maybe; // M
  shares: Maybe; // O
  marketCap: Maybe; // P
  /**
   * Enterprise value from the provider for historical rows (Q34:Q52).
   * Omitted/undefined for the TTM row, where Q53 = P53 + M53 is derived.
   */
  enterpriseValue?: Maybe; // Q
  /**
   * Depreciation & amortization (positive), used ONLY by the 'owner'
   * capex treatment as the maintenance-capex proxy. Not in the sheet;
   * absent from the fixture; supplied by live providers.
   */
  depreciationAmortization?: Maybe;
  /**
   * TTM row only: revenue of the PRIOR trailing-twelve-month window
   * (quarters 5..8 back). When present, TTM Y/Y = revenue/priorTtm − 1 —
   * a true non-overlapping year-over-year. When absent, the sheet's
   * E53 = D53/D51 − 1 (TTM over the second-latest FY) applies.
   */
  priorTtmRevenue?: Maybe;
  tangibleBook: Maybe; // T
  grossProfit: Maybe; // V
  netIncome: Maybe; // X
}

/** Derived per-year columns (E,G,K,L,N,R,S,W,Y,Z,AA,AB). */
export interface DerivedRow {
  revenueYoY: Maybe; // E = D / prior D - 1 (TTM row compares vs prior full FY)
  operatingMargin: Maybe; // G = F / D
  adjFcf: Maybe; // K = H - I - J  (capex negative => OCF + |capex| - SBC)
  adjFcfMargin: Maybe; // L = K / D
  netDebtToEbit: Maybe; // N = M / F
  enterpriseValue: Maybe; // Q (input for FY rows, P+M for TTM)
  adjFcfYield: Maybe; // R = K / P
  evToEbit: Maybe; // S = Q / F
  grossMargin: Maybe; // W = V / D
  netMargin: Maybe; // Y = X / D
  /** Waterfall: positive gap between op income and net income (Z34 logic). */
  opIncMinusNetInc: Maybe; // Z
  /** Waterfall: gross profit minus max(op income, net income) (AA34 logic). */
  grossProfitMinusOpInc: Maybe; // AA
  revenueMinusGrossProfit: Maybe; // AB = D - V
}

/** Summary statistics row (sheet row 54). */
export interface SummaryStats {
  revenueCagr8: Maybe; // D54
  revenueYoyAvg4: Maybe; // E54
  operatingIncomeCagr8: Maybe; // F54
  operatingMarginAvg4: Maybe; // G54
  ocfCagr8: Maybe; // H54
  capexCagr8: Maybe; // I54
  sbcCagr8: Maybe; // J54
  adjFcfCagr8: Maybe; // K54
  adjFcfMarginAvg4: Maybe; // L54
  netDebtCagr10: Maybe; // M54
  netDebtEbitAvg13: Maybe; // N54
  sharesCagr10: Maybe; // O54
  marketCapCagr10: Maybe; // P54
  evCagr10: Maybe; // Q54
  adjFcfYieldTrimmean: Maybe; // R54, TRIMMEAN 40% over rows 41:53
  evEbitTrimmean: Maybe; // S54
  tangibleBookCagr10: Maybe; // T54
}

/** Live quote data (GOOGLEFINANCE equivalents). */
export interface Quote {
  price: number; // I6
  marketCap: number; // D9 (live; distinct from snapshot P53)
}

/** Company summary card (header metrics). */
export interface HeaderMetrics {
  priceToday: number; // I6
  marketCapLive: number; // D9
  peLiveCap: Maybe; // E10 = D9 / X53
  peSnapshotCap: Maybe; // Q120 = P53 / X53
  evOverOperatingIncome: Maybe; // E11 = Q53 / F53
  adjFcfYield: Maybe; // E12 = K53 / P53
  netDebtOverOpIncome: Maybe; // E13 = N53
  operatingMargin: Maybe; // E14 = G53
  roic: Maybe; // E15, straight from the data provider
  priceToTangibleBook: Maybe; // Q121 = P53 / T53
  priceToAdjOcf: Maybe; // Q122 = P53 / (H53 - J53)
  priceToAdjFcf: Maybe; // Q123 = P53 / K53
  /** Q124; 'Neg Book' when tangible book is negative. */
  adjRoic: Maybe | 'Neg Book';
}

/** One forecast year of user-editable assumptions. */
export interface ScenarioYearInput {
  revenueYoY: number; // E column of forecast block
  operatingMargin: number; // G column
  adjFcfMargin: number; // H column
}

export type ScenarioKind = 'bear' | 'base' | 'bull';
export type HorizonYears = 3 | 5;

/** User-editable valuation inputs for one scenario/horizon block. */
export interface ScenarioInputs {
  years: ScenarioYearInput[]; // length 5 or 3
  /** Exit EV/EBIT multiple (N61/N69/N77; 3y = 5y minus offset by default). */
  exitMultiple: number;
  /**
   * Rate used to discount forecast FCF (the J column). NOTE: in the sheet
   * every block -- including all 3-year blocks -- discounts FCF at the
   * 5-year base-case rate cell N66 (N74 and N82 both point at N66, and the
   * 3-year J columns reference N$66/N$74/N$82). Replicated exactly.
   */
  fcfDiscountRate: number;
  /** Rate used to discount the terminal market cap (N66 for 5y, N91 for 3y). */
  terminalDiscountRate: number;
  /**
   * Periods the terminal market cap is discounted. The SHEET always uses 5
   * (its 3-year block N92 has nper = 5 — a quirk); the corrected mode uses
   * the horizon length. Callers choose via analyzeCompany options.
   */
  terminalNper: number;
  /** "Adjustment" entered in millions (N64), added to terminal market cap. */
  adjustmentMillions: number;
}

export interface ForecastYear {
  year: number; // calendar year (C column)
  revenue: number; // D
  revenueYoY: number; // E
  operatingIncome: number; // F
  operatingMargin: number; // G
  adjFcfMargin: number; // H
  adjFcf: number; // I
  pvOfAdjFcf: number; // J
}

/**
 * IRR result state. The sheet distinguishes:
 *  - 'no-forecast': all margin cells zero, 5-year blocks only (countif=10)
 *  - 'num-error':   IRR has no root (#NUM!), propagates to fair value
 */
export type ValuationStatus = 'ok' | 'no-forecast' | 'num-error';

export interface ScenarioValuation {
  status: ValuationStatus;
  forecast: ForecastYear[];
  exitMultiple: number; // N61
  terminalEv: number; // N62 = final-year op income x exit multiple
  netDebt: number; // N63 = M53
  terminalMarketCap: number; // N65 = N62 - N63 + adjustment*1e6
  /** N67 = sum(PV of FCF) + PV(rate, 5, 0, -terminal cap). null on error. */
  intrinsicValue: Maybe;
  irr: Maybe; // Q61; null unless status === 'ok'
  fairValuePerShare: Maybe; // Q63 = (N67 / P53) * price
  priceDelta: Maybe; // T6 = fair value / price - 1
  /** Q66 / Q91: horizon price change implied by the IRR. NOTE: this is
   *  algebraically identical to (1+IRR)^horizon − 1 — it carries no
   *  information beyond the IRR and is kept for sheet parity. */
  horizonPriceChange: Maybe;
  /**
   * Multiple on invested capital over the horizon: (Σ FCF + terminal
   * market cap) ÷ snapshot market cap, undiscounted. Unlike the price
   * change above, this is independent of the IRR (it ignores timing),
   * so it's the informative companion metric.
   */
  horizonMoic: number;
}

export interface IrrStripCell {
  price: number;
  irr: Maybe; // null renders as a dash
}

export interface MarginOfSafetyRow {
  threshold: number; // R10:T10, user editable
  targetBuyPrice: Maybe; // R11 = base fair value * (1 - threshold)
}

export interface VerdictCard {
  bearFairValue: Maybe; // F21
  baseFairValue: Maybe; // G21
  bullFairValue: Maybe; // H21
  price: number; // F22:H22
}

/** Weekly close for the price chart / momentum. */
export interface PricePoint {
  date: string; // ISO date
  close: number;
}

export interface OwnershipStats {
  insiderOwnership: Maybe; // T119
  insiderOwnershipChange: Maybe; // T120
  institutionalOwnership: Maybe; // T121
  shortInterest: string | null; // T122, e.g. "1.24%" as scraped
  momentum: Maybe; // T124
}

/** The full per-ticker snapshot the engine consumes (one persisted pull). */
export interface CompanySnapshot {
  ticker: string;
  name: string;
  exchange: string;
  reportingCurrency: string;
  snapshotDate: string; // ISO date (D8)
  quote: Quote;
  /** O53: frozen at load time in Static mode. */
  snapshotShares: number;
  /** P53: frozen at load time; the anchor for all valuation math. */
  snapshotMarketCap: number;
  /** E15, provider-supplied. */
  roic: Maybe;
  ownership: OwnershipStats;
  rows: HistoricalRowInput[];
  priceHistory: PricePoint[];
}
