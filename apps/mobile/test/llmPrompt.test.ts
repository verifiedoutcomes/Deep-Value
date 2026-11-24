/**
 * The "Ask an AI" round trip: the prompt carries the data and the exact
 * answer format; the parser accepts what chat AIs actually return and
 * refuses what would silently corrupt a forecast.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../packages/engine/fixtures/meta-2026-07-10.json';
import { analyzeCompany, type CompanySnapshot } from '@dvh/engine';
import { buildForecastPrompt, forecastYears, parseForecastAnswer } from '../src/llmPrompt';
import { APP_ANALYZE_OPTIONS } from '../src/engineOptions';

const snapshot = fixtureJson as unknown as CompanySnapshot;
const analysis = analyzeCompany(snapshot, {}, 'conventional', APP_ANALYZE_OPTIONS);

describe('buildForecastPrompt', () => {
  const prompt = buildForecastPrompt({
    snapshot,
    analysis,
    horizon: 3,
    capexTreatment: 'conventional',
    discountRate: 0.1,
  });
  const years = forecastYears(analysis.anchors.firstForecastYear, 3);

  it('names the company, the forecast years and the definitions the model uses', () => {
    expect(prompt).toContain(`(${snapshot.ticker})`);
    expect(prompt).toContain(`${years[0]}–${years[2]}`);
    expect(prompt).toContain('operating cash flow − capital expenditure − stock-based compensation');
    expect(prompt).toContain('discounted at 10%');
  });

  it('carries the last ten fiscal years plus TTM', () => {
    const rows = prompt.split('\n').filter((l) => /^\| (\d{4}|TTM) \|/.test(l));
    expect(rows).toHaveLength(Math.min(11, snapshot.rows.length));
    expect(rows.at(-1)).toMatch(/^\| TTM \|/);
  });

  it('ends with a JSON template the parser itself accepts', () => {
    const block = prompt.slice(prompt.lastIndexOf('```json'));
    const filled = block.replace(/0\.0+/g, '0.05');
    const r = parseForecastAnswer(filled);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.horizon).toBe(3);
    expect(Object.keys(r.value.scenarios).sort()).toEqual(['base', 'bear', 'bull']);
  });
});

const answer = (body: string) => `Here is my view.\n\n- Base: ads keep growing.\n\n\`\`\`json\n${body}\n\`\`\`\n`;
const scenario = (g: number, om: number, fm: number, exit: number | string = 15, n = 3) => ({
  exitMultiple: exit,
  years: Array.from({ length: n }, (_, i) => ({
    year: 2027 + i,
    revenueGrowth: g,
    operatingMargin: om,
    adjFcfMargin: fm,
  })),
});

describe('parseForecastAnswer', () => {
  it('reads the fenced JSON after the reasoning', () => {
    const r = parseForecastAnswer(
      answer(JSON.stringify({ scenarios: { bear: scenario(0.02, 0.3, 0.2, 12), base: scenario(0.08, 0.38, 0.25), bull: scenario(0.14, 0.42, 0.3, 20) } })),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.horizon).toBe(3);
    expect(r.value.scenarios.base!.years[0]).toEqual({ revenueYoY: 0.08, operatingMargin: 0.38, adjFcfMargin: 0.25 });
    expect(r.value.scenarios.bear!.exitMultiple).toBe(12);
    expect(r.value.warnings).toEqual([]);
  });

  it('accepts percentages and "14x" strings, and says so', () => {
    const r = parseForecastAnswer(
      answer(JSON.stringify({ scenarios: { base: scenario('8%' as unknown as number, 38, 25, '14x', 5) } })),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.horizon).toBe(5);
    expect(r.value.scenarios.base!.years[0]).toEqual({ revenueYoY: 0.08, operatingMargin: 0.38, adjFcfMargin: 0.25 });
    expect(r.value.scenarios.base!.exitMultiple).toBe(14);
    expect(r.value.warnings.join(' ')).toMatch(/percentages/);
    expect(r.value.warnings.join(' ')).toMatch(/No bear or bull scenario/);
  });

  it('takes the last block that parses when the answer has several', () => {
    const r = parseForecastAnswer(
      answer('{ not json }') + answer(JSON.stringify({ base: scenario(0.05, 0.2, 0.1) })),
    );
    expect(r.ok && r.value.scenarios.base!.years[0]!.revenueYoY).toBe(0.05);
  });

  it('refuses mismatched horizons, missing fields and implausible values', () => {
    const mixed = parseForecastAnswer(
      answer(JSON.stringify({ scenarios: { base: scenario(0.05, 0.2, 0.1), bull: scenario(0.05, 0.2, 0.1, 15, 5) } })),
    );
    expect(mixed.ok).toBe(false);
    const missing = parseForecastAnswer(
      answer(JSON.stringify({ scenarios: { base: { years: [{ revenueGrowth: 0.1 }, {}, {}] } } })),
    );
    expect(missing.ok).toBe(false);
    const wild = parseForecastAnswer(answer(JSON.stringify({ base: scenario(9, 0.2, 0.1) })));
    expect(wild.ok).toBe(false);
    expect(parseForecastAnswer('no json here').ok).toBe(false);
  });

  it('drops a non-positive exit multiple instead of applying it', () => {
    const r = parseForecastAnswer(answer(JSON.stringify({ base: scenario(0.05, 0.2, 0.1, -3) })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scenarios.base!.exitMultiple).toBeNull();
    expect(r.value.warnings.join(' ')).toMatch(/ignored exit multiple/);
  });
});
