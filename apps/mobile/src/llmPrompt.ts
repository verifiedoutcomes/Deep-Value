/**
 * "Ask an AI" for forecast inputs: a self-contained prompt carrying the
 * company's history and the model's mechanics, and a parser for the JSON
 * the answer ends with. Pure (no React), so it can be tested directly.
 *
 * All three editable inputs are asked for, not just the FCF margin: the
 * growth path sets every year's revenue, the operating margin sets the
 * terminal value (final-year operating income × exit multiple, usually
 * most of the fair value), and the FCF margin sets the cash collected on
 * the way. The exit multiple is asked for too, because it moves the
 * answer as much as any of them.
 */
import type {
  CapexTreatment,
  CompanyAnalysis,
  CompanySnapshot,
  HorizonYears,
  Maybe,
  ScenarioKind,
  ScenarioYearInput,
} from '@dvh/engine';

const KINDS: ScenarioKind[] = ['bear', 'base', 'bull'];

const pc = (v: Maybe, d = 1) => (v == null ? 'n/a' : `${(v * 100).toFixed(d)}%`);
const musd = (v: Maybe) => (v == null ? 'n/a' : Math.round(v / 1e6).toLocaleString('en-US'));
const x = (v: Maybe) => (v == null ? 'n/a' : `${v.toFixed(1)}x`);

const FCF_DEFINITION: Record<CapexTreatment, string> = {
  conventional:
    'Adj FCF = operating cash flow − capital expenditure − stock-based compensation (SBC is treated as a real cost)',
  owner:
    'Adj FCF (owner earnings) = operating cash flow − depreciation & amortization − stock-based compensation',
  sheet: 'Adj FCF = operating cash flow + |capex| − SBC (legacy sheet convention)',
};

export interface PromptInput {
  snapshot: CompanySnapshot;
  analysis: CompanyAnalysis;
  horizon: HorizonYears;
  capexTreatment: CapexTreatment;
  discountRate: number;
}

export function forecastYears(firstForecastYear: number, horizon: HorizonYears): number[] {
  return Array.from({ length: horizon }, (_, i) => firstForecastYear + i);
}

