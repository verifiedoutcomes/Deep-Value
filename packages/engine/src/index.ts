/**
 * @dvh/engine -- pure TypeScript valuation engine for Deep Value Hunter.
 * Zero React and zero network dependencies by design: this package is
 * validated in isolation against the META spreadsheet fixture.
 */
export * from './types';
export * from './math';
export * from './historical';
export * from './header';
export * from './scenario';

import type {
  CompanySnapshot,
  DerivedRow,
  HeaderMetrics,
  HorizonYears,
  IrrStripCell,
  MarginOfSafetyRow,
  ScenarioInputs,
  ScenarioKind,
  ScenarioValuation,
  SummaryStats,
  VerdictCard,
} from './types';
import type { CapexTreatment } from './historical';
import { computeDerivedRows, computeSummaryStats } from './historical';
import { computeHeaderMetrics } from './header';
import {
  anchorsFromRows,
  computeIrrStrip,
  computeMarginOfSafety,
  computeScenarioValuation,
  computeVerdict,
  derive3yExitMultiple,
  seedBaseScenario,
  seedEmptyScenario,
  type ValuationAnchors,
} from './scenario';

export const DEFAULT_DISCOUNT_RATE = 0.1; // N66 / N91
export const DEFAULT_MOS_THRESHOLDS = [0.15, 0.2, 0.3]; // R10:T10

/**
 * Behaviour switches. Defaults replicate the SHEET exactly (the META gate
 * depends on that); the app opts into the corrected/ergonomic behaviour.
 */
export interface AnalyzeOptions {
  /**
   * true: the 3-year terminal cap is discounted 3 periods (correct);
   * false (default): 5 periods, replicating the sheet's N92 nper quirk.
   */
  correct3yTerminal?: boolean;
  /**
   * true: unedited Bear/Bull seed from the Base case (same growth/margins
   * and exit multiple), so users adjust from a live starting point;
   * false (default): sheet behaviour — zeros, rendering "No Forecast".
   */
  seedBearBullFromBase?: boolean;
}

/** Per-ticker user-editable state persisted by the app. */
export interface ScenarioOverrides {
  years?: Partial<Record<ScenarioKind, Partial<Record<HorizonYears, ScenarioInputs['years']>>>>;
  exitMultiple5?: Partial<Record<ScenarioKind, number>>;
  exitMultiple3?: Partial<Record<ScenarioKind, number>>; // manual override of the derived default
  discountRate5?: number; // N66
  discountRate3?: number; // N91 (terminal only; see ScenarioInputs.fcfDiscountRate)
  adjustmentMillions?: Partial<Record<ScenarioKind, Partial<Record<HorizonYears, number>>>>;
  mosThresholds?: number[];
}

export interface CompanyAnalysis {
  derived: DerivedRow[];
  summary: SummaryStats;
  header: HeaderMetrics;
  anchors: ValuationAnchors;
  scenarios: Record<ScenarioKind, Record<HorizonYears, ScenarioValuation>>;
  irrStrip: IrrStripCell[];
  marginOfSafety: MarginOfSafetyRow[];
  verdict: VerdictCard;
}

/** Build the fully-defaulted ScenarioInputs for one block. */
export function buildScenarioInputs(
  derived: DerivedRow[],
  kind: ScenarioKind,
  horizon: HorizonYears,
  overrides: ScenarioOverrides = {},
  seededExitMultiple5: number,
  options: AnalyzeOptions = {},
): ScenarioInputs {
  const seedFromBase = kind === 'base' || options.seedBearBullFromBase === true;
  const rate5 = overrides.discountRate5 ?? DEFAULT_DISCOUNT_RATE;
  const rate3 = overrides.discountRate3 ?? DEFAULT_DISCOUNT_RATE;
  const exit5 = overrides.exitMultiple5?.[kind] ?? (seedFromBase ? seededExitMultiple5 : 0);
  const exitMultiple =
    horizon === 5 ? exit5 : overrides.exitMultiple3?.[kind] ?? derive3yExitMultiple(kind, exit5);
  const years =
    overrides.years?.[kind]?.[horizon] ??
    (seedFromBase ? seedBaseScenario(derived, horizon) : seedEmptyScenario(horizon));
  return {
    years,
    exitMultiple,
    // Every block's FCF PV discounts at the 5-year rate (sheet references
    // N$66/N$74/N$82 everywhere); only the terminal PV of the 3-year
    // blocks uses the 3-year rate cell N91.
    fcfDiscountRate: rate5,
    terminalDiscountRate: horizon === 5 ? rate5 : rate3,
    terminalNper: horizon === 5 ? 5 : options.correct3yTerminal ? 3 : 5,
    adjustmentMillions: overrides.adjustmentMillions?.[kind]?.[horizon] ?? 0,
  };
}

/** One-call analysis of a company snapshot with optional user overrides. */
export function analyzeCompany(
  snapshot: CompanySnapshot,
  overrides: ScenarioOverrides = {},
  treatment: CapexTreatment = 'sheet',
  options: AnalyzeOptions = {},
): CompanyAnalysis {
  const derived = computeDerivedRows(snapshot.rows, treatment);
  const summary = computeSummaryStats(snapshot.rows, derived);
  const header = computeHeaderMetrics(snapshot, treatment);
  const anchors = anchorsFromRows(
    snapshot.rows,
    snapshot.snapshotMarketCap,
    snapshot.quote.price,
  );
  const seededExit5 = derived[derived.length - 1]?.evToEbit ?? 0; // N61 = S53

  const kinds: ScenarioKind[] = ['bear', 'base', 'bull'];
  const horizons: HorizonYears[] = [5, 3];
  const scenarios = {} as Record<ScenarioKind, Record<HorizonYears, ScenarioValuation>>;
  for (const kind of kinds) {
    scenarios[kind] = {} as Record<HorizonYears, ScenarioValuation>;
    for (const horizon of horizons) {
      const inputs = buildScenarioInputs(derived, kind, horizon, overrides, seededExit5, options);
      scenarios[kind][horizon] = computeScenarioValuation(anchors, inputs);
    }
  }

  const base5 = scenarios.base[5];
  return {
    derived,
    summary,
    header,
    anchors,
    scenarios,
    irrStrip: computeIrrStrip(anchors, base5),
    marginOfSafety: computeMarginOfSafety(
      base5.status === 'ok' ? base5.fairValuePerShare : null,
      overrides.mosThresholds ?? DEFAULT_MOS_THRESHOLDS,
    ),
    verdict: computeVerdict(anchors.price, scenarios.bear[5], base5, scenarios.bull[5]),
  };
}

/** The fourteen qualitative checklist questions (C111:C124), Yes/No each. */
export const CHECKLIST_QUESTIONS: readonly string[] = [
  'Can I understand the company?',
  'Is revenue growing? Did you sanity check your revenue growth assumptions?',
  'Can I predict the earnings/cash flow?',
  'Are current earnings/FCF normal, not inflated by temporary tailwinds?',
  "Are the company's earnings independent of commodity prices?",
  'Is the debt reasonable / is balance sheet healthy?',
  'Do the maturities on the debt seem manageable?',
  'Does the company put its shareholders first?',
  'Does this company have a wide moat? Does this company have any moat?',
  'Has management been good allocators of capital?',
  'Is the business safe from low cost overseas competition?',
  'Is this company Amazon/Google-proof?',
  'Can you handle the ugly bear case?',
  'Do you think the company is more likely to meet your base case than not?',
];
