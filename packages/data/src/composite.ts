/**
 * EDGAR-first composite provider: the license-clean data backbone.
 *
 * Statements come from SEC EDGAR XBRL company facts (public domain — no
 * display license needed); only prices and quotes come from a market
 * provider. The fields EDGAR cannot supply are DERIVED the way the DVH
 * model itself defines them:
 *
 *   per-year market cap  = shares outstanding × close nearest fiscal
 *                          year end (fiscalYearEnd handles non-December
 *                          fiscal years, e.g. MSFT's June);
 *   enterprise value     = market cap + (total debt − cash) = P + M;
 *   ROIC (E15)           = left null -> the UI shows a dash and the
 *                          engine's Adj ROIC (Q124, computed from
 *                          statements) covers the need. We deliberately
 *                          do NOT invent a ROIC definition that might
 *                          disagree with the primary vendor's.
 *
 * Swapping the app to this backbone is a provider change only — the
 * engine and UI are untouched.
 */
import type { Maybe, OwnershipStats, PricePoint } from '@dvh/engine';
import type {
  AnnualFundamentals,
  DataProvider,
  QuoteData,
  SymbolRef,
  TtmFundamentals,
} from './provider';

const DAY = 24 * 3600 * 1000;

/** Close nearest to a target date (within `windowDays`), else null. */
export function closeNearest(
  history: PricePoint[],
  targetIso: string,
  windowDays = 21,
): Maybe {
  const target = new Date(targetIso).getTime();
  let best: { diff: number; close: number } | null = null;
  for (const p of history) {
    const diff = Math.abs(new Date(p.date).getTime() - target);
    if (!best || diff < best.diff) best = { diff, close: p.close };
  }
  return best && best.diff <= windowDays * DAY ? best.close : null;
}

export class EdgarFirstProvider implements DataProvider {
  readonly id = 'edgar-first';

  constructor(
    /** Fundamentals source (SEC EDGAR). */
    private readonly fundamentals: DataProvider,
    /** Prices/quotes/search source (the licensed market feed). */
    private readonly market: DataProvider,
  ) {}

  async annualFundamentals(symbol: SymbolRef, sinceYear: number): Promise<AnnualFundamentals[]> {
    const [annuals, history] = await Promise.all([
      this.fundamentals.annualFundamentals(symbol, sinceYear),
      this.market.weeklyPrices(symbol, new Date().getFullYear() - sinceYear + 1),
    ]);
    return annuals.map((a) => {
      if (a.marketCap != null && a.enterpriseValue != null) return a;
      const fyEnd = a.fiscalYearEnd ?? `${a.fiscalYear}-12-31`;
      const close = closeNearest(history, fyEnd);
      const marketCap =
        a.marketCap ?? (close != null && a.shares != null ? close * a.shares : null);
      const netDebt =
        a.totalDebt == null && a.cash == null ? null : (a.totalDebt ?? 0) - (a.cash ?? 0);
      const enterpriseValue =
        a.enterpriseValue ??
        (marketCap != null && netDebt != null ? marketCap + netDebt : null);
      return { ...a, marketCap, enterpriseValue };
    });
  }

  async ttmFundamentals(symbol: SymbolRef): Promise<TtmFundamentals> {
    // TTM market cap/EV come from the live quote via the snapshot
    // assembler (sheet O53/P53/Q53 semantics), so no enrichment needed.
    return this.fundamentals.ttmFundamentals(symbol);
  }

  quote(symbol: SymbolRef): Promise<QuoteData> {
    return this.market.quote(symbol);
  }

  weeklyPrices(symbol: SymbolRef, years: number): Promise<PricePoint[]> {
    return this.market.weeklyPrices(symbol, years);
  }

  search(query: string): Promise<SymbolRef[]> {
    return this.market.search(query);
  }

  ownership(symbol: SymbolRef): Promise<OwnershipStats> {
    return this.market.ownership(symbol);
  }
}
