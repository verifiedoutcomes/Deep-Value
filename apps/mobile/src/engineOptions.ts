/**
 * The app's engine mode — used EVERYWHERE an analysis is computed
 * (screens, watchlist rows, saved analyses). The engine itself defaults
 * to exact sheet parity so the META validation gate stays meaningful;
 * the app opts into the corrected/soundest behaviour here.
 */
import type { AnalyzeOptions } from '@dvh/engine';

export const APP_ANALYZE_OPTIONS: AnalyzeOptions = {
  correct3yTerminal: true, // 3y terminal discounts 3 periods, not 5
  seedBearBullFromBase: true, // Bear/Bull start live, adjusted from Base
  correctedSummaryStats: true, // CAGRs anchor to latest FY; no TTM double-count
  seedExitFromTrimmedMean: true, // exit multiple = trimmed-mean EV/EBIT
  seedMarginsFromTtm: true, // both seeded margins from the TTM row
  symmetric3yOffsets: true, // 3y exit = 5y − 2 for every scenario
};
