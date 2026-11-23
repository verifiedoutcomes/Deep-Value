/**
 * Snapshots for the whole universe (S&P 500 + Nasdaq-100) from the free
 * sources: SEC EDGAR statements + Yahoo chart prices. Run through
 * `node scripts/build-artifact.mjs --dataset`.
 *
 * Writes .artifact/universe-snapshots.json (gitignored: it holds Yahoo
 * prices, which are not ours to redistribute) and
 * .artifact/dataset-report.json (per ticker: ok or the reason it failed,
 * plus data notes).
 *
 * DVH_SEC_CACHE=<dir> reads/writes companyfacts as CIK##########.json.gz
 * there, so reruns don't re-download ~2 GB from the SEC.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  FreeProvider,
  UsdOnlyFxTable,
  loadCompanySnapshot,
  type SecCompanyFacts,
} from '../packages/data/src/index';
import type { CompanySnapshot } from '../packages/engine/src/index';
import universe from '../packages/data/src/universe.json';
import shareOverrides from '../packages/data/src/share-overrides.json';

const UA = 'DeepValueHunter-research/0.1 (contact: research@example.com)';
const OUT = process.argv[2] ?? '.artifact/universe-snapshots.json';
const REPORT = OUT.replace(/[^/]+$/, 'dataset-report.json');
const CACHE = process.env.DVH_SEC_CACHE;
const PRICE_WEEKS = 156;

type Entry = (typeof universe.companies)[number] & { predecessors?: number[] };
const companies = universe.companies as Entry[];
const only = process.env.DVH_ONLY?.split(',').map((t) => t.trim().toUpperCase());

let secChain = Promise.resolve();
/** SEC fair access: at most ~5 requests a second from this script. */
function secThrottle(): Promise<void> {
  const next = secChain.then(() => new Promise<void>((r) => setTimeout(r, 200)));
  secChain = next;
  return next;
}

async function loadFacts(cik: number): Promise<SecCompanyFacts> {
  const file = CACHE ? `${CACHE}/${String(cik).padStart(10, '0')}.json.gz` : null;
  if (file && existsSync(file)) return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  await secThrottle();
  const res = await fetch(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`,
    { headers: { 'User-Agent': UA } },
  );
  if (!res.ok) throw new Error(`SEC companyfacts ${cik}: HTTP ${res.status}`);
  const text = await res.text();
  if (file) {
    mkdirSync(CACHE!, { recursive: true });
    writeFileSync(file, gzipSync(text));
  }
  return JSON.parse(text);
}

const byTicker = new Map(companies.map((c) => [c.ticker, c]));
const predecessors = Object.fromEntries(
  companies.filter((c) => c.predecessors?.length).map((c) => [c.ticker, c.predecessors!]),
);
const provider = new FreeProvider({
  loadFacts,
  cikFor: async (t) => byTicker.get(t)?.cik ?? null,
  predecessors,
  shareOverrides: shareOverrides.companies,
});

interface ReportRow {
  ticker: string;
  status: string;
  error?: string;
  notes?: string[];
}

const targets = companies.filter((c) => c.status === 'ok' && (!only || only.includes(c.ticker)));
const snapshots: CompanySnapshot[] = [];
const report: ReportRow[] = companies
  .filter((c) => c.status !== 'ok' && (!only || only.includes(c.ticker)))
  .map((c) => ({ ticker: c.ticker, status: c.status }));

let i = 0;
async function worker() {
  while (i < targets.length) {
    const c = targets[i++]!;
    try {
      const snap = await loadCompanySnapshot(
        provider,
        { ticker: c.ticker, exchange: 'US', reportingCurrency: 'USD' },
        new UsdOnlyFxTable(),
      );
      snap.priceHistory = snap.priceHistory.slice(-PRICE_WEEKS);
      snapshots.push(snap);
      report.push({ ticker: c.ticker, status: 'ok', notes: snap.dataNotes });
    } catch (err) {
      report.push({ ticker: c.ticker, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    if ((snapshots.length + report.length) % 50 === 0) {
      process.stdout.write(`  ${snapshots.length} ok / ${report.filter((r) => r.status === 'error').length} errors\n`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

snapshots.sort((a, b) => a.ticker.localeCompare(b.ticker));
report.sort((a, b) => a.ticker.localeCompare(b.ticker));
writeFileSync(OUT, JSON.stringify(snapshots));
writeFileSync(REPORT, JSON.stringify(report, null, 1));
const errors = report.filter((r) => r.status === 'error');
console.log(`wrote ${snapshots.length} snapshots to ${OUT}; ${errors.length} errors`);
for (const e of errors) console.log(`  ${e.ticker}: ${e.error}`);
