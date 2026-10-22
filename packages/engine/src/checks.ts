/**
 * Assumption checks: flags for the inputs that most often make a
 * fair value meaningless. They change nothing; the app shows each flag
 * beside the result with an optional one-tap fix the user chooses.
 *
 * Calibrated on live data (Oct 2026): with heavy capex, the sheet's
 * convention (OCF + |capex| − SBC) seeded META's FCF margin at 87% against
 * a 33% operating margin; NVDA's seed held 65% growth for five years at a
 * 48× exit multiple; INTC's near-zero operating income made EV/EBIT
 * meaningless. Each flag below catches one of those.
 */
import type { HorizonYears, Maybe, ScenarioInputs, ScenarioKind } from './types';
import type { CapexTreatment } from './historical';
import type { CompanyAnalysis } from './index';

/** FCF margin above op margin by this factor (and 5 points) is flagged. */
export const FCF_OVER_OP_FACTOR = 1.25;
/** Any forecast year growing faster than this is flagged. */
export const HIGH_GROWTH = 0.25;
/** Exit EV/EBIT above this is flagged (long-run market ≈ 15–20×). */
export const RICH_EXIT_MULTIPLE = 30;
/** TTM EV/EBIT above this (or op income ≤ 0) means depressed earnings. */
export const DEPRESSED_EV_EBIT = 60;
/** The rate the growth fade lands on: roughly long-run nominal GDP. */
export const FADE_TO_GROWTH = 0.05;

export type AssumptionFlag =
  | {
      kind: 'fcf-above-op';
      fcfMargin: number;
      opMargin: number;
      treatment: CapexTreatment;
    }
  | {
      kind: 'high-growth';
      peakGrowth: number;
      /** Final-year revenue ÷ TTM revenue under the scenario's path. */
      revenueMultiple: number;
      years: number;
    }
  | {
      kind: 'rich-exit';
      exitMultiple: number;
      currentEvEbit: Maybe;
      trimmedMean: Maybe;
    }
  | {
      kind: 'depressed-earnings';
      currentEvEbit: Maybe;
      ttmOpMargin: Maybe;
      avg4OpMargin: Maybe;
    };

export function checkAssumptions(
  analysis: CompanyAnalysis,
  kind: ScenarioKind,
  horizon: HorizonYears,
  treatment: CapexTreatment,
): AssumptionFlag[] {
  const inputs: ScenarioInputs = analysis.scenarioInputs[kind][horizon];
  const flags: AssumptionFlag[] = [];
  const years = inputs.years;

  const fcfMargin = Math.max(...years.map((y) => y.adjFcfMargin));
  const opMargin = Math.max(...years.map((y) => y.operatingMargin));
  if (opMargin > 0 && fcfMargin > opMargin * FCF_OVER_OP_FACTOR && fcfMargin > opMargin + 0.05) {
    flags.push({ kind: 'fcf-above-op', fcfMargin, opMargin, treatment });
  }

  const peakGrowth = Math.max(...years.map((y) => y.revenueYoY));
  if (peakGrowth > HIGH_GROWTH) {
    flags.push({
      kind: 'high-growth',
      peakGrowth,
      revenueMultiple: years.reduce((acc, y) => acc * (1 + y.revenueYoY), 1),
      years: years.length,
    });
  }

  if (inputs.exitMultiple > RICH_EXIT_MULTIPLE) {
    flags.push({
      kind: 'rich-exit',
      exitMultiple: inputs.exitMultiple,
      currentEvEbit: analysis.header.evOverOperatingIncome,
      trimmedMean: analysis.summary.evEbitTrimmean,
    });
  }

  const ev = analysis.header.evOverOperatingIncome;
  const ttmOpMargin = analysis.header.operatingMargin;
  if ((ev != null && ev > DEPRESSED_EV_EBIT) || (ttmOpMargin != null && ttmOpMargin <= 0)) {
    flags.push({
      kind: 'depressed-earnings',
      currentEvEbit: ev,
      ttmOpMargin,
      avg4OpMargin: analysis.summary.operatingMarginAvg4,
    });
  }
  return flags;
}

/**
 * Growth path fading linearly from year 1's rate to FADE_TO_GROWTH in the
 * final year (margins kept). High growth rarely persists: in Chan,
 * Karceski & Lakonishok (2003), few firms sustain above-median growth
 * for five years, and past growth barely predicts future growth.
 */
export function fadeGrowth(
  years: ScenarioInputs['years'],
  target = FADE_TO_GROWTH,
): ScenarioInputs['years'] {
  const n = years.length;
  const g1 = years[0]!.revenueYoY;
  if (n < 2 || g1 <= target) return years.map((y) => ({ ...y }));
  return years.map((y, t) => ({ ...y, revenueYoY: g1 + ((target - g1) * t) / (n - 1) }));
}
