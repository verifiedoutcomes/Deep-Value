/**
 * Formula transparency: every key number can explain itself. Each builder
 * returns the sheet formula, the same formula with the LIVE numbers
 * substituted in, and a plain-English note — so the calculation can be
 * followed end-to-end from the UI, cell by cell, exactly as in the
 * original Google Sheet.
 */
import type {
  CapexTreatment,
  HorizonYears,
  ImpliedExpectations,
  Maybe,
  ScenarioInputs,
  ScenarioValuation,
  SensitivityGrid,
} from '@dvh/engine';
import type { ValuationAnchors } from '@dvh/engine';
import { IMPLIED_GROWTH_RANGE } from '@dvh/engine';
import { money, num, pct, price } from './format';

export interface FormulaSpec {
  title: string;
  /** Original sheet cell, so the app can be audited against the xlsx
   *  (for app-only analyses: what it is instead, e.g. "reverse DCF"). */
  cell: string;
  /** 'app' marks an analysis the sheet does not have. Default 'sheet'. */
  origin?: 'sheet' | 'app';
  formula: string;
  /** The formula again, with live numbers substituted, then the result. */
  steps: string[];
  note?: string;
}

const m = (v: Maybe) => money(v);

export function fairValueFormula(
  v: ScenarioValuation,
  a: ValuationAnchors,
  horizon: HorizonYears,
): FormulaSpec {
  const pvSum = v.forecast.reduce((acc, f) => acc + f.pvOfAdjFcf, 0);
  return {
    title: 'Fair value today',
    cell: horizon === 5 ? 'Q63' : 'Q88',
    formula: 'fair value = (intrinsic value ÷ snapshot market cap) × price today',
    steps: [
      `intrinsic value = Σ PV(FCF) + PV(terminal cap)`,
      `  Σ PV(FCF) = ${m(pvSum)}`,
      `  terminal cap = ${m(v.terminalMarketCap)} discounted ${horizon} periods = ${m(
        (v.intrinsicValue ?? 0) - pvSum,
      )}`,
      `  intrinsic = ${m(v.intrinsicValue)}`,
      `fair value = (${m(v.intrinsicValue)} ÷ ${m(a.snapshotMarketCap)}) × ${price(a.price)}`,
      `           = ${price(v.fairValuePerShare)}`,
    ],
    note: 'Terminal cap = final-year operating income × exit multiple − net debt + adjustment.',
  };
}

export function irrFormula(
  v: ScenarioValuation,
  a: ValuationAnchors,
  horizon: HorizonYears,
): FormulaSpec {
  const flows = [
    `year 0: −${m(a.snapshotMarketCap)}  (buy the whole company at snapshot cap)`,
    ...v.forecast.map((f, i) =>
      i === v.forecast.length - 1
        ? `year ${i + 1}: ${m(f.adjFcf)} + ${m(v.terminalMarketCap)} (final FCF + terminal cap)`
        : `year ${i + 1}: ${m(f.adjFcf)}`,
    ),
  ];
  return {
    title: 'Scenario IRR',
    cell: horizon === 5 ? 'Q61' : 'Q86',
    formula: 'IRR = the discount rate at which these cash flows sum to zero',
    steps: [...flows, `IRR = ${pct(v.irr, 2)}`],
    note:
      'Terminal cap = final-year op income × exit EV/EBIT − net debt + adjustment. Solved by Newton–Raphson with a bisection fallback, matching Excel.',
  };
}

export function pvOfFcfFormula(
  year: number,
  t: number,
  fcf: number,
  rate: number,
  pv: number,
): FormulaSpec {
  return {
    title: `PV of ${year} Adj FCF`,
    cell: 'J column',
    formula: 'PV = FCF ÷ (1 + discount rate)^year-index',
    steps: [
      `PV = ${m(fcf)} ÷ (1 + ${pct(rate)})^${t + 1}`,
      `   = ${m(pv)}`,
    ],
    note: 'Year 1 is discounted one period.',
  };
}

export function forecastRevenueFormula(
  year: number,
  prev: number,
  yoy: number,
  rev: number,
  isFirst: boolean,
): FormulaSpec {
  return {
    title: `${year} revenue`,
    cell: 'D column',
    formula: isFirst
      ? 'revenue = TTM revenue × (1 + growth)'
      : 'revenue = prior forecast year × (1 + growth)',
    steps: [`= ${m(prev)} × (1 + ${pct(yoy)})`, `= ${m(rev)}`],
  };
}

/** One line on how historical Adj FCF is defined under each treatment. */
export function capexTreatmentNote(t: CapexTreatment): string {
  return t === 'conventional'
    ? 'Historical Adj FCF = OCF − |capex| − SBC (conventional: all capex is a cost).'
    : t === 'owner'
      ? 'Historical Adj FCF = OCF − D&A − SBC (owner earnings: D&A stands in for maintenance capex).'
      : 'Historical Adj FCF = OCF + |capex| − SBC (sheet convention: capex stored negative, so it adds back).';
}

