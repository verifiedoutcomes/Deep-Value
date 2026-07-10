/**
 * Live-data parity check: compares a live pull against a fixture snapshot
 * field by field. A live pull will never match the sheet's vendor penny
 * for penny, so this is a soft gate: each fundamental must sit within
 * `tolerance` (default 3%, wider for market-cap-dependent ratios). The
 * resulting diff powers both the integration test and the hidden
 * developer screen in the app, so data-source drift stays visible.
 */
import type { CompanySnapshot, HistoricalRowInput, Maybe } from '@dvh/engine';

export interface FieldDiff {
  path: string;
  fixture: Maybe;
  live: Maybe;
  relDiff: Maybe; // null when either side is missing/zero
  withinTolerance: boolean;
  tolerance: number;
}

export interface ParityReport {
  ticker: string;
  fixtureDate: string;
  liveDate: string;
  diffs: FieldDiff[];
  failures: FieldDiff[];
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
): FieldDiff {
  const f = fixture ?? null;
  const l = live ?? null;
  let relDiff: Maybe = null;
  let within = true;
  if (f != null && l != null && f !== 0) {
    relDiff = Math.abs(l - f) / Math.abs(f);
    within = relDiff <= tolerance;
  } else if ((f == null) !== (l == null)) {
    within = false; // one side missing
  }
  return { path, fixture: f, live: l, relDiff, withinTolerance: within, tolerance };
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
    for (const field of FUNDAMENTAL_FIELDS) {
      diffs.push(
        diffOne(`${fRow.yearLabel}.${field}`, fRow[field] as Maybe, lRow?.[field] as Maybe, tolerance),
      );
    }
    for (const field of WIDE_FIELDS) {
      diffs.push(
        diffOne(
          `${fRow.yearLabel}.${field}`,
          fRow[field] as Maybe,
          lRow?.[field] as Maybe,
          wideTolerance,
        ),
      );
    }
  }
  diffs.push(diffOne('quote.price', fixture.quote.price, live.quote.price, wideTolerance));
  diffs.push(diffOne('quote.marketCap', fixture.quote.marketCap, live.quote.marketCap, wideTolerance));
  diffs.push(diffOne('roic', fixture.roic, live.roic, tolerance));

  return {
    ticker: fixture.ticker,
    fixtureDate: fixture.snapshotDate,
    liveDate: live.snapshotDate,
    diffs,
    failures: diffs.filter((d) => !d.withinTolerance),
  };
}

/** Render the report as an aligned text table (dev screen / test log). */
export function formatParityReport(report: ParityReport): string {
  const lines = [
    `Live parity: ${report.ticker} fixture ${report.fixtureDate} vs live ${report.liveDate}`,
    `${report.failures.length} of ${report.diffs.length} fields outside tolerance`,
    '',
  ];
  for (const d of report.diffs) {
    const flag = d.withinTolerance ? '  ' : '! ';
    const rel = d.relDiff == null ? '   -  ' : `${(d.relDiff * 100).toFixed(2)}%`;
    lines.push(
      `${flag}${d.path.padEnd(28)} fixture=${String(d.fixture).padEnd(16)} live=${String(
        d.live,
      ).padEnd(16)} Δ=${rel}`,
    );
  }
  return lines.join('\n');
}
