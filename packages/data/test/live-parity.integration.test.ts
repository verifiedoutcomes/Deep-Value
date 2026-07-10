/**
 * Live-data parity integration test (soft gate).
 *
 * Pulls META live through the configured provider and asserts each
 * fundamental sits within 3% of the 2026-07-10 fixture (15% for
 * market-cap-dependent fields), logging a field-by-field diff.
 *
 * Opt-in because it needs network + a key:
 *   DVH_FMP_BASE_URL=https://financialmodelingprep.com/  \
 *   DVH_FMP_API_KEY=... npx vitest run live-parity
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../engine/fixtures/meta-2026-07-10.json';
import type { CompanySnapshot } from '@dvh/engine';
import { FmpProvider } from '../src/fmp';
import { UsdOnlyFxTable } from '../src/fx';
import { loadCompanySnapshot } from '../src/snapshot';
import { compareSnapshots, formatParityReport } from '../src/live-parity';

const baseUrl = process.env.DVH_FMP_BASE_URL;
const apiKey = process.env.DVH_FMP_API_KEY;
const enabled = Boolean(baseUrl);

describe.skipIf(!enabled)('live META parity vs fixture (needs network + key)', () => {
  it(
    'every fundamental within tolerance, diff logged',
    { timeout: 120_000 },
    async () => {
      const provider = new FmpProvider({ baseUrl: baseUrl!, apiKey });
      const live = await loadCompanySnapshot(
        provider,
        { ticker: 'META', exchange: 'NASDAQ', reportingCurrency: 'USD' },
        new UsdOnlyFxTable(),
      );
      const report = compareSnapshots(fixtureJson as unknown as CompanySnapshot, live);
      // Always log the field-by-field diff so drift is visible in CI output.
      console.log(formatParityReport(report));
      expect(report.failures, formatParityReport(report)).toHaveLength(0);
    },
  );
});
