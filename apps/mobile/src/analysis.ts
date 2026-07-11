/**
 * Memoised engine run for the selected ticker — or, in review mode, for a
 * frozen SavedAnalysis, which reproduces the original Company and
 * Valuation outputs exactly (pure engine + frozen inputs).
 */
import { useMemo } from 'react';
import {
  analyzeCompany,
  type CompanyAnalysis,
  type CompanySnapshot,
  type ScenarioOverrides,
} from '@dvh/engine';
import type { CapexTreatment, HorizonYears, ScenarioKind } from '@dvh/engine';
import { activeSnapshot, useAppStore, type SavedAnalysis, type TickerState } from './store';

export interface TickerAnalysis {
  ticker: string;
  state: TickerState | undefined;
  snapshot: CompanySnapshot | null;
  analysis: CompanyAnalysis | null;
  overrides: ScenarioOverrides;
  capexTreatment: CapexTreatment;
  horizon: HorizonYears;
  scenarioTab: ScenarioKind;
  /** Set when rendering a frozen saved analysis (read-only). */
  reviewing: SavedAnalysis | null;
}

export function useTickerAnalysis(tickerOverride?: string): TickerAnalysis {
  const selected = useAppStore((s) => s.selectedTicker);
  const reviewingId = useAppStore((s) => s.reviewingId);
  const saved = useAppStore((s) => s.savedAnalyses);
  const reviewing = reviewingId ? saved.find((a) => a.id === reviewingId) ?? null : null;

  const ticker = reviewing?.ticker ?? tickerOverride ?? selected;
  const state = useAppStore((s) => s.tickers[ticker]);
  const liveCapex = useAppStore((s) => s.capexTreatment);

  const snapshot = reviewing ? reviewing.snapshot : activeSnapshot(state);
  const overrides = reviewing ? reviewing.overrides : state?.overrides ?? {};
  const capexTreatment = reviewing ? reviewing.capexTreatment : liveCapex;
  const horizon = reviewing ? reviewing.horizon : state?.horizon ?? 5;
  const scenarioTab = reviewing ? reviewing.scenarioTab : state?.scenarioTab ?? 'base';

  const analysis = useMemo(
    () => (snapshot ? analyzeCompany(snapshot, overrides, capexTreatment) : null),
    [snapshot, overrides, capexTreatment],
  );
  return {
    ticker,
    state,
    snapshot,
    analysis,
    overrides,
    capexTreatment,
    horizon,
    scenarioTab,
    reviewing,
  };
}
