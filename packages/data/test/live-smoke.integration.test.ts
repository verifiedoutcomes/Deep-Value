/**
 * Live smoke test for ANY ticker (default MSFT): pulls through the real
 * provider, assembles a snapshot, runs the full engine, and asserts the
 * structural invariants that must hold for every company — the
 * ticker-agnostic counterpart of the META fixture gate.
 *
 *   DVH_FMP_BASE_URL=https://financialmodelingprep.com \
 *   DVH_FMP_API_KEY=... [DVH_SMOKE_TICKER=MSFT] npx vitest run live-smoke
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeCompany,
  fiftyTwoWeekRange,
  momentumFromHistory,
} from '@dvh/engine';
import { FmpProvider } from '../src/fmp';
import { UsdOnlyFxTable } from '../src/fx';
import { loadCompanySnapshot } from '../src/snapshot';

const baseUrl = process.env.DVH_FMP_BASE_URL;
const apiKey = process.env.DVH_FMP_API_KEY;
const ticker = (process.env.DVH_SMOKE_TICKER ?? 'MSFT').toUpperCase();
const enabled = Boolean(baseUrl);

describe.skipIf(!enabled)(`live smoke: ${ticker} end-to-end`, () => {
  it(
    'assembles a snapshot and every engine invariant holds',
    { timeout: 120_000 },
    async () => {
      const provider = new FmpProvider({ baseUrl: baseUrl!, apiKey });
      const snap = await loadCompanySnapshot(
        provider,
        { ticker, exchange: 'US', reportingCurrency: 'USD' },
        new UsdOnlyFxTable(),
      );

      // --- snapshot shape ---
      expect(snap.rows.at(-1)!.yearLabel).toBe('TTM');
      expect(snap.rows[0]!.yearLabel).toBe(2007);
      expect(snap.quote.price).toBeGreaterThan(0);
      expect(snap.quote.marketCap).toBeGreaterThan(1e9);
      expect(snap.snapshotMarketCap).toBe(snap.quote.marketCap);
      expect(snap.priceHistory.length).toBeGreaterThan(100);

      const analysis = analyzeCompany(snap);
      const n = snap.rows.length;
      const ttm = snap.rows[n - 1]!;
      const dTtm = analysis.derived[n - 1]!;

      // --- sheet identities on live data ---
      // K53 = H53 - I53 - J53 (capex negative)
      expect(dTtm.adjFcf).toBeCloseTo(
        ttm.operatingCashFlow! - ttm.capex! - ttm.sbc!,
        2,
      );
      // Q53 = P53 + M53
      expect(dTtm.enterpriseValue).toBeCloseTo(
        snap.snapshotMarketCap + ttm.netDebt!,
        2,
      );
      // capex stored negative for a capex-heavy company
      expect(ttm.capex!).toBeLessThan(0);

      // --- header sanity for a mega-cap ---
      const h = analysis.header;
      expect(h.peLiveCap!).toBeGreaterThan(3);
      expect(h.peLiveCap!).toBeLessThan(150);
      expect(h.operatingMargin!).toBeGreaterThan(0.05);
      expect(h.operatingMargin!).toBeLessThan(0.8);
      expect(h.adjFcfYield!).toBeGreaterThan(0);

      // --- seeded base case computes ---
      const base5 = analysis.scenarios.base[5];
      expect(base5.status).toBe('ok');
      expect(base5.fairValuePerShare!).toBeGreaterThan(0);
      expect(base5.irr).not.toBeNull();
      // seeded year-1 revenue = TTM revenue x (1 + latest FY YoY)
      const latestFyYoY = analysis.derived[n - 2]!.revenueYoY!;
      expect(base5.forecast[0]!.revenue).toBeCloseTo(
        ttm.revenue! * (1 + latestFyYoY),
        0,
      );
      // bear/bull untouched -> No Forecast on the 5-year blocks
      expect(analysis.scenarios.bear[5].status).toBe('no-forecast');
      expect(analysis.scenarios.bull[5].status).toBe('no-forecast');

      // --- strip, MoS, price history helpers ---
      expect(analysis.irrStrip).toHaveLength(9);
      expect(analysis.irrStrip[4]!.price).toBe(Math.round(snap.quote.price));
      const { high, low } = fiftyTwoWeekRange(snap.priceHistory);
      expect(high!).toBeGreaterThanOrEqual(low!);
      expect(snap.quote.price).toBeGreaterThan(low! * 0.5);
      const momentum = momentumFromHistory(snap.priceHistory, snap.snapshotDate);
      expect(momentum).not.toBeNull();

      // --- human-readable report ---
      const fmtB = (v: number | null | undefined) =>
        v == null ? '–' : `$${(v / 1e9).toFixed(1)}B`;
      const pct = (v: number | null | undefined) =>
        v == null ? '–' : `${(v * 100).toFixed(1)}%`;
      console.log(
        [
          `--- ${ticker} live smoke (${snap.snapshotDate}) ---`,
          `name              ${snap.name}`,
          `price / mkt cap   $${snap.quote.price.toFixed(2)} / ${fmtB(snap.quote.marketCap)}`,
          `TTM revenue       ${fmtB(ttm.revenue)}`,
          `TTM op income     ${fmtB(ttm.operatingIncome)} (${pct(h.operatingMargin)})`,
          `TTM OCF/capex/SBC ${fmtB(ttm.operatingCashFlow)} / ${fmtB(ttm.capex)} / ${fmtB(ttm.sbc)}`,
          `TTM Adj FCF       ${fmtB(dTtm.adjFcf)} (margin ${pct(dTtm.adjFcfMargin)})`,
          `net debt / EV     ${fmtB(ttm.netDebt)} / ${fmtB(dTtm.enterpriseValue)}`,
          `P/E (live)        ${h.peLiveCap?.toFixed(1)}`,
          `EV/EBIT           ${dTtm.evToEbit?.toFixed(1)}  ·  FCF yield ${pct(h.adjFcfYield)}`,
          `ROIC (provider)   ${pct(h.roic)}`,
          `52wk range        ${low?.toFixed(0)}–${high?.toFixed(0)}  ·  momentum ${pct(momentum)}`,
          `seeded base 5y    fair value $${base5.fairValuePerShare?.toFixed(2)} · IRR ${pct(base5.irr)} · Δ ${pct(base5.priceDelta)}`,
          `history years     ${snap.rows.filter((r) => (r.revenue ?? 0) > 0).length} with data of ${snap.rows.length} rows`,
        ].join('\n'),
      );
    },
  );
});
