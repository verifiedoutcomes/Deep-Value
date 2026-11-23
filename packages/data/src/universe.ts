/**
 * The searchable universe: every S&P 500 and Nasdaq-100 constituent,
 * mapped to its SEC CIK (built by scripts/build_universe.py from the
 * current Wikipedia constituent tables and SEC's ticker map).
 */
import data from './universe.json';
import overrides from './share-overrides.json';
import type { ShareOverride } from './free';

export type UniverseStatus = 'ok' | 'foreign-filer' | 'no-annual-report';

export interface UniverseEntry {
  ticker: string;
  name: string;
  cik: number;
  indexes: ('SP500' | 'NDX')[];
  sector: string;
  exchange: string;
  status: UniverseStatus;
  predecessors?: number[];
}

export const UNIVERSE_AS_OF: string = data.asOf;
export const UNIVERSE: UniverseEntry[] = data.companies as UniverseEntry[];

const byTicker = new Map(UNIVERSE.map((e) => [e.ticker, e]));

/** Index tables print BRK.B; SEC and Yahoo use BRK-B. */
export const normalizeTicker = (raw: string) => raw.trim().toUpperCase().replace(/^\$+/, '').replace(/\./g, '-');

export function universeEntry(ticker: string): UniverseEntry | undefined {
  return byTicker.get(normalizeTicker(ticker));
}

/** Predecessor registrants whose filings carry a ticker's history. */
export const PREDECESSORS: Record<string, number[]> = Object.fromEntries(
  UNIVERSE.filter((e) => e.predecessors?.length).map((e) => [e.ticker, e.predecessors!]),
);

/** Share totals for structures SEC's standard data can't sum. */
export const SHARE_OVERRIDES: Record<string, ShareOverride> = overrides.companies;

/** Why a universe member can't be valued from SEC filings, or null. */
export function unsupportedReason(e: UniverseEntry): string | null {
  if (e.status === 'foreign-filer') {
    return `${e.name} files annual reports on Form 20-F/40-F as a foreign issuer (IFRS or non-USD statements), which the free SEC source doesn't cover yet.`;
  }
  if (e.status === 'no-annual-report') {
    return `${e.name} hasn't filed an annual report (10-K) yet, so there is no fiscal-year history to model.`;
  }
  return null;
}

/** Ticker-prefix matches first, then company-name matches. */
export function searchUniverse(query: string, limit = 8): UniverseEntry[] {
  const q = normalizeTicker(query);
  const words = query.trim().toLowerCase();
  if (!q) return [];
  const exact = byTicker.get(q);
  const prefix = UNIVERSE.filter((e) => e !== exact && e.ticker.startsWith(q));
  const named = UNIVERSE.filter(
    (e) => e !== exact && !e.ticker.startsWith(q) && e.name.toLowerCase().includes(words),
  );
  return [...(exact ? [exact] : []), ...prefix, ...named].slice(0, limit);
}