export function adjFcfMarginFormula(
  year: number,
  rev: number,
  margin: number,
  fcf: number,
  treatment: CapexTreatment = 'sheet',
): FormulaSpec {
  return {
    title: `${year} Adj FCF`,
    cell: 'I column',
    formula: 'Adj FCF = FCF margin × revenue',
    steps: [`= ${pct(margin)} × ${m(rev)}`, `= ${m(fcf)}`],
    note: `The seeded FCF margin is TTM Adj FCF ÷ TTM revenue. ${capexTreatmentNote(treatment)}`,
  };
}

export function exitMultipleFormula(
  horizon: HorizonYears,
  value: number,
  seeded5: number,
  currentEvEbit: Maybe,
  trimmedMean: Maybe,
): FormulaSpec {
  // App mode: every scenario seeds from the trimmed mean and every 3-year
  // multiple is the 5-year one − 2 (the sheet: current EV/EBIT; bear −3).
  const seedLabel =
    trimmedMean != null && Math.abs(seeded5 - trimmedMean) < 1e-9
      ? 'trimmed-mean EV/EBIT'
      : 'current EV/EBIT';
  return {
    title: 'Exit EV/EBIT multiple',
    cell: horizon === 5 ? 'N61' : 'N86',
    formula:
      horizon === 5
        ? `default = ${seedLabel} (40% trimmed mean of fiscal-year EV/EBIT, S54); editable`
        : '3-year multiple = 5-year multiple − 2; editable',
    steps:
      horizon === 5
        ? [
            `trimmed-mean EV/EBIT = ${num(trimmedMean, 2)}×`,
            `current EV/EBIT = ${num(currentEvEbit, 2)}×`,
            `seeded = ${num(seeded5, 2)}× · in use = ${num(value, 2)}×`,
          ]
        : [`= ${num(value + 2, 2)} − 2`, `= ${num(value, 2)}×`],
    note:
      'Seeding from the trimmed mean assumes the multiple reverts to its own history by the exit year (the sheet seeds today\'s multiple, which assumes no re-rating). Terminal EV = final-year operating income × this multiple; terminal market cap = terminal EV − net debt + adjustment.',
  };
}

export function impliedFormula(
  imp: ImpliedExpectations,
  a: ValuationAnchors,
  inputs: ScenarioInputs,
  horizon: HorizonYears,
): FormulaSpec {
  const r = inputs.terminalDiscountRate;
  const growthLine =
    imp.revenueGrowth.value != null
      ? `g* = ${pct(imp.revenueGrowth.value, 2)}/yr → ${horizon}-yr revenue ${m(
          a.ttmRevenue * Math.pow(1 + imp.revenueGrowth.value, horizon),
        )} vs TTM ${m(a.ttmRevenue)}`
      : imp.revenueGrowth.bound === 'below'
        ? `even ${pct(IMPLIED_GROWTH_RANGE[0], 0)}/yr leaves value above the price`
        : imp.revenueGrowth.bound === 'above'
          ? `even ${pct(IMPLIED_GROWTH_RANGE[1], 0)}/yr leaves value below the price`
          : 'no solution: the final-year operating margin is not positive';
  const multipleLine =
    imp.exitMultiple.value != null
      ? `m* = ${num(imp.exitMultiple.value, 2)}×`
      : imp.exitMultiple.bound === 'below'
        ? 'the forecast cash flows alone exceed the price (no terminal value needed)'
        : 'no solution: final-year operating income is not positive';
  return {
    title: 'What the price implies',
    cell: 'reverse DCF',
    origin: 'app',
    formula: 'solve intrinsic value = snapshot market cap  ⇔  fair value = price  ⇔  IRR = discount rate',
    steps: [
      `target = ${m(a.snapshotMarketCap)} at ${pct(r)} discount rate`,
      'growth: one constant rate replaces your growth path; your margins, multiple and rates stay',
      `  ${growthLine}`,
      `  your path compounds at ${pct(imp.scenarioGrowthCagr, 2)}/yr`,
      'exit multiple: intrinsic value is linear in it, so it solves exactly',
      '  m* = ((cap − Σ PV FCF) × (1 + r)^n + net debt − adjustment) ÷ final-year op income',
      `  ${multipleLine} vs your ${num(imp.scenarioExitMultiple, 2)}×`,
    ],
    note:
      'Implied below yours means the price asks for less than your scenario assumes: that gap is your margin of safety. Implied above yours means you are relying on more than the market is paying for.',
  };
}

