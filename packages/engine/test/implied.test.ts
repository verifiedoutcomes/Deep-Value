/**
 * Reverse DCF and sensitivity grid: read-only lenses over a scenario.
 * Every implied value is verified by plugging it back into the real
 * valuation path (computeScenarioValuation), not just the solver's own
 * inner loop.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../fixtures/meta-2026-07-10.json';
import {
  analyzeCompany,
  computeScenarioValuation,
  impliedExpectations,
  scenarioIntrinsicValue,
  sensitivityGrid,
  type AnalyzeOptions,
  type CompanySnapshot,
  type ScenarioInputs,
} from '../src/index';

const fixture = fixtureJson as unknown as CompanySnapshot;
const APP: AnalyzeOptions = {
  correct3yTerminal: true,
  seedBearBullFromBase: true,
  correctedSummaryStats: true,
  seedExitFromTrimmedMean: true,
  seedMarginsFromTtm: true,
  symmetric3yOffsets: true,
};

describe('scenarioIntrinsicValue', () => {
  it('matches the full valuation for every block, both modes', () => {
    for (const opts of [{}, APP]) {
      const a = analyzeCompany(fixture, {}, 'sheet', opts);
      for (const h of [5, 3] as const) {
        const iv = scenarioIntrinsicValue(a.anchors, a.scenarioInputs.base[h]);
        expect(iv).toBeCloseTo(a.scenarios.base[h].intrinsicValue!, 0);
      }
    }
  });
});

describe('impliedExpectations (reverse DCF)', () => {
  const a = analyzeCompany(fixture, {}, 'sheet', APP);

  for (const h of [5, 3] as const) {
    const inputs = a.scenarioInputs.base[h];
    const imp = impliedExpectations(a.anchors, inputs);
    const rate = inputs.terminalDiscountRate;

    it(`${h}y implied exit multiple prices the stock at fair value; IRR = discount rate`, () => {
      expect(imp.exitMultiple.bound).toBeNull();
      const v = computeScenarioValuation(a.anchors, {
        ...inputs,
        exitMultiple: imp.exitMultiple.value!,
      });
      expect(v.fairValuePerShare!).toBeCloseTo(a.anchors.price, 6);
      expect(v.irr!).toBeCloseTo(rate, 8);
    });

    it(`${h}y implied constant growth prices the stock at fair value; IRR = discount rate`, () => {
      expect(imp.revenueGrowth.bound).toBeNull();
      const g = imp.revenueGrowth.value!;
      const v = computeScenarioValuation(a.anchors, {
        ...inputs,
        years: inputs.years.map((y) => ({ ...y, revenueYoY: g })),
      });
      expect(v.fairValuePerShare!).toBeCloseTo(a.anchors.price, 4);
      expect(v.irr!).toBeCloseTo(rate, 6);
    });

    it(`${h}y: a scenario valued above the price implies less than it assumes`, () => {
      expect(a.scenarios.base[h].fairValuePerShare!).toBeGreaterThan(a.anchors.price);
      expect(imp.revenueGrowth.value!).toBeLessThan(imp.scenarioGrowthCagr);
      expect(imp.exitMultiple.value!).toBeLessThan(imp.scenarioExitMultiple);
    });
  }

  it('scenario CAGR is the geometric mean of the growth path', () => {
    const inputs = a.scenarioInputs.base[5];
    const imp = impliedExpectations(a.anchors, inputs);
    const prod = inputs.years.reduce((p, y) => p * (1 + y.revenueYoY), 1);
    expect(imp.scenarioGrowthCagr).toBeCloseTo(Math.pow(prod, 1 / 5) - 1, 12);
  });

  it('reports bounds when the price is outside what the range can produce', () => {
    const inputs = a.scenarioInputs.base[5];
    const cheap = impliedExpectations({ ...a.anchors, snapshotMarketCap: 1e6 }, inputs);
    expect(cheap.revenueGrowth).toEqual({ value: null, bound: 'below' });
    expect(cheap.exitMultiple).toEqual({ value: null, bound: 'below' });
    const dear = impliedExpectations({ ...a.anchors, snapshotMarketCap: 1e16 }, inputs);
    expect(dear.revenueGrowth).toEqual({ value: null, bound: 'above' });
    expect(dear.exitMultiple.value!).toBeGreaterThan(1000);
  });

  it('loss-making terminal year: no implied value rather than a fake one', () => {
    const inputs: ScenarioInputs = {
      ...a.scenarioInputs.base[5],
      years: a.scenarioInputs.base[5].years.map((y) => ({ ...y, operatingMargin: -0.05 })),
    };
    const imp = impliedExpectations(a.anchors, inputs);
    expect(imp.revenueGrowth).toEqual({ value: null, bound: null });
    expect(imp.exitMultiple).toEqual({ value: null, bound: null });
  });
});

describe('sensitivityGrid', () => {
  const a = analyzeCompany(fixture, {}, 'sheet', APP);

  it('centre cell reproduces the scenario fair value exactly (5y and 3y)', () => {
    for (const h of [5, 3] as const) {
      const g = sensitivityGrid(a.anchors, a.scenarioInputs.base[h]);
      expect(g.fairValue[g.current.row]![g.current.col]!).toBeCloseTo(
        a.scenarios.base[h].fairValuePerShare!,
        8,
      );
      expect(g.exitMultiples[2]).toBe(a.scenarioInputs.base[h].exitMultiple);
      expect(g.discountRates[2]).toBe(a.scenarioInputs.base[h].terminalDiscountRate);
    }
  });

  it('rises with the exit multiple and falls with the discount rate', () => {
    const g = sensitivityGrid(a.anchors, a.scenarioInputs.base[5]);
    for (let r = 0; r < 5; r++) {
      for (let c = 1; c < 5; c++) {
        expect(g.fairValue[r]![c]!).toBeGreaterThan(g.fairValue[r]![c - 1]!);
      }
    }
    for (let c = 0; c < 5; c++) {
      for (let r = 1; r < 5; r++) {
        expect(g.fairValue[r]![c]!).toBeLessThan(g.fairValue[r - 1]![c]!);
      }
    }
  });

  it('blanks non-positive multiples instead of valuing them', () => {
    const g = sensitivityGrid(a.anchors, { ...a.scenarioInputs.base[5], exitMultiple: 2 });
    expect(g.fairValue[0]![0]).toBeNull(); // 2 − 4 = −2×
    expect(g.fairValue[0]![1]).toBeNull(); // 0×
    expect(g.fairValue[0]![2]).not.toBeNull();
  });
});
