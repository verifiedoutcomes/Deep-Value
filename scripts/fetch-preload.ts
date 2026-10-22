/**
 * Pulls fresh snapshots for the Claude preview build's bundled library
 * (the artifact viewer blocks network calls, so the preview ships its
 * data). Run through `node scripts/build-artifact.mjs --fetch`.
 *
 * Needs DVH_FMP_API_KEY in the environment; DVH_PRELOAD_TICKERS overrides
 * the default list. Output goes to .artifact/preload.json, which is
 * gitignored: provider data is licensed to the key holder, so it is never
 * committed to the public repo.
 */
import { writeFileSync } from 'node:fs';
import { FmpProvider, UsdOnlyFxTable, loadCompanySnapshot } from '../packages/data/src/index';
import type { CompanySnapshot } from '../packages/engine/src/index';

const DEFAULT_TICKERS = 'META,MSFT,GOOGL,AMZN,AAPL,NVDA,BRK-B,COST,KO,PYPL,NKE,INTC';
/** The chart shows two years; momentum needs one. Three keeps the file small. */
const PRICE_HISTORY_WEEKS = 156;

const apiKey = process.env.DVH_FMP_API_KEY;
const baseUrl = process.env.DVH_FMP_BASE_URL ?? 'https://financialmodelingprep.com';
const out = process.argv[2] ?? '.artifact/preload.json';
if (!apiKey) {
  console.error('DVH_FMP_API_KEY is not set');
  process.exit(1);
}

const tickers = (process.env.DVH_PRELOAD_TICKERS ?? DEFAULT_TICKERS)
  .split(',')
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);

const provider = new FmpProvider({ baseUrl, apiKey });
const snapshots: CompanySnapshot[] = [];
for (const ticker of tickers) {
  try {
    const snap = await loadCompanySnapshot(
      provider,
      { ticker, exchange: 'US', reportingCurrency: 'USD' },
      new UsdOnlyFxTable(),
    );
    snap.priceHistory = snap.priceHistory.slice(-PRICE_HISTORY_WEEKS);
    snapshots.push(snap);
    console.log(`  ${ticker.padEnd(6)} ${snap.name} · $${snap.quote.price.toFixed(2)}`);
  } catch (err) {
    console.warn(`  ${ticker.padEnd(6)} skipped: ${err instanceof Error ? err.message : err}`);
  }
}
writeFileSync(out, JSON.stringify(snapshots));
console.log(`wrote ${snapshots.length}/${tickers.length} snapshots to ${out}`);
