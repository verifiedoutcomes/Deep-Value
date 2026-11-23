/**
 * Snapshots that ship with the build. Always the sheet's META fixture;
 * plus whatever the hosting page preloads as `window.__DVH_PRELOAD__`:
 * the Claude preview build bakes in the whole S&P 500 + Nasdaq-100 from
 * the free sources (SEC EDGAR + Yahoo), compactly encoded, because its
 * viewer blocks network calls.
 *
 * Library snapshots live in the bundle, so the store never persists them:
 * `stripLibrary` removes them before a write and `withLibrary` puts the
 * same objects back on load.
 */
import type { CompanySnapshot, HistoricalRowInput, PricePoint } from '@dvh/engine';
import metaFixture from '@dvh/engine/fixtures/meta-2026-07-10.json';

export const BUNDLED_META = metaFixture as unknown as CompanySnapshot;

/** The preview build's encoding: rows as arrays keyed by `rowKeys`. */
interface CompactPreload {
  v: 2;
  rowKeys: (keyof HistoricalRowInput)[];
  items: (Omit<CompanySnapshot, 'rows' | 'priceHistory'> & {
    r: (number | string | null)[][];
    p: [string, number][];
  })[];
}

function decode(c: CompactPreload): CompanySnapshot[] {
  return c.items.map(({ r, p, ...rest }) => ({
    ...rest,
    rows: r.map((vals) => {
      const row: Record<string, unknown> = {};
      c.rowKeys.forEach((k, i) => {
        if (vals[i] !== undefined) row[k] = vals[i];
      });
      return row as unknown as HistoricalRowInput;
    }),
    priceHistory: p.map(([date, close]): PricePoint => ({ date, close })),
  }));
}

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

const g = globalThis as { __DVH_PRELOAD__?: unknown; __DVH_UNAVAILABLE__?: unknown };
const raw = g.__DVH_PRELOAD__;
const preload: unknown[] = Array.isArray(raw)
  ? raw
  : raw && (raw as CompactPreload).v === 2
    ? decode(raw as CompactPreload)
    : [];
const ALL: CompanySnapshot[] = [BUNDLED_META, ...preload.filter(looksLikeSnapshot)];

/** Universe members the preview build couldn't assemble, with the reason. */
export const UNAVAILABLE: Record<string, string> =
  g.__DVH_UNAVAILABLE__ && typeof g.__DVH_UNAVAILABLE__ === 'object'
    ? (g.__DVH_UNAVAILABLE__ as Record<string, string>)
    : {};

const byDateDesc = (a: CompanySnapshot, b: CompanySnapshot) =>
  b.snapshotDate.localeCompare(a.snapshotDate);

/** ticker → bundled snapshots, newest first. */
export const LIBRARY: Record<string, CompanySnapshot[]> = {};
for (const s of ALL) (LIBRARY[s.ticker] ??= []).push(s);
for (const list of Object.values(LIBRARY)) list.sort(byDateDesc);

/** Every bundled ticker. */
export const LIBRARY_TICKERS: string[] = Object.keys(LIBRARY);

/** Newest bundled snapshot date (what "bundled data as of" means). */
export const LIBRARY_AS_OF: string = ALL.map((s) => s.snapshotDate).sort().at(-1) ?? '';

/**
 * The default watchlist: well-known names plus the ones researched so
 * far, kept to those this build actually bundles (META alone in the
 * native app, which pulls everything else live).
 */
export const FEATURED: string[] = [
  'META', 'MSFT', 'GOOGL', 'AMZN', 'AAPL', 'NVDA', 'BRK-B', 'V', 'JPM',
  'COST', 'KO', 'PYPL', 'NKE', 'INTC', 'VRT', 'VST',
].filter((t) => LIBRARY[t]);

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
