/** Memoised engine run for the selected ticker's active snapshot. */
import { useMemo } from 'react';
import { analyzeCompany, type CompanyAnalysis, type CompanySnapshot } from '@dvh/engine';
import { activeSnapshot, useAppStore, type TickerState } from './store';

export interface TickerAnalysis {
  ticker: string;
  state: TickerState | undefined;
  snapshot: CompanySnapshot | null;
  analysis: CompanyAnalysis | null;
}

export function useTickerAnalysis(tickerOverride?: string): TickerAnalysis {
  const selected = useAppStore((s) => s.selectedTicker);
  const ticker = tickerOverride ?? selected;
  const state = useAppStore((s) => s.tickers[ticker]);
  const capexTreatment = useAppStore((s) => s.capexTreatment);
  const snapshot = activeSnapshot(state);
  const analysis = useMemo(
    () =>
      snapshot ? analyzeCompany(snapshot, state?.overrides ?? {}, capexTreatment) : null,
    [snapshot, state?.overrides, capexTreatment],
  );
  return { ticker, state, snapshot, analysis };
}
