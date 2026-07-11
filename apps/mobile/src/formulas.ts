/**
 * Formula transparency: every key number can explain itself. Each builder
 * returns the sheet formula, the same formula with the LIVE numbers
 * substituted in, and a plain-English note — so the calculation can be
 * followed end-to-end from the UI, cell by cell, exactly as in the
 * original Google Sheet.
 */
import type {
  HorizonYears,
  Maybe,
  ScenarioValuation,
} from '@dvh/engine';
import type { ValuationAnchors } from '@dvh/engine';
import { money, num, pct, price } from './format';

export interface FormulaSpec {
  title: string;
  /** Original sheet cell, so the app can be audited against the xlsx. */
  cell: string;
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
      `  terminal cap = ${m(v.terminalMarketCap)} discounted 5 periods = ${m(
        (v.intrinsicValue ?? 0) - pvSum,
      )}`,
      `  intrinsic = ${m(v.intrinsicValue)}`,
      `fair value = (${m(v.intrinsicValue)} ÷ ${m(a.snapshotMarketCap)}) × ${price(a.price)}`,
      `           = ${price(v.fairValuePerShare)}`,
    ],
    note:
      horizon === 3
        ? 'Sheet quirk kept for parity: the 3-year block still discounts its terminal cap five periods (N92 uses nper = 5).'
        : 'Terminal cap = final-year operating income × exit multiple − net debt + adjustment.',
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

export function adjFcfMarginFormula(year: number, rev: number, margin: number, fcf: number): FormulaSpec {
  return {
    title: `${year} Adj FCF`,
    cell: 'I column',
    formula: 'Adj FCF = FCF margin × revenue',
    steps: [`= ${pct(margin)} × ${m(rev)}`, `= ${m(fcf)}`],
    note: 'Historical Adj FCF = OCF + |capex| − SBC under the sheet convention (capex stored negative).',
  };
}

export function exitMultipleFormula(
  horizon: HorizonYears,
  kind: 'bear' | 'base' | 'bull',
  value: number,
  seeded5: number,
): FormulaSpec {
  const offset = kind === 'bear' ? 3 : 2;
  return {
    title: 'Exit EV/EBIT multiple',
    cell: horizon === 5 ? 'N61' : 'N86',
    formula:
      horizon === 5
        ? kind === 'base'
          ? 'default = current EV/EBIT (S53); editable'
          : 'default = 0 until you set one'
        : `3-year multiple = 5-year multiple − ${offset}`,
    steps:
      horizon === 5
        ? [`current EV/EBIT = ${num(seeded5, 4)}`, `in use = ${num(value, 4)}`]
        : [`= ${num(value + offset, 4)} − ${offset}`, `= ${num(value, 4)}`],
    note: 'Terminal EV = final-forecast-year operating income × this multiple. Terminal market cap = terminal EV − net debt + adjustment.',
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
