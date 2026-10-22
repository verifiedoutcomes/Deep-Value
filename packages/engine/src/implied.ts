/**
 * Reverse DCF ("what is the price already paying for?") and the fair-value
 * sensitivity grid. Not in the sheet: both are read-only lenses over a
 * scenario's ScenarioInputs and never change a headline number.
 *
 * Fair value = (intrinsic value ÷ snapshot cap) × price, so fair value
 * equals the price exactly when intrinsic value equals the snapshot cap —
 * which is also when the scenario IRR equals the discount rate. The
 * implied figures below solve for that point, holding every other
 * assumption of the scenario fixed.
 */
import type { Maybe, ScenarioInputs } from './types';
import type { ValuationAnchors } from './scenario';
import { computeForecast } from './scenario';
import { pvExcel } from './math';

/** Intrinsic value (N67) without the IRR solve — the cheap inner loop. */
export function scenarioIntrinsicValue(anchors: ValuationAnchors, inputs: ScenarioInputs): number {
  const forecast = computeForecast(anchors, inputs.years, inputs.fcfDiscountRate);
  const last = forecast[forecast.length - 1]!;
  const terminalCap =
    last.operatingIncome * inputs.exitMultiple - anchors.netDebt + inputs.adjustmentMillions * 1e6;
  return (
    forecast.reduce((a, f) => a + f.pvOfAdjFcf, 0) +
    pvExcel(inputs.terminalDiscountRate, inputs.terminalNper, 0, -terminalCap)
  );
}

export interface ImpliedValue {
  /** The solved input, or null when no value in the search range works. */
  value: Maybe;
  /**
   * Set when value is null because the price sits outside what the range
   * can produce: 'below' = even the low end values the company above the
   * price; 'above' = even the high end values it below the price.
   */
  bound: 'below' | 'above' | null;
}

export interface ImpliedExpectations {
  /** Constant annual revenue growth over the horizon (replacing the path). */
  revenueGrowth: ImpliedValue;
  /** Compound annual growth of the scenario's own growth path. */
  scenarioGrowthCagr: number;
  /** Exit EV/EBIT holding the scenario's growth and margins. */
  exitMultiple: ImpliedValue;
  scenarioExitMultiple: number;
}

export const IMPLIED_GROWTH_RANGE: readonly [number, number] = [-0.5, 1.0];

export function impliedExpectations(
  anchors: ValuationAnchors,
  inputs: ScenarioInputs,
): ImpliedExpectations {
  const target = anchors.snapshotMarketCap;
  const n = inputs.years.length;
  const scenarioGrowthCagr =
    Math.pow(
      inputs.years.reduce((acc, y) => acc * (1 + y.revenueYoY), 1),
      1 / n,
    ) - 1;

  // --- exit multiple: intrinsic value is linear in it, so solve exactly.
  // IV = Σ PV(FCF) + (OI_n × m − net debt + adj) × D, D = 1/(1+r)^nper
  const forecast = computeForecast(anchors, inputs.years, inputs.fcfDiscountRate);
  const pvFcf = forecast.reduce((a, f) => a + f.pvOfAdjFcf, 0);
  const finalOpIncome = forecast[n - 1]!.operatingIncome;
  const d = pvExcel(inputs.terminalDiscountRate, inputs.terminalNper, 0, -1);
  let exitMultiple: ImpliedValue;
  if (!(finalOpIncome > 0) || !(d > 0)) {
    exitMultiple = { value: null, bound: null };
  } else {
    const m =
      ((target - pvFcf) / d + anchors.netDebt - inputs.adjustmentMillions * 1e6) / finalOpIncome;
    // a negative multiple means the forecast cash flows alone already
    // exceed the price: no positive terminal value is needed
    exitMultiple = m >= 0 ? { value: m, bound: null } : { value: null, bound: 'below' };
  }

  // --- constant growth: monotone increasing in g while the final-year
  // operating margin is positive (terminal EV grows with revenue)
  const withGrowth = (g: number): ScenarioInputs => ({
    ...inputs,
    years: inputs.years.map((y) => ({ ...y, revenueYoY: g })),
  });
  const gap = (g: number) => scenarioIntrinsicValue(anchors, withGrowth(g)) - target;
  let revenueGrowth: ImpliedValue;
  // (any root found by the sign-change search equates value and price,
  // even if early years carry negative FCF margins)
  const finalMargin = inputs.years[n - 1]!.operatingMargin;
  if (!(finalMargin > 0) || inputs.exitMultiple < 0) {
    revenueGrowth = { value: null, bound: null };
  } else {
    let [lo, hi] = IMPLIED_GROWTH_RANGE;
    const gLo = gap(lo);
    const gHi = gap(hi);
    if (gLo > 0) revenueGrowth = { value: null, bound: 'below' };
    else if (gHi < 0) revenueGrowth = { value: null, bound: 'above' };
    else {
      for (let i = 0; i < 200 && hi - lo > 1e-10; i++) {
        const mid = (lo + hi) / 2;
        if (gap(mid) < 0) lo = mid;
        else hi = mid;
      }
      revenueGrowth = { value: (lo + hi) / 2, bound: null };
    }
  }

  return {
    revenueGrowth,
    scenarioGrowthCagr,
    exitMultiple,
    scenarioExitMultiple: inputs.exitMultiple,
  };
}

export interface SensitivityGrid {
  /** Column headers: exit EV/EBIT multiples. */
  exitMultiples: number[];
  /** Row headers: the terminal discount rate of each row. */
  discountRates: number[];
  /** fairValue[row][col] per share; null where the multiple is ≤ 0. */
  fairValue: Maybe[][];
  /** Index of the scenario's own inputs (always the centre cell). */
  current: { row: number; col: number };
}

/**
 * Fair value per share across exit multiple × discount rate, 5 × 5,
 * centred on the scenario's own inputs. Rates shift the FCF and terminal
 * discount rates by the same step, so the centre cell reproduces the
 * scenario's fair value exactly even when the two rates differ.
 */
export function sensitivityGrid(
  anchors: ValuationAnchors,
  inputs: ScenarioInputs,
  multipleStep = 2,
  rateStep = 0.01,
): SensitivityGrid {
  const steps = [-2, -1, 0, 1, 2];
  const exitMultiples = steps.map((k) => inputs.exitMultiple + k * multipleStep);
  const rateShifts = steps.map((k) => k * rateStep);
  const discountRates = rateShifts.map((dr) => inputs.terminalDiscountRate + dr);
  const fairValue = rateShifts.map((dr) =>
    exitMultiples.map((m) => {
      const fcfRate = inputs.fcfDiscountRate + dr;
      const termRate = inputs.terminalDiscountRate + dr;
      if (m <= 0 || fcfRate <= -1 || termRate <= -1) return null;
      const iv = scenarioIntrinsicValue(anchors, {
        ...inputs,
        exitMultiple: m,
        fcfDiscountRate: fcfRate,
        terminalDiscountRate: termRate,
      });
      return (iv / anchors.snapshotMarketCap) * anchors.price;
    }),
  );
  return { exitMultiples, discountRates, fairValue, current: { row: 2, col: 2 } };
}
