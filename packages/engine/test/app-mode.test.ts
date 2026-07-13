/**
 * The app's corrected/ergonomic mode vs sheet parity:
 *  - correct3yTerminal: the 3-year terminal cap discounts THREE periods
 *    (the sheet's N92 uses five — that quirk stays default for the gate);
 *  - seedBearBullFromBase: unedited Bear/Bull start from the Base seed
 *    instead of zeros, so they are live and adjustable immediately.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../fixtures/meta-2026-07-10.json';
import { analyzeCompany, type CompanySnapshot } from '../src/index';

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
