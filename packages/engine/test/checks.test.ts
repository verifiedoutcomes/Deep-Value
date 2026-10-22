/**
 * Assumption checks: each flag fires on the failure mode it targets and
 * stays quiet on an ordinary scenario. Synthetic overrides isolate each.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../fixtures/meta-2026-07-10.json';
import {
  analyzeCompany,
  checkAssumptions,
  fadeGrowth,
  FADE_TO_GROWTH,
  type AnalyzeOptions,
  type CompanySnapshot,
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
const kinds = (flags: { kind: string }[]) => flags.map((f) => f.kind);

describe('checkAssumptions', () => {
  it('sheet convention on META: Adj FCF margin far above op margin is flagged', () => {
    const a = analyzeCompany(fixture, {}, 'sheet', APP);
    const flags = checkAssumptions(a, 'base', 5, 'sheet');
    const f = flags.find((x) => x.kind === 'fcf-above-op');
    expect(f).toBeDefined();
    if (f?.kind !== 'fcf-above-op') throw new Error('unreachable');
    expect(f.fcfMargin).toBeGreaterThan(f.opMargin * 1.25);
  });

  it('conventional treatment on the same data is not flagged', () => {
    const a = analyzeCompany(fixture, {}, 'conventional', APP);
    expect(kinds(checkAssumptions(a, 'base', 5, 'conventional'))).not.toContain('fcf-above-op');
  });

  it('flags hypergrowth and reports the compounded revenue multiple', () => {
    const base = analyzeCompany(fixture, {}, 'conventional', APP);
    const years = base.scenarioInputs.base[5].years.map((y) => ({ ...y, revenueYoY: 0.6 }));
    const a = analyzeCompany(fixture, { years: { base: { 5: years } } }, 'conventional', APP);
    const f = checkAssumptions(a, 'base', 5, 'conventional').find((x) => x.kind === 'high-growth');
    if (f?.kind !== 'high-growth') throw new Error('expected a high-growth flag');
    expect(f.peakGrowth).toBeCloseTo(0.6, 12);
    expect(f.revenueMultiple).toBeCloseTo(Math.pow(1.6, 5), 9);
  });

  it('flags a rich exit multiple, not an ordinary one', () => {
    const rich = analyzeCompany(fixture, { exitMultiple5: { base: 45 } }, 'conventional', APP);
    expect(kinds(checkAssumptions(rich, 'base', 5, 'conventional'))).toContain('rich-exit');
    const plain = analyzeCompany(fixture, { exitMultiple5: { base: 18 } }, 'conventional', APP);
    expect(kinds(checkAssumptions(plain, 'base', 5, 'conventional'))).not.toContain('rich-exit');
  });

  it('flags depressed earnings when TTM op income collapses', () => {
    const snap = structuredClone(fixture);
    const ttm = snap.rows[snap.rows.length - 1]!;
    ttm.operatingIncome = 1e9; // EV/EBIT in the thousands
    const a = analyzeCompany(snap, {}, 'conventional', APP);
    expect(kinds(checkAssumptions(a, 'base', 5, 'conventional'))).toContain('depressed-earnings');
  });
});

describe('fadeGrowth', () => {
  it('fades linearly from year 1 to the target, keeping margins', () => {
    const years = [0.6, 0.6, 0.6, 0.59, 0.58].map((g) => ({
      revenueYoY: g,
      operatingMargin: 0.3,
      adjFcfMargin: 0.2,
    }));
    const faded = fadeGrowth(years);
    expect(faded[0]!.revenueYoY).toBeCloseTo(0.6, 12);
    expect(faded[4]!.revenueYoY).toBeCloseTo(FADE_TO_GROWTH, 12);
    expect(faded[2]!.revenueYoY).toBeCloseTo((0.6 + FADE_TO_GROWTH) / 2, 12);
    expect(faded.every((y) => y.operatingMargin === 0.3 && y.adjFcfMargin === 0.2)).toBe(true);
  });

  it('leaves slow growers alone', () => {
    const years = [0.03, 0.03, 0.03].map((g) => ({ revenueYoY: g, operatingMargin: 0.2, adjFcfMargin: 0.1 }));
    expect(fadeGrowth(years)).toEqual(years);
  });
});
