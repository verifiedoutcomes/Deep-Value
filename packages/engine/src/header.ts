/** Company summary card metrics (header block + "Other Metrics" panel). */
import type {
  CompanySnapshot,
  DerivedRow,
  HeaderMetrics,
  HistoricalRowInput,
  Maybe,
} from './types';
import { safeDiv } from './math';
import type { CapexTreatment } from './historical';
import { adjFcf } from './historical';

export function computeHeaderMetrics(
  snapshot: CompanySnapshot,
  treatment: CapexTreatment = 'sheet',
): HeaderMetrics {
  const ttm = snapshot.rows[snapshot.rows.length - 1];
  if (!ttm || ttm.yearLabel !== 'TTM') {
    throw new Error('snapshot rows must end with a TTM row');
  }
  const P = snapshot.snapshotMarketCap; // P53
  const M = ttm.netDebt; // M53
  const F = ttm.operatingIncome; // F53
  const X = ttm.netIncome; // X53
  const T = ttm.tangibleBook; // T53
  const K = adjFcf(
    ttm.operatingCashFlow,
    ttm.capex,
    ttm.sbc,
    treatment,
    ttm.depreciationAmortization ?? null,
  ); // K53
  const Q = M == null ? null : P + M; // Q53 = P53 + M53

  const pTangBook = safeDiv(P, T); // Q121
  // Q124: =iferror(if(Q121<0,"Neg Book",(F53/(T53+if(M53<0,0,M53)))),"")
  let adjRoic: Maybe | 'Neg Book' = null;
  if (pTangBook != null && pTangBook < 0) {
    adjRoic = 'Neg Book';
  } else if (F != null && T != null && M != null) {
    adjRoic = safeDiv(F, T + (M < 0 ? 0 : M));
  }

  const hMinusJ =
    ttm.operatingCashFlow == null || ttm.sbc == null
      ? null
      : ttm.operatingCashFlow - ttm.sbc;

  return {
    priceToday: snapshot.quote.price,
    marketCapLive: snapshot.quote.marketCap,
    peLiveCap: safeDiv(snapshot.quote.marketCap, X), // E10 (live cap)
    peSnapshotCap: safeDiv(P, X), // Q120 (snapshot cap) -- both exist, differ
    evOverOperatingIncome: safeDiv(Q, F), // E11
    adjFcfYield: safeDiv(K, P), // E12
    netDebtOverOpIncome: safeDiv(M, F), // E13 = N53
    operatingMargin: safeDiv(F, ttm.revenue), // E14 = G53
    roic: snapshot.roic, // E15, provider-sourced
    priceToTangibleBook: pTangBook, // Q121
    priceToAdjOcf: safeDiv(P, hMinusJ), // Q122
    priceToAdjFcf: safeDiv(P, K), // Q123
    adjRoic, // Q124
  };
}

/** 52-week high/low from weekly price history (the sheet's K8/K10 header). */
export function fiftyTwoWeekRange(
  history: { date: string; close: number }[],
): { high: Maybe; low: Maybe } {
  if (history.length === 0) return { high: null, low: null };
  const last = history[history.length - 1]!;
  const cutoff = new Date(last.date).getTime() - 366 * 24 * 3600 * 1000;
  const window = history.filter((p) => new Date(p.date).getTime() >= cutoff);
  if (window.length === 0) return { high: null, low: null };
  return {
    high: Math.max(...window.map((p) => p.close)),
    low: Math.min(...window.map((p) => p.close)),
  };
}

/**
 * Momentum (T124): the 1-year price change measured up to one month ago,
 * i.e. (price 1 month ago - price 1 year ago) / price 1 year ago,
 * replicating the sheet's GOOGLEFINANCE formula.
 */
export function momentumFromHistory(
  history: { date: string; close: number }[],
  asOf: string,
): Maybe {
  if (history.length === 0) return null;
  const t = new Date(asOf).getTime();
  const closest = (target: number): number | null => {
    let best: { diff: number; close: number } | null = null;
    for (const p of history) {
      const diff = Math.abs(new Date(p.date).getTime() - target);
      if (!best || diff < best.diff) best = { diff, close: p.close };
    }
    // require a match within ~2 weeks of the target date
    return best && best.diff <= 14 * 24 * 3600 * 1000 ? best.close : null;
  };
  const oneMonthAgo = closest(t - 30 * 24 * 3600 * 1000);
  const oneYearAgo = closest(t - 365 * 24 * 3600 * 1000);
  if (oneMonthAgo == null || oneYearAgo == null || oneYearAgo === 0) return null;
  return (oneMonthAgo - oneYearAgo) / oneYearAgo;
}

export type { DerivedRow, HistoricalRowInput };