export function buildForecastPrompt({
  snapshot,
  analysis,
  horizon,
  capexTreatment,
  discountRate,
}: PromptInput): string {
  const { rows } = snapshot;
  const { derived, summary, header, anchors } = analysis;
  const years = forecastYears(anchors.firstForecastYear, horizon);
  const finalYear = years[years.length - 1]!;
  const ttm = rows[rows.length - 1]!;

  // last 10 fiscal years + TTM
  const from = Math.max(0, rows.length - 11);
  const table = [
    '| Year | Revenue ($M) | Rev growth | Gross margin | Op margin | Net margin | Adj FCF margin | Capex % rev | SBC % rev |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.slice(from).map((r, j) => {
      const d = derived[from + j]!;
      const rev = r.revenue;
      const share = (v: Maybe) => (v == null || rev == null || rev === 0 ? 'n/a' : pc(Math.abs(v) / rev));
      return `| ${r.yearLabel} | ${musd(rev)} | ${pc(d.revenueYoY)} | ${pc(d.grossMargin)} | ${pc(
        d.operatingMargin,
      )} | ${pc(d.netMargin)} | ${pc(d.adjFcfMargin)} | ${share(r.capex)} | ${share(r.sbc)} |`;
    }),
  ].join('\n');

  const notes = snapshot.dataNotes?.length
    ? `\nData caveats (from the app's data source):\n${snapshot.dataNotes.map((n) => `- ${n}`).join('\n')}\n`
    : '';

  const example = (kind: ScenarioKind) =>
    `    "${kind}": {\n      "exitMultiple": 0.0,\n      "years": [\n${years
      .map(
        (y) =>
          `        { "year": ${y}, "revenueGrowth": 0.000, "operatingMargin": 0.000, "adjFcfMargin": 0.000 }`,
      )
      .join(',\n')}\n      ]\n    }`;

  return `You are an experienced buy-side equity analyst. Estimate the forecast inputs for a discounted-cash-flow model of ${snapshot.name} (${snapshot.ticker}).

## The company today (data as of ${snapshot.snapshotDate})
- Share price: $${snapshot.quote.price.toFixed(2)}; market cap $${musd(snapshot.snapshotMarketCap)}M
- Net debt (debt + lease liabilities − cash): $${musd(ttm.netDebt)}M
- TTM revenue: $${musd(ttm.revenue)}M; TTM operating income: $${musd(ttm.operatingIncome)}M
- EV/EBIT now: ${x(header.evOverOperatingIncome)}; trimmed-mean EV/EBIT over its history: ${x(summary.evEbitTrimmean)}
- 8-year revenue CAGR: ${pc(summary.revenueCagr8)}; 4-year average operating margin: ${pc(summary.operatingMarginAvg4)}; 4-year average Adj FCF margin: ${pc(summary.adjFcfMarginAvg4)}

## History (USD millions; fiscal years from SEC filings; TTM = latest twelve months reported)
${table}
${notes}
## Definitions and how the model uses your numbers
- Revenue growth: year-over-year change. Year 1 (${years[0]}) revenue = TTM revenue × (1 + growth); each later year compounds from the one before.
- Operating margin = operating income (EBIT) ÷ revenue.
- ${FCF_DEFINITION[capexTreatment]}. Adj FCF margin = Adj FCF ÷ revenue.
- Each year's Adj FCF = revenue × Adj FCF margin, discounted at ${pc(discountRate, 0)} a year.
- Terminal value = ${finalYear} operating income × exit EV/EBIT multiple, minus today's net debt, discounted from ${finalYear}. It is usually most of the fair value, so the ${finalYear} operating margin and the exit multiple matter most.

## Your task
Give three scenarios for the ${horizon} years ${years[0]}–${finalYear}, each with yearly revenue growth, operating margin and Adj FCF margin, plus an exit EV/EBIT multiple for ${finalYear}:
- base: the most likely outcome.
- bear: a plausible disappointing outcome (roughly a 1-in-5 downside), not a catastrophe.
- bull: a plausible strong outcome (roughly a 1-in-5 upside), not a fantasy.

Ground every number in the history above and what you know about the business: segments, competitive position, pricing power, cyclicality, reinvestment needs, management guidance. If what you remember conflicts with the data above, trust the data and say so. Rules of thumb:
- Few companies sustain growth above 25% for long; fade unusual growth toward about 5% (long-run nominal GDP) unless you can name the reason it persists.
- Over time, Adj FCF margin is usually at or below operating margin; explain any year where it is higher.
- Treat one-off charges or gains in the TTM or latest year as one-offs: normalise margins rather than extrapolating them.
- The long-run market EV/EBIT is about 15–20x; justify anything above 25x or below 8x.
- Use decimals: 0.12 means 12%.

## Answer format
First, up to five short bullet points per scenario explaining the key drivers. Then end with exactly one JSON code block in this shape (the app reads only this block; keep every key, ${horizon} years per scenario, numbers only):

\`\`\`json
{
  "ticker": "${snapshot.ticker}",
  "scenarios": {
${KINDS.map(example).join(',\n')}
  }
}
\`\`\``;
}

export interface ParsedScenario {
  years: ScenarioYearInput[];
  exitMultiple: number | null;
}

export interface ParsedForecast {
  horizon: HorizonYears;
  scenarios: Partial<Record<ScenarioKind, ParsedScenario>>;
  warnings: string[];
}

export type ParseResult = { ok: true; value: ParsedForecast } | { ok: false; error: string };

