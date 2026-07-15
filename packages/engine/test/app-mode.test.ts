/**
 * The app's corrected/ergonomic mode vs sheet parity:
 *  - correct3yTerminal: the 3-year terminal cap discounts THREE periods
 *    (the sheet's N92 uses five — that quirk stays default for the gate);
 *  - seedBearBullFromBase: unedited Bear/Bull start from the Base seed
 *    instead of zeros, so they are live and adjustable immediately.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../fixtures/meta-2026-07-10.json';
import { analyzeCompany, computeDerivedRows, type CompanySnapshot } from '../src/index';

const fixture = fixtureJson as unknown as CompanySnapshot;

describe('corrected 3-year terminal discounting (app mode)', () => {
  const parity = analyzeCompany(fixture);
  const corrected = analyzeCompany(fixture, {}, 'sheet', { correct3yTerminal: true });

  it('sheet-parity default matches the fixture (nper = 5)', () => {
    expect(parity.scenarios.base[3].intrinsicValue!).toBeCloseTo(2283080146745, -3);
  });

  it('corrected mode discounts the 3y terminal cap exactly 3 periods', () => {
    const v = corrected.scenarios.base[3];
    const pvFcf = v.forecast.reduce((a, f) => a + f.pvOfAdjFcf, 0);
    const expected = pvFcf + v.terminalMarketCap / Math.pow(1.1, 3);
    expect(v.intrinsicValue!).toBeCloseTo(expected, 2);
    // three periods instead of five => materially HIGHER intrinsic value
    expect(v.intrinsicValue!).toBeGreaterThan(parity.scenarios.base[3].intrinsicValue!);
  });

  it('5-year block is identical in both modes', () => {
    expect(corrected.scenarios.base[5].intrinsicValue!).toBeCloseTo(
      parity.scenarios.base[5].intrinsicValue!,
      2,
    );
  });
});

describe('true TTM Y/Y via priorTtmRevenue', () => {
  it('uses the prior trailing window when present, sheet proxy when absent', () => {
    const rows = structuredClone(fixture.rows);
    const n = rows.length;

    // absent -> sheet formula E53 = D53 / D51 - 1
    const sheetDerived = computeDerivedRows(rows);
    expect(sheetDerived[n - 1]!.revenueYoY!).toBeCloseTo(
      rows[n - 1]!.revenue! / rows[n - 3]!.revenue! - 1,
      12,
    );

    // present -> TTM / prior TTM - 1 (true non-overlapping Y/Y)
    rows[n - 1]!.priorTtmRevenue = 180_000_000_000;
    const trueDerived = computeDerivedRows(rows);
    expect(trueDerived[n - 1]!.revenueYoY!).toBeCloseTo(
      rows[n - 1]!.revenue! / 180_000_000_000 - 1,
      12,
    );

    // FY rows are untouched either way
    expect(trueDerived[n - 2]!.revenueYoY!).toBeCloseTo(sheetDerived[n - 2]!.revenueYoY!, 12);
  });
});

describe('bear/bull seeded from base (app mode)', () => {
  const seeded = analyzeCompany(fixture, {}, 'sheet', { seedBearBullFromBase: true });

  it('unedited bear and bull are live, matching the base seed', () => {
    for (const kind of ['bear', 'bull'] as const) {
      const v = seeded.scenarios[kind][5];
      expect(v.status).toBe('ok');
      expect(v.fairValuePerShare!).toBeCloseTo(
        seeded.scenarios.base[5].fairValuePerShare!,
        6,
      );
    }
    // verdict card now shows all three
    expect(seeded.verdict.bearFairValue).not.toBeNull();
    expect(seeded.verdict.bullFairValue).not.toBeNull();
  });

  it('3-year exit offsets still apply relative to the base multiple', () => {
    const base3 = seeded.scenarios.base[3].exitMultiple;
    expect(seeded.scenarios.bear[3].exitMultiple).toBeCloseTo(base3 - 1, 9); // bear: −3 vs base −2
    expect(seeded.scenarios.bull[3].exitMultiple).toBeCloseTo(base3, 9); // bull: −2, same as base
  });

  it('sheet default remains No Forecast (gate unchanged)', () => {
    const parity = analyzeCompany(fixture);
    expect(parity.scenarios.bear[5].status).toBe('no-forecast');
    expect(parity.scenarios.bull[5].status).toBe('no-forecast');
  });
});

describe('soundest-logic flags (app mode)', () => {
  const parity = analyzeCompany(fixture);

  it('correctedSummaryStats anchors CAGRs to the LATEST fiscal year', () => {
    const c = analyzeCompany(fixture, {}, 'sheet', { correctedSummaryStats: true });
    const n = fixture.rows.length;
    const latest = fixture.rows[n - 2]!; // FY2025
    const eightBack = fixture.rows[n - 10]!; // FY2017
    expect(c.summary.revenueCagr8!).toBeCloseTo(
      Math.pow(latest.revenue! / eightBack.revenue!, 1 / 8) - 1,
      12,
    );
    // sheet default (2024/2016) still matches the fixture cell D54
    expect(parity.summary.revenueCagr8!).toBeCloseTo(0.2497776137, 9);
  });

  it('correctedSummaryStats drops the TTM double-count from windows', () => {
    const c = analyzeCompany(fixture, {}, 'sheet', { correctedSummaryStats: true });
    // fixture TTM duplicates FY2025, so the corrected trimmed mean must
    // differ from the sheet's (S54 = 22.3948878)
    expect(c.summary.evEbitTrimmean!).not.toBeCloseTo(22.3948878, 6);
    expect(parity.summary.evEbitTrimmean!).toBeCloseTo(22.3948878, 8);
  });

  it('seedExitFromTrimmedMean seeds the trimmed-mean multiple', () => {
    const c = analyzeCompany(fixture, {}, 'sheet', { seedExitFromTrimmedMean: true });
    expect(c.seededExitMultiple5).toBeCloseTo(c.summary.evEbitTrimmean!, 9);
    expect(c.scenarios.base[5].exitMultiple).toBeCloseTo(c.summary.evEbitTrimmean!, 9);
    // sheet default seeds the current multiple (S53)
    expect(parity.seededExitMultiple5).toBeCloseTo(20.5594756, 6);
  });

  it('symmetric3yOffsets: every 3y multiple = 5y − 2', () => {
    const c = analyzeCompany(fixture, {}, 'sheet', {
      seedBearBullFromBase: true,
      symmetric3yOffsets: true,
    });
    for (const kind of ['bear', 'base', 'bull'] as const) {
      expect(c.scenarios[kind][3].exitMultiple).toBeCloseTo(
        c.scenarios[kind][5].exitMultiple - 2,
        9,
      );
    }
  });

  it('horizonMoic = (Σ FCF + terminal cap) / snapshot cap, both modes', () => {
    const v = parity.scenarios.base[5];
    const expected =
      (v.forecast.reduce((a, f) => a + f.adjFcf, 0) + v.terminalMarketCap) / 1664086890000;
    expect(v.horizonMoic).toBeCloseTo(expected, 9);
    expect(v.horizonMoic).toBeGreaterThan(1);
  });

  it('horizonPriceChange is (1+IRR)^h − 1 (proved redundant, kept for parity)', () => {
    const v = parity.scenarios.base[5];
    expect(v.horizonPriceChange!).toBeCloseTo(Math.pow(1 + v.irr!, 5) - 1, 6);
  });
});
