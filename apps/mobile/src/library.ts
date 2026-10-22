/**
 * Snapshots that ship with the build. Always the sheet's META fixture;
 * plus whatever the hosting page preloads as `window.__DVH_PRELOAD__`
 * (the Claude preview build injects fresh snapshots at package time, so
 * the app is useful with the network blocked).
 *
 * Library snapshots live in the bundle, so the store never persists them:
 * `stripLibrary` removes them before a write and `withLibrary` puts the
 * same objects back on load.
 */
import type { CompanySnapshot } from '@dvh/engine';
import metaFixture from '@dvh/engine/fixtures/meta-2026-07-10.json';

export const BUNDLED_META = metaFixture as unknown as CompanySnapshot;

function looksLikeSnapshot(v: unknown): v is CompanySnapshot {
  const s = v as CompanySnapshot | null;
  return (
    !!s &&
    typeof s.ticker === 'string' &&
    typeof s.snapshotDate === 'string' &&
    typeof s.quote?.price === 'number' &&
    Array.isArray(s.rows) &&
    s.rows.at(-1)?.yearLabel === 'TTM'
  );
}

const preload = (globalThis as { __DVH_PRELOAD__?: unknown }).__DVH_PRELOAD__;
const ALL: CompanySnapshot[] = [
  BUNDLED_META,
  ...(Array.isArray(preload) ? preload.filter(looksLikeSnapshot) : []),
];

const byDateDesc = (a: CompanySnapshot, b: CompanySnapshot) =>
  b.snapshotDate.localeCompare(a.snapshotDate);

/** ticker → bundled snapshots, newest first. */
export const LIBRARY: Record<string, CompanySnapshot[]> = {};
for (const s of ALL) (LIBRARY[s.ticker] ??= []).push(s);
for (const list of Object.values(LIBRARY)) list.sort(byDateDesc);

/** Tickers in first-seen order (META first). */
export const LIBRARY_TICKERS: string[] = Object.keys(LIBRARY);

const key = (s: CompanySnapshot) => `${s.ticker}|${s.snapshotDate}|${s.quote.price}`;
const LIBRARY_KEYS = new Set(ALL.map(key));

export function isLibrarySnapshot(s: CompanySnapshot | null | undefined): boolean {
  return !!s && LIBRARY_KEYS.has(key(s));
}

export function stripLibrary(snapshots: CompanySnapshot[]): CompanySnapshot[] {
  return snapshots.filter((s) => !isLibrarySnapshot(s));
}

/** The ticker's own snapshots plus its bundled ones, newest first. */
export function withLibrary(ticker: string, snapshots: CompanySnapshot[]): CompanySnapshot[] {
  const bundled = LIBRARY[ticker];
  if (!bundled) return snapshots;
  // stable sort: on a date tie the user's own pull stays ahead
  return [...stripLibrary(snapshots), ...bundled].sort(byDateDesc);
}

export interface LibraryHit {
  ticker: string;
  name: string;
  exchange: string;
}

/** Offline search over the bundled names: ticker prefix, then name. */
export function searchLibrary(query: string, limit = 8): LibraryHit[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const hits: LibraryHit[] = [];
  for (const t of LIBRARY_TICKERS) {
    const s = LIBRARY[t]![0]!;
    if (t.startsWith(q) || s.name.toUpperCase().includes(q)) {
      hits.push({ ticker: t, name: s.name, exchange: s.exchange });
    }
  }
  return hits.slice(0, limit);
}