/** The JSON object in an answer: the last fenced block that parses, else the outermost braces. */
function extractJson(text: string): unknown {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]!);
  for (const b of blocks.reverse()) {
    try {
      return JSON.parse(b);
    } catch {
      /* try the next */
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[%x×,\s]/gi, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
};

export function parseForecastAnswer(text: string): ParseResult {
  const json = extractJson(text);
  if (json == null || typeof json !== 'object') {
    return { ok: false, error: "Couldn't find the JSON block. Paste the whole answer, including the ```json block at the end." };
  }
  const root = json as Record<string, unknown>;
  const container = (
    root.scenarios && typeof root.scenarios === 'object' ? root.scenarios : root
  ) as Record<string, unknown>;

  const raw: Partial<Record<ScenarioKind, { years: number[][]; exit: number | null }>> = {};
  for (const kind of KINDS) {
    const key = Object.keys(container).find((k) => k.toLowerCase() === kind);
    const sc = key ? (container[key] as Record<string, unknown>) : undefined;
    if (!sc || typeof sc !== 'object') continue;
    const ys = pick(sc, ['years', 'forecast']);
    if (!Array.isArray(ys) || ys.length === 0) {
      return { ok: false, error: `The ${kind} scenario has no "years" list.` };
    }
    const years: number[][] = [];
    for (const [i, y] of ys.entries()) {
      const o = (y ?? {}) as Record<string, unknown>;
      const g = asNumber(pick(o, ['revenueGrowth', 'revenueYoY', 'growth', 'revGrowth']));
      const om = asNumber(pick(o, ['operatingMargin', 'opMargin', 'ebitMargin']));
      const fm = asNumber(pick(o, ['adjFcfMargin', 'fcfMargin', 'adjFCFMargin']));
      if (g == null || om == null || fm == null) {
        return {
          ok: false,
          error: `${kind} year ${i + 1}: needs revenueGrowth, operatingMargin and adjFcfMargin as numbers.`,
        };
      }
      years.push([g, om, fm]);
    }
    raw[kind] = { years, exit: asNumber(pick(sc, ['exitMultiple', 'exitEvEbit', 'exit'])) };
  }
  const kinds = KINDS.filter((k) => raw[k]);
  if (kinds.length === 0) {
    return { ok: false, error: 'No bear, base or bull scenario found in the JSON.' };
  }
  const lengths = new Set(kinds.map((k) => raw[k]!.years.length));
  const n = [...lengths][0]!;
  if (lengths.size > 1 || (n !== 3 && n !== 5)) {
    return { ok: false, error: 'Each scenario needs the same number of years: 3 or 5.' };
  }

  // Percent units instead of decimals: a 150% margin is not a real answer
  const warnings: string[] = [];
  const all = kinds.flatMap((k) => raw[k]!.years);
  const percentUnits = all.some(([, om, fm]) => Math.abs(om!) > 1.5 || Math.abs(fm!) > 1.5);
  if (percentUnits) warnings.push('Read the values as percentages (12 = 12%).');
  const scale = percentUnits ? 0.01 : 1;

  const scenarios: ParsedForecast['scenarios'] = {};
  for (const k of kinds) {
    const years = raw[k]!.years.map(([g, om, fm]) => ({
      revenueYoY: round4(g! * scale),
      operatingMargin: round4(om! * scale),
      adjFcfMargin: round4(fm! * scale),
    }));
    for (const y of years) {
      if (y.revenueYoY < -0.9 || y.revenueYoY > 3 || Math.abs(y.operatingMargin) > 1 || Math.abs(y.adjFcfMargin) > 1) {
        return { ok: false, error: `${k}: a value is outside a believable range; check the units (0.12 = 12%).` };
      }
    }
    let exitMultiple = raw[k]!.exit;
    if (exitMultiple != null && (exitMultiple <= 0 || exitMultiple > 200)) {
      warnings.push(`${k}: ignored exit multiple ${exitMultiple}.`);
      exitMultiple = null;
    }
    scenarios[k] = { years, exitMultiple };
  }
  const missing = KINDS.filter((k) => !raw[k]);
  if (missing.length) warnings.push(`No ${missing.join(' or ')} scenario: left unchanged.`);
  return { ok: true, value: { horizon: n as HorizonYears, scenarios, warnings } };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