export function sensitivityFormula(grid: SensitivityGrid, horizon: HorizonYears): FormulaSpec {
  const c = grid.fairValue[grid.current.row]![grid.current.col];
  return {
    title: 'Fair value sensitivity',
    cell: 'sensitivity grid',
    origin: 'app',
    formula: 'each cell re-runs this scenario with that exit multiple and discount rate',
    steps: [
      `columns: exit EV/EBIT ${grid.exitMultiples.map((x) => num(x, 1)).join(' · ')}`,
      `rows: discount rate ${grid.discountRates.map((x) => pct(x, 0)).join(' · ')}`,
      `centre = your inputs = ${price(c ?? null)}`,
      `fair value = (Σ PV FCF + PV terminal cap) ÷ snapshot cap × price, over ${horizon} years`,
    ],
    note: 'Green cells are above today\'s price, red below. Rates move the FCF and terminal discount rates together, so the centre always matches the headline fair value.',
  };
}

export function targetBuyFormula(threshold: number, fair: Maybe, target: Maybe): FormulaSpec {
  return {
    title: `Target buy · ${pct(threshold, 0)} margin of safety`,
    cell: 'R11:T11',
    formula: 'target = base fair value × (1 − margin of safety)',
    steps: [`= ${price(fair)} × (1 − ${pct(threshold, 0)})`, `= ${price(target)}`],
  };
}

export function irrStripFormula(
  gridPrice: number,
  a: ValuationAnchors,
  irrVal: Maybe,
): FormulaSpec {
  return {
    title: `IRR if bought at ${price(gridPrice)}`,
    cell: 'L16:T16',
    formula: 'same base-case cash flows, outlay scaled to the grid price',
    steps: [
      `outlay = −${m(a.snapshotMarketCap)} × (${price(gridPrice)} ÷ ${price(a.price)})`,
      `       = −${m(-a.snapshotMarketCap * (gridPrice / a.price) * -1)}`,
      `IRR = ${pct(irrVal, 2)}`,
    ],
    note: 'Grid is centred on round(price), stepped by round(price ÷ 10), four steps each way.',
  };
}

export function headerFormulas(vals: {
  marketCapLive: number;
  snapshotMarketCap: number;
  netIncome: Maybe;
  opIncome: Maybe;
  revenue: Maybe;
  netDebt: Maybe;
  adjFcf: Maybe;
  tangibleBook: Maybe;
  ocf: Maybe;
  sbc: Maybe;
}): Record<string, FormulaSpec> {
  const v = vals;
  const q53 = v.netDebt == null ? null : v.snapshotMarketCap + v.netDebt;
  return {
    peLive: {
      title: 'P/E (live cap)',
      cell: 'E10',
      formula: 'live market cap ÷ TTM net income',
      steps: [`= ${m(v.marketCapLive)} ÷ ${m(v.netIncome)}`],
      note: 'The snapshot P/E (Q120) divides the frozen snapshot cap instead — both exist and differ.',
    },
    peSnap: {
      title: 'P/E (snapshot cap)',
      cell: 'Q120',
      formula: 'snapshot market cap ÷ TTM net income',
      steps: [`= ${m(v.snapshotMarketCap)} ÷ ${m(v.netIncome)}`],
    },
    evOpInc: {
      title: 'EV ÷ operating income',
      cell: 'E11',
      formula: '(snapshot cap + net debt) ÷ TTM operating income',
      steps: [`= (${m(v.snapshotMarketCap)} + ${m(v.netDebt)}) ÷ ${m(v.opIncome)}`, `= ${m(q53)} ÷ ${m(v.opIncome)}`],
    },
    adjFcfYield: {
      title: 'Adj FCF yield',
      cell: 'E12',
      formula: 'TTM Adj FCF ÷ snapshot market cap',
      steps: [`= ${m(v.adjFcf)} ÷ ${m(v.snapshotMarketCap)}`],
      note: 'Adj FCF = OCF + |capex| − SBC (sheet convention: capex arrives negative).',
    },
    adjRoic: {
      title: 'Adj ROIC',
      cell: 'Q124',
      formula: 'TTM op income ÷ (tangible book + max(net debt, 0))',
      steps: [`= ${m(v.opIncome)} ÷ (${m(v.tangibleBook)} + ${m(v.netDebt != null && v.netDebt > 0 ? v.netDebt : 0)})`],
      note: 'Shows “Neg Book” when tangible book is negative.',
    },
    pAdjOcf: {
      title: 'P ÷ Adj OCF',
      cell: 'Q122',
      formula: 'snapshot cap ÷ (OCF − SBC)',
      steps: [`= ${m(v.snapshotMarketCap)} ÷ (${m(v.ocf)} − ${m(v.sbc)})`],
    },
  };
}
