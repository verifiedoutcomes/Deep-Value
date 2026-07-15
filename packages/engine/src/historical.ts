/**
 * Historical fundamentals table: derived per-year columns (E,G,K,L,N,R,S,
 * W,Y,Z,AA,AB of sheet rows 34..53) and the summary statistics row (54).
 */
import type { DerivedRow, HistoricalRowInput, Maybe, SummaryStats } from './types';
import { average, cagr, safeDiv, safeSub, trimmeanExcel } from './math';

/**
 * Adjusted FCF, K = H - I - J (I34:I53 store capex as a NEGATIVE number, so
 * this is OCF + |capex| - SBC). This is the sheet's convention and the
 * default; DO NOT silently "fix" the sign. The conventional treatment
 * (OCF - |capex| - SBC) is available behind an explicit setting.
 */
export type CapexTreatment = 'sheet' | 'conventional';

export function adjFcf(
  ocf: Maybe,
  capex: Maybe,
  sbc: Maybe,
  treatment: CapexTreatment = 'sheet',
): Maybe {
  if (treatment === 'conventional') {
    if (ocf == null || capex == null || sbc == null) return null;
    return ocf - Math.abs(capex) - sbc;
  }
  return safeSub(ocf, capex, sbc);
}

/** Q: provider EV for FY rows; P + M for the TTM row (Q53 = P53 + M53). */
export function rowEnterpriseValue(row: HistoricalRowInput): Maybe {
  if (row.yearLabel === 'TTM') {
    if (row.marketCap == null || row.netDebt == null) return null;
    return row.marketCap + row.netDebt;
  }
  return row.enterpriseValue ?? null;
}

/**
 * Compute derived columns for every row. The TTM row's YoY (E53) divides by
 * the FY row TWO positions back (E53 = D53/D51 - 1): TTM overlaps the latest
 * full FY, so growth is measured against the prior completed year, exactly
 * as the sheet does.
 */
export function computeDerivedRows(
  rows: HistoricalRowInput[],
  treatment: CapexTreatment = 'sheet',
): DerivedRow[] {
  const n = rows.length;
  return rows.map((row, i) => {
    const isTTM = row.yearLabel === 'TTM' && i === n - 1;
    const prev = isTTM ? rows[n - 3] : rows[i - 1];
    const ev = rowEnterpriseValue(row);
    const k = adjFcf(row.operatingCashFlow, row.capex, row.sbc, treatment);
    const { revenue: d, operatingIncome: f } = row;

    // Z34: =iferror(if(X<0, if(F<0,0,F), if(F>X, F-X, 0)),"")
    let z: Maybe = null;
    const x = row.netIncome;
    if (x != null && f != null) {
      z = x < 0 ? (f < 0 ? 0 : f) : f > x ? f - x : 0;
    }
    // AA34: =iferror(if(and(X<0,F<0), V, V-max(F,X)),"")
    let aa: Maybe = null;
    const v = row.grossProfit;
    if (x != null && f != null && v != null) {
      aa = x < 0 && f < 0 ? v : v - Math.max(f, x);
    }

    // True TTM Y/Y when the prior trailing window is known; otherwise the
    // sheet's proxy (divide by the FY two rows back, E53 = D53/D51 - 1).
    const yoYBase =
      isTTM && row.priorTtmRevenue != null && row.priorTtmRevenue !== 0
        ? row.priorTtmRevenue
        : prev?.revenue;

    return {
      revenueYoY:
        yoYBase == null || d == null || yoYBase === 0 ? null : d / yoYBase - 1,
      operatingMargin: safeDiv(f, d),
      adjFcf: k,
      adjFcfMargin: safeDiv(k, d),
      netDebtToEbit: safeDiv(row.netDebt, f),
      enterpriseValue: ev,
      adjFcfYield: safeDiv(k, row.marketCap),
      evToEbit: safeDiv(ev, f),
      grossMargin: safeDiv(v, d),
      netMargin: safeDiv(x, d),
      opIncMinusNetInc: z,
      grossProfitMinusOpInc: aa,
      revenueMinusGrossProfit: safeSub(d, v),
    };
  });
}

/**
 * Summary statistics (row 54). Index anchors, with n = rows.length (20 in
 * the standard layout: FY2007..FY2024, FY-latest, TTM):
 *  - 8-year CAGRs: latest completed FY (n-3, sheet row 51) over 8 years
 *    prior (n-11, row 43): D54 = (D51/D43)^(1/8)-1.
 *  - 4-row averages: last four table rows (n-4..n-1, rows 50:53).
 *  - 10-year CAGRs: (row 51 / row 41) = (n-3 / n-13).
 *  - TRIMMEAN 40% and Net Debt/EBIT average: rows 41:53 = (n-13..n-1).
 */
export function computeSummaryStats(
  rows: HistoricalRowInput[],
  derived: DerivedRow[],
): SummaryStats {
  const n = rows.length;
  const at = <T>(arr: T[], i: number): T | undefined =>
    i >= 0 && i < arr.length ? arr[i] : undefined;

  const cagr8 = (get: (r: HistoricalRowInput) => Maybe): Maybe => {
    const end = at(rows, n - 3);
    const start = at(rows, n - 11);
    return end && start ? cagr(get(end), get(start), 8) : null;
  };
  const cagr10 = (get: (r: HistoricalRowInput) => Maybe): Maybe => {
    const end = at(rows, n - 3);
    const start = at(rows, n - 13);
    return end && start ? cagr(get(end), get(start), 10) : null;
  };
  const last4 = (get: (d: DerivedRow) => Maybe): Maybe =>
    average(derived.slice(Math.max(0, n - 4)).map(get));
  const window13 = <T>(arr: T[]): T[] => arr.slice(Math.max(0, n - 13));

  return {
    revenueCagr8: cagr8((r) => r.revenue),
    revenueYoyAvg4: last4((d) => d.revenueYoY),
    operatingIncomeCagr8: cagr8((r) => r.operatingIncome),
    operatingMarginAvg4: last4((d) => d.operatingMargin),
    ocfCagr8: cagr8((r) => r.operatingCashFlow),
    capexCagr8: cagr8((r) => r.capex),
    sbcCagr8: cagr8((r) => r.sbc),
    adjFcfCagr8: (() => {
      const end = at(derived, n - 3);
      const start = at(derived, n - 11);
      return end && start ? cagr(end.adjFcf, start.adjFcf, 8) : null;
    })(),
    adjFcfMarginAvg4: last4((d) => d.adjFcfMargin),
    netDebtCagr10: cagr10((r) => r.netDebt),
    netDebtEbitAvg13: average(window13(derived).map((d) => d.netDebtToEbit)),
    sharesCagr10: cagr10((r) => r.shares),
    marketCapCagr10: cagr10((r) => r.marketCap),
    evCagr10: (() => {
      const end = at(derived, n - 3);
      const start = at(derived, n - 13);
      return end && start ? cagr(end.enterpriseValue, start.enterpriseValue, 10) : null;
    })(),
    adjFcfYieldTrimmean: trimmeanExcel(
      window13(derived).map((d) => d.adjFcfYield),
      0.4,
    ),
    evEbitTrimmean: trimmeanExcel(
      window13(derived).map((d) => d.evToEbit),
      0.4,
    ),
    tangibleBookCagr10: cagr10((r) => r.tangibleBook),
  };
}

/**
 * Sparkline series (row 55): per-metric small bar charts over the last 11
 * table rows (sheet rows 43:53), final bar highlighted in the UI.
 */
export function sparklineWindow<T>(series: T[]): T[] {
  return series.slice(Math.max(0, series.length - 11));
}
