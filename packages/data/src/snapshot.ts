/**
 * Assemble an engine CompanySnapshot from provider data, replicating the
 * sheet's Load semantics:
 *  - one row per fiscal year 2007..latest full year, then an FY-latest row,
 *    then a TTM row (rows 34..53);
 *  - every fundamental multiplied by the FX factor for its fiscal year;
 *  - net debt = total debt - cash (M column);
 *  - TTM shares/market cap frozen from the live quote (O53/P53);
 *  - capex kept NEGATIVE as delivered (sheet sign convention).
 */
import type { CompanySnapshot, HistoricalRowInput, Maybe } from '@dvh/engine';
import type { AnnualFundamentals, DataProvider, SymbolRef, TtmFundamentals } from './provider';
import type { FxTable } from './fx';

export const FIRST_MODEL_YEAR = 2007;

function mul(v: Maybe, fx: number): Maybe {
  return v == null ? null : v * fx;
}

function toRow(
  yearLabel: number | 'TTM',
  f: AnnualFundamentals | TtmFundamentals,
  fx: number,
): HistoricalRowInput {
  const netDebt =
    f.totalDebt == null && f.cash == null ? null : (f.totalDebt ?? 0) * fx - (f.cash ?? 0) * fx;
  return {
    yearLabel,
    fx,
    revenue: mul(f.revenue, fx),
    operatingIncome: mul(f.operatingIncome, fx),
    operatingCashFlow: mul(f.operatingCashFlow, fx),
    capex: mul(f.capex, fx), // negative in, negative out
    sbc: mul(f.sbc, fx),
    netDebt,
    shares: f.shares, // share counts are currency-free
    marketCap: f.marketCap, // provider reports these in USD already
    enterpriseValue: f.enterpriseValue,
    tangibleBook: mul(f.tangibleBook, fx),
    grossProfit: mul(f.grossProfit, fx),
    netIncome: mul(f.netIncome, fx),
  };
}

/** Zero-filled row for years before a company's data begins (sheet shows 0s). */
function emptyRow(year: number, fx: number): HistoricalRowInput {
  return {
    yearLabel: year,
    fx,
    revenue: 0,
    operatingIncome: 0,
    operatingCashFlow: 0,
    capex: 0,
    sbc: 0,
    netDebt: 0,
    shares: 0,
    marketCap: 0,
    enterpriseValue: 0,
    tangibleBook: 0,
    grossProfit: 0,
    netIncome: 0,
  };
}

export async function loadCompanySnapshot(
  provider: DataProvider,
  symbol: SymbolRef,
  fxTable: FxTable,
  now: () => Date = () => new Date(),
): Promise<CompanySnapshot> {
  const [quote, annuals, ttm, ownership, priceHistory] = await Promise.all([
    provider.quote(symbol),
    provider.annualFundamentals(symbol, FIRST_MODEL_YEAR),
    provider.ttmFundamentals(symbol),
    provider.ownership(symbol),
    provider.weeklyPrices(symbol, 7),
  ]);

  const latestFullYear = annuals.length
    ? Math.max(...annuals.map((a) => a.fiscalYear))
    : now().getFullYear() - 1;

  const rows: HistoricalRowInput[] = [];
  for (let y = FIRST_MODEL_YEAR; y <= latestFullYear; y++) {
    const a = annuals.find((r) => r.fiscalYear === y);
    // Years before the company's data begins are zero-filled (as the sheet
    // renders them) and need no FX factor.
    rows.push(a ? toRow(y, a, fxTable.factor(symbol.reportingCurrency, y)) : emptyRow(y, 1));
  }
  // The TTM row follows the FY rows, frozen to the live quote for
  // shares/market cap (sheet O53/P53 freeze to load-time values).
  const ttmFx = fxTable.factor(symbol.reportingCurrency, 'TTM');
  const ttmRow = toRow('TTM', ttm, ttmFx);
  ttmRow.shares = quote.shares;
  ttmRow.marketCap = quote.marketCap;
  delete ttmRow.enterpriseValue; // Q53 = P53 + M53, derived by the engine
  // enables a true non-overlapping TTM Y/Y when 8 quarters were available
  ttmRow.priorTtmRevenue = ttm.priorTtmRevenue == null ? null : ttm.priorTtmRevenue * ttmFx;
  rows.push(ttmRow);

  // E15: DVH's ROIC is the latest ANNUAL key-metrics value (verified: the
  // fixture's 0.1795 equals FMP's FY2025 returnOnInvestedCapital, not the
  // TTM figure), falling back to the prior fiscal year, then TTM.
  const latestAnnual = annuals.find((r) => r.fiscalYear === latestFullYear);
  const priorAnnual = annuals.find((r) => r.fiscalYear === latestFullYear - 1);
  const roic = latestAnnual?.roic ?? priorAnnual?.roic ?? ttm.roic ?? null;

  return {
    ticker: symbol.ticker,
    name: quote.name,
    exchange: symbol.exchange,
    reportingCurrency: symbol.reportingCurrency,
    snapshotDate: now().toISOString().slice(0, 10),
    quote: { price: quote.price, marketCap: quote.marketCap },
    snapshotShares: quote.shares,
    snapshotMarketCap: quote.marketCap,
    roic,
    ownership,
    rows,
    priceHistory,
  };
}
