/**
 * Live-data parity check: compares a live pull against a fixture snapshot
 * field by field. A live pull will never match the sheet's vendor penny
 * for penny, so this is a soft gate with three honesty levels:
 *
 *  - CLOSED FISCAL YEARS are immutable: those fundamentals must sit within
 *    `tolerance` (default 3%; market-cap fields get `wideTolerance` since
 *    per-year cap/EV depend on the vendor's price stamp). These are the
 *    `failures` that make the integration test red.
 *  - TTM and quote fields drift legitimately with time (new quarters land,
 *    prices move): out-of-band values are reported as `drift`, not failure.
 *  - Fields absent on the live side (e.g. FMP's free tier caps history at
 *    5 years) are reported as `missingLive`, not failure.
 *
 * The resulting report powers both the integration test and the hidden
 * developer screen in the app, so data-source drift stays visible.
 */
import type { CompanySnapshot, HistoricalRowInput, Maybe } from '@dvh/engine';

export type DiffCategory = 'ok' | 'fail' | 'drift' | 'missing-live' | 'missing-fixture';

export interface FieldDiff {
  path: string;
  fixture: Maybe;
  live: Maybe;
  relDiff: Maybe; // null when either side is missing/zero
  category: DiffCategory;
  tolerance: number;
}

export interface ParityReport {
  ticker: string;
  fixtureDate: string;
  liveDate: string;
  diffs: FieldDiff[];
  /** Out-of-tolerance CLOSED-fiscal-year fundamentals: the hard subset. */
  failures: FieldDiff[];
  /** TTM/quote recency drift + live-side gaps: informational. */
  drift: FieldDiff[];
  missingLive: FieldDiff[];
}

const FUNDAMENTAL_FIELDS: (keyof HistoricalRowInput)[] = [
  'revenue',
  'operatingIncome',
  'operatingCashFlow',
  'capex',
  'sbc',
  'netDebt',
  'shares',
  'tangibleBook',
  'grossProfit',
  'netIncome',
];

/** Market-cap-dependent fields get a wider band (prices move). */
const WIDE_FIELDS: (keyof HistoricalRowInput)[] = ['marketCap', 'enterpriseValue'];

function diffOne(
  path: string,
  fixture: Maybe | undefined,
  live: Maybe | undefined,
  tolerance: number,
  informational: boolean,
): FieldDiff {
  const f = fixture ?? null;
  const l = live ?? null;
  let relDiff: Maybe = null;
  let category: DiffCategory = 'ok';
  const fMissing = f == null || f === 0;
  const lMissing = l == null || l === 0;
  if (!fMissing && lMissing) {
    category = 'missing-live';
  } else if (fMissing && !lMissing) {
    category = 'missing-fixture';
  } else if (!fMissing && !lMissing) {
    relDiff = Math.abs(l! - f!) / Math.abs(f!);
    if (relDiff > tolerance) category = informational ? 'drift' : 'fail';
  }
  return { path, fixture: f, live: l, relDiff, category, tolerance };
}

export function compareSnapshots(
  fixture: CompanySnapshot,
  live: CompanySnapshot,
  tolerance = 0.03,
  wideTolerance = 0.15,
): ParityReport {
  const diffs: FieldDiff[] = [];

  for (const fRow of fixture.rows) {
    const lRow = live.rows.find((r) => r.yearLabel === fRow.yearLabel);
    // TTM legitimately moves as new quarters land after the fixture date.
    const informational = fRow.yearLabel === 'TTM';
    for (const field of FUNDAMENTAL_FIELDS) {
      // Share counts differ by source (GOOGLEFINANCE vs the provider's
      // EV series), so they get the wide band even on closed years.
      const tol = field === 'shares' ? wideTolerance : tolerance;
      diffs.push(
        diffOne(
          `${fRow.yearLabel}.${field}`,
          fRow[field] as Maybe,
          lRow?.[field] as Maybe,
          tol,
          informational,
        ),
      );
    }
    for (const field of WIDE_FIELDS) {
      diffs.push(
        diffOne(
          `${fRow.yearLabel}.${field}`,
          fRow[field] as Maybe,
          lRow?.[field] as Maybe,
          wideTolerance,
          informational,
        ),
      );
    }
  }
  diffs.push(diffOne('quote.price', fixture.quote.price, live.quote.price, wideTolerance, true));
  diffs.push(
    diffOne('quote.marketCap', fixture.quote.marketCap, live.quote.marketCap, wideTolerance, true),
  );
  diffs.push(diffOne('roic', fixture.roic, live.roic, tolerance, false));

  return {
    ticker: fixture.ticker,
    fixtureDate: fixture.snapshotDate,
    liveDate: live.snapshotDate,
    diffs,
    failures: diffs.filter((d) => d.category === 'fail'),
    drift: diffs.filter((d) => d.category === 'drift'),
    missingLive: diffs.filter((d) => d.category === 'missing-live'),
  };
}

/** Render the report as an aligned text table (dev screen / test log). */
export function formatParityReport(report: ParityReport): string {
  const mark: Record<DiffCategory, string> = {
    ok: '  ',
    fail: '✗ ',
    drift: '~ ',
    'missing-live': '∅ ',
    'missing-fixture': '+ ',
  };
  const lines = [
    `Live parity: ${report.ticker} fixture ${report.fixtureDate} vs live ${report.liveDate}`,
    `${report.failures.length} hard failures · ${report.drift.length} recency drift · ` +
      `${report.missingLive.length} missing on live side (plan history cap)`,
    '',
  ];
  for (const d of report.diffs) {
    if (d.category === 'ok') continue; // keep the log to the signal
    const rel = d.relDiff == null ? '   -  ' : `${(d.relDiff * 100).toFixed(2)}%`;
    lines.push(
      `${mark[d.category]}${d.path.padEnd(28)} fixture=${String(d.fixture).padEnd(16)} live=${String(
        d.live,
      ).padEnd(16)} Δ=${rel}`,
    );
  }
  return lines.join('\n');
}
