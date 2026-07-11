/**
 * EDGAR-first live integration: MSFT assembled with statements from SEC
 * XBRL (public domain) and only prices/quotes from FMP. MSFT's June
 * fiscal year end makes it the acid test for price-at-FYE enrichment.
 *
 *   DVH_EDGAR_LIVE=1 DVH_FMP_API_KEY=... npx vitest run edgar-first
 */
import { describe, expect, it } from 'vitest';
import { analyzeCompany } from '@dvh/engine';
import { EdgarFirstProvider } from '../src/composite';
import { FmpProvider } from '../src/fmp';
import { SecEdgarProvider } from '../src/sec-edgar';
import { UsdOnlyFxTable } from '../src/fx';
import { loadCompanySnapshot } from '../src/snapshot';

const enabled = process.env.DVH_EDGAR_LIVE === '1';
const apiKey = process.env.DVH_FMP_API_KEY;
const UA = 'DeepValueHunter-test/0.1 (contact: dev@example.com)';

/** Same ticker->CIK + companyfacts flow the worker's /edgar route runs. */
const edgarShim: typeof fetch = async (input) => {
  const m = String(input).match(/companyfacts\/([A-Za-z.\-]{1,10})$/);
  if (!m) return new Response('bad path', { status: 400 });
  const mapRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': UA },
  });
  const map = (await mapRes.json()) as Record<string, { cik_str: number; ticker: string }>;
  const entry = Object.values(map).find((e) => e.ticker === m[1]!.toUpperCase());
  if (!entry) return new Response('unknown ticker', { status: 404 });
  const cik = String(entry.cik_str).padStart(10, '0');
  return fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { 'User-Agent': UA },
  });
};

describe.skipIf(!enabled)('EDGAR-first live: MSFT (June FYE)', () => {
  it(
    'assembles from public-domain statements + market prices; engine holds',
    { timeout: 180_000 },
    async () => {
      const market = new FmpProvider({
        baseUrl: 'https://financialmodelingprep.com',
        apiKey,
      });
      const provider = new EdgarFirstProvider(
        new SecEdgarProvider('internal://edgar', edgarShim),
        market,
      );
      const snap = await loadCompanySnapshot(
        provider,
        { ticker: 'MSFT', exchange: 'US', reportingCurrency: 'USD' },
        new UsdOnlyFxTable(),
      );

      // Deep history straight from EDGAR: well beyond any paid-plan cap.
      const withData = snap.rows.filter((r) => (r.revenue ?? 0) > 0);
      expect(withData.length).toBeGreaterThanOrEqual(10);

      // A known anchor: MSFT FY2024 (ended 2024-06-30) revenue ~$245B.
      const fy2024 = snap.rows.find((r) => r.yearLabel === 2024);
      expect(fy2024?.revenue).toBeGreaterThan(230e9);
      expect(fy2024?.revenue).toBeLessThan(260e9);

      // Enrichment: per-year market cap and EV derived, positive, sane.
      const enriched = snap.rows.filter(
        (r) => typeof r.yearLabel === 'number' && (r.marketCap ?? 0) > 0,
      );
      expect(enriched.length).toBeGreaterThanOrEqual(5);
      for (const r of enriched) {
        expect(r.enterpriseValue).not.toBeNull();
        // EV = P + M exactly, by construction
        expect(r.enterpriseValue!).toBeCloseTo(r.marketCap! + (r.netDebt ?? 0), 2);
      }

      // Engine runs clean end to end on the EDGAR-first snapshot.
      const analysis = analyzeCompany(snap);
      expect(analysis.header.peLiveCap!).toBeGreaterThan(3);
      expect(analysis.header.peLiveCap!).toBeLessThan(150);
      expect(analysis.scenarios.base[5].status).toBe('ok');
      expect(analysis.header.roic).toBeNull(); // deliberately not invented

      const years = enriched.map((r) => r.yearLabel).join(',');
      console.log(
        `EDGAR-first MSFT: ${withData.length} FY rows with statements, ` +
          `market cap derived for [${years}], ` +
          `TTM rev $${((snap.rows.at(-1)!.revenue ?? 0) / 1e9).toFixed(1)}B, ` +
          `base5 FV $${analysis.scenarios.base[5].fairValuePerShare?.toFixed(2)}`,
      );
    },
  );
});
