/**
 * SEC EDGAR XBRL company facts -> model fundamentals.
 *
 * Pure functions over one or more `companyfacts` documents: a company plus
 * any predecessor registrants (ExxonMobil's 2026 holding-company
 * reorganisation moved it to a new CIK with no annual history of its
 * own). Facts are public domain, free and need no key.
 *
 * Rules, each calibrated on the full S&P 500 + Nasdaq-100 universe:
 *  - every period takes its LATEST-filed value, so restatements win and a
 *    successor's comparatives beat its predecessor's originals;
 *  - annual = a 340–380 day duration from a 10-K; fiscal-year label = the
 *    year the period ends, except periods ending 1–10 January (52/53-week
 *    years that spill past 31 December) belong to the year before;
 *  - each field walks a tag list in priority order, per year, because
 *    filers change tags over time (SalesRevenueNet -> Revenues -> ...);
 *  - operating income falls back to revenue − total costs and expenses,
 *    then to pre-tax income + interest expense, and says so in `notes`;
 *  - TTM = latest FY + current 10-Q year-to-date − the same YTD a year
 *    earlier, all from ONE tag so windows never mix;
 *  - share counts must be recent; a reported count that disagrees with
 *    diluted weighted-average shares by more than 15% is treated as a
 *    single share class and replaced (Alphabet, Fox, News Corp, ...).
 */
import type { Maybe } from '@dvh/engine';
import type { AnnualFundamentals, TtmFundamentals } from './provider';

export interface SecFact {
  start?: string;
  end: string;
  val: number;
  accn?: string;
  fy?: number | null;
  fp?: string | null;
  form: string;
  filed: string;
  frame?: string;
}

export interface SecCompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { units: Record<string, SecFact[]> }>>;
}

/** A reported number with the date it was filed (for split adjustment). */
export interface Dated {
  val: number;
  end: string;
  filed: string;
}

const DAY = 86_400_000;
const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '10-KT', '10-KT/A']);
const QUARTER_FORMS = new Set(['10-Q', '10-Q/A']);

export const TAGS = {
  revenue: [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
    'RevenuesNetOfInterestExpense',
    'SalesRevenueGoodsNet',
    'RegulatedAndUnregulatedOperatingRevenue',
    'ElectricUtilityRevenue',
    'OperatingLeasesIncomeStatementLeaseRevenue',
    'OperatingLeaseLeaseIncome', // REITs whose revenue is rent
  ],
  netInterestIncome: ['InterestIncomeExpenseNet', 'InterestRevenueExpenseNet'],
  noninterestIncome: ['NoninterestIncome'],
  operatingIncome: ['OperatingIncomeLoss'],
  costsAndExpenses: ['CostsAndExpenses'],
  pretax: [
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomesticAndForeign',
  ],
  pretaxDomestic: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic'],
  pretaxForeign: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign'],
  incomeTax: ['IncomeTaxExpenseBenefit'],
  interest: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'InterestAndDebtExpense'],
  operatingCashFlow: [
    'NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  ],
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets',
    'PaymentsForCapitalImprovements',
    'PaymentsToAcquireOtherPropertyPlantAndEquipment',
  ],
  // sector-specific capex lines, used only when none of the above exist
  capexFallback: [
    'PaymentsToExploreAndDevelopOilAndGasProperties',
    'PaymentsForConstructionInProcess',
    'PaymentsToDevelopRealEstateAssets',
    'PaymentsToAcquireOtherProductiveAssets',
    'PaymentsToDevelopSoftware',
  ],
  sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
  da: [
    'DepreciationDepletionAndAmortization',
    'DepreciationAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
    'CostDepreciationAmortizationAndDepletion',
  ],
  depreciation: ['Depreciation'],
  amortization: ['AmortizationOfIntangibleAssets'],
  grossProfit: ['GrossProfit'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
  cash: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    'Cash',
    'CashAndDueFromBanks',
  ],
  debtNoncurrent: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'],
  debtTotalLongTerm: ['LongTermDebt'],
  debtCurrentTotal: ['DebtCurrent'],
  ltdCurrent: ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent'],
  shortBorrowings: ['ShortTermBorrowings'],
  financeLeaseTotal: ['FinanceLeaseLiability'],
  financeLeaseNoncurrent: ['FinanceLeaseLiabilityNoncurrent'],
  financeLeaseCurrent: ['FinanceLeaseLiabilityCurrent'],
  operatingLeaseTotal: ['OperatingLeaseLiability'],
  operatingLeaseNoncurrent: ['OperatingLeaseLiabilityNoncurrent'],
  operatingLeaseCurrent: ['OperatingLeaseLiabilityCurrent'],
  commercialPaper: ['CommercialPaper'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  goodwill: ['Goodwill'],
  intangibles: ['IntangibleAssetsNetExcludingGoodwill'],
  finiteIntangibles: ['FiniteLivedIntangibleAssetsNet'],
  indefiniteIntangibles: ['IndefiniteLivedIntangibleAssetsExcludingGoodwill'],
  sharesOutstanding: ['CommonStockSharesOutstanding'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  epsDiluted: ['EarningsPerShareDiluted'],
  // signals a bank/broker-style income statement (interest is operating)
  bankSignals: ['InterestExpenseDeposits', 'NoninterestIncome', 'InterestAndDividendIncomeOperating'],
} as const;

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;
const shift = (iso: string, years: number) => {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};
const near = (a: string, b: string, tol: number) => Math.abs(days(a, b)) <= tol;

/** Fiscal-year label for a period ending on `end` (see header). */
export function fiscalYearLabel(end: string): number {
  const y = Number(end.slice(0, 4));
  const m = Number(end.slice(5, 7));
  const d = Number(end.slice(8, 10));
  return m === 1 && d <= 10 ? y - 1 : y;
}

/** All facts for a tag across documents, in one unit. */
function facts(docs: SecCompanyFacts[], tag: string, unit: string, ns = 'us-gaap'): SecFact[] {
  const out: SecFact[] = [];
  for (const doc of docs) {
    const arr = doc.facts[ns]?.[tag]?.units[unit];
    if (arr) out.push(...arr);
  }
  return out;
}

/** Latest-filed fact per period, keyed by `${start}|${end}`. */
function latestByPeriod(arr: SecFact[]): Map<string, SecFact> {
  const m = new Map<string, SecFact>();
  for (const f of arr) {
    const k = `${f.start ?? ''}|${f.end}`;
    const cur = m.get(k);
    if (!cur || f.filed > cur.filed || (f.filed === cur.filed && (f.accn ?? '') > (cur.accn ?? ''))) {
      m.set(k, f);
    }
  }
  return m;
}

const isAnnual = (f: SecFact) =>
  f.start != null && ANNUAL_FORMS.has(f.form) && days(f.start, f.end) >= 340 && days(f.start, f.end) <= 380;

// annualByLabel is called per field, per year, per tag: memoise per docs
const annualMemo = new WeakMap<SecCompanyFacts[], Map<string, Map<number, SecFact>>>();

/** label -> annual fact for one tag (latest-ending period per label). */
function annualByLabel(docs: SecCompanyFacts[], tag: string, unit = 'USD'): Map<number, SecFact> {
  let byTag = annualMemo.get(docs);
  if (!byTag) annualMemo.set(docs, (byTag = new Map()));
  const key = `${tag}|${unit}`;
  const hit = byTag.get(key);
  if (hit) return hit;
  const out = new Map<number, SecFact>();
  byTag.set(key, out);
  for (const f of latestByPeriod(facts(docs, tag, unit).filter(isAnnual)).values()) {
    const label = fiscalYearLabel(f.end);
    const cur = out.get(label);
    if (!cur || f.end > cur.end) out.set(label, f);
  }
  return out;
}

/** A duration fact for exactly [start, end] (± a few days), latest filed. */
function durationFact(
  docs: SecCompanyFacts[],
  tag: string,
  start: string,
  end: string,
  unit = 'USD',
): SecFact | null {
  let best: SecFact | null = null;
  for (const f of facts(docs, tag, unit)) {
    if (f.start == null || !near(f.start, start, 10) || !near(f.end, end, 10)) continue;
    if (!best || f.filed > best.filed) best = f;
  }
  return best;
}

/** An instant fact within `tol` days of `date`, latest filed. */
function instantNear(
  docs: SecCompanyFacts[],
  tag: string,
  date: string,
  tol = 7,
  unit = 'USD',
  ns = 'us-gaap',
): SecFact | null {
  let best: SecFact | null = null;
  for (const f of facts(docs, tag, unit, ns)) {
    if (f.start != null || !near(f.end, date, tol)) continue;
    if (!best || f.filed > best.filed) best = f;
  }
  return best;
}

/** The latest instant on or after `since` (latest end, then latest filed). */
function latestInstant(
  docs: SecCompanyFacts[],
  tag: string,
  since: string,
  unit = 'USD',
  ns = 'us-gaap',
): SecFact | null {
  let best: SecFact | null = null;
  for (const f of facts(docs, tag, unit, ns)) {
    if (f.start != null || f.end < since) continue;
    if (!best || f.end > best.end || (f.end === best.end && f.filed > best.filed)) best = f;
  }
  return best;
}

function firstAnnual(docs: SecCompanyFacts[], tags: readonly string[], label: number): SecFact | null {
  for (const t of tags) {
    const f = annualByLabel(docs, t).get(label);
    if (f) return f;
  }
  return null;
}

function firstInstant(docs: SecCompanyFacts[], tags: readonly string[], date: string): Maybe {
  for (const t of tags) {
    const f = instantNear(docs, t, date);
    if (f) return f.val;
  }
  return null;
}

function firstLatestInstant(docs: SecCompanyFacts[], tags: readonly string[], since: string): Maybe {
  for (const t of tags) {
    const f = latestInstant(docs, t, since);
    if (f) return f.val;
  }
  return null;
}

/**
 * True when the filer presents a bank-style income statement: at least
 * two bank signals (one alone also turns up at O'Reilly, Nucor, Agilent).
 */
export function isBankLike(docs: SecCompanyFacts[]): boolean {
  return TAGS.bankSignals.filter((t) => facts(docs, t, 'USD').length > 0).length >= 2;
}

/**
 * Total debt at an instant, defined as the sheet's data did (FMP's
 * totalDebt): borrowings, current and noncurrent, plus finance AND
 * operating lease liabilities. Net debt = this − cash & equivalents.
 */
function debtAt(get: (tags: readonly string[]) => Maybe): Maybe {
  const borrowings = borrowingsAt(get);
  const leaseIn = get(['LongTermDebtAndCapitalLeaseObligations']) != null && get(['LongTermDebtNoncurrent']) == null;
  const finance = leaseIn
    ? 0
    : get(TAGS.financeLeaseTotal) ??
      (get(TAGS.financeLeaseNoncurrent) ?? 0) + (get(TAGS.financeLeaseCurrent) ?? 0);
  const operating =
    get(TAGS.operatingLeaseTotal) ??
    (get(TAGS.operatingLeaseNoncurrent) ?? 0) + (get(TAGS.operatingLeaseCurrent) ?? 0);
  if (borrowings == null && finance === 0 && operating === 0) return null;
  return (borrowings ?? 0) + finance + operating;
}

/** Borrowings: noncurrent + current, without double-counting. */
function borrowingsAt(get: (tags: readonly string[]) => Maybe): Maybe {
  const noncurrent = get(TAGS.debtNoncurrent);
  const ltdTotal = get(TAGS.debtTotalLongTerm); // includes current maturities
  const debtCurrent = get(TAGS.debtCurrentTotal); // current LTD + short-term borrowings
  const ltdCurrent = get(TAGS.ltdCurrent);
  const shortTerm = (get(TAGS.shortBorrowings) ?? 0) + (get(TAGS.commercialPaper) ?? 0);
  if (noncurrent != null) {
    return noncurrent + (debtCurrent ?? (ltdCurrent ?? 0) + shortTerm);
  }
  if (ltdTotal != null) {
    const nonLtdCurrent =
      debtCurrent != null ? Math.max(0, debtCurrent - (ltdCurrent ?? 0)) : shortTerm;
    return ltdTotal + nonLtdCurrent;
  }
  if (debtCurrent != null || ltdCurrent != null || shortTerm > 0) {
    return debtCurrent ?? (ltdCurrent ?? 0) + shortTerm;
  }
  return null;
}

interface FlowGetter {
  (tags: readonly string[]): Maybe;
}

/** The flow fields shared by annual and TTM extraction (revenue chosen by the caller). */
type Period = number | 'TTM';
type Note = (message: string) => void;

const notePeriods = new WeakMap<Set<string>, Map<string, { text: string; periods: Set<Period> }>>();

/**
 * A note-taker for one period. Each message is kept once, naming every
 * period it applies to ("… (FY2009–FY2011, TTM)."), so a gap in 2010
 * doesn't read as if it affected today's figures.
 */
function periodNote(notes: Set<string>, period: Period): Note {
  return (message) => {
    let byMessage = notePeriods.get(notes);
    if (!byMessage) notePeriods.set(notes, (byMessage = new Map()));
    const prev = byMessage.get(message);
    if (prev) notes.delete(prev.text);
    const periods = prev?.periods ?? new Set<Period>();
    periods.add(period);
    const text = `${message} (${formatPeriods(periods)}).`;
    byMessage.set(message, { text, periods });
    notes.add(text);
  };
}

export function formatPeriods(periods: Set<Period>): string {
  const years = [...periods].filter((p): p is number => p !== 'TTM').sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < years.length; ) {
    let j = i;
    while (j + 1 < years.length && years[j + 1] === years[j]! + 1) j++;
    parts.push(j === i ? `FY${years[i]}` : `FY${years[i]}–FY${years[j]}`);
    i = j + 1;
  }
  if (periods.has('TTM')) parts.push('TTM');
  return parts.join(', ');
}

function flowFields(
  get: FlowGetter,
  bankLike: boolean,
  note: Note,
  revenue: Maybe,
  /** TTM only: the fiscal year's interest, for when the 10-Qs don't tag it. */
  fiscalYearInterest: Maybe = null,
  /** TTM only: the fiscal year's D&A, the reference for picking capex. */
  fiscalYearDa: Maybe = null,
) {
  // Not reported as a line: pre-tax income + interest expense is the
  // standard EBIT proxy; "revenue − total costs" comes last because what
  // filers put in total costs varies (it gave a REIT an 83% margin).
  let operatingIncome = get(TAGS.operatingIncome);
  if (operatingIncome == null) {
    let pretax = get(TAGS.pretax);
    if (pretax == null) {
      const domestic = get(TAGS.pretaxDomestic);
      if (domestic != null) pretax = domestic + (get(TAGS.pretaxForeign) ?? 0);
    }
    if (pretax == null) {
      const ni = get(TAGS.netIncome);
      const tax = get(TAGS.incomeTax);
      if (ni != null && tax != null) pretax = ni + tax;
    }
    const costs = get(TAGS.costsAndExpenses);
    if (pretax != null) {
      let interest = bankLike ? 0 : get(TAGS.interest);
      if (interest == null && fiscalYearInterest != null) {
        // Genuine Parts stopped tagging interest after Q1: dropping it
        // would silently understate TTM operating income
        interest = fiscalYearInterest;
        note('Operating income adds back the fiscal year\'s interest expense: the latest 10-Qs don\'t tag it');
      } else if (interest == null) {
        note('No interest expense is tagged where operating income is approximated, so it is pre-tax income alone');
      }
      operatingIncome = pretax + (interest ?? 0);
      note(
        bankLike
          ? 'Operating income approximated by pre-tax income (bank-style statements: interest is operating)'
          : 'Operating income approximated by pre-tax income + interest expense: not reported as a line',
      );
    } else if (revenue != null && costs != null) {
      operatingIncome = revenue - costs;
      note('Operating income derived as revenue − total costs and expenses: not reported as a line');
    }
  }
  const da = daFrom(get);
  const capexOut = pickCapex(get, da ?? fiscalYearDa);
  let grossProfit = get(TAGS.grossProfit);
  if (grossProfit == null && revenue != null) {
    const cogs = get(TAGS.costOfRevenue);
    if (cogs != null) grossProfit = revenue - cogs;
  }
  return {
    revenue,
    operatingIncome,
    operatingCashFlow: get(TAGS.operatingCashFlow),
    // XBRL reports capex as a positive outflow; the model stores it negative
    capex: capexOut == null ? null : -Math.abs(capexOut),
    sbc: get(TAGS.sbc),
    depreciationAmortization: da,
    grossProfit,
    netIncome: get(TAGS.netIncome),
  };
}

type Flows = ReturnType<typeof flowFields>;

/**
 * Capex: the first standard tag, unless it is a sub-line. United Rentals
 * tags $0.2B of non-rental PP&E beside $2.4B of fleet purchases, and
 * Fidelity National $0.1B of PP&E beside $0.8B including capitalised
 * software. A capex line under half of D&A, or under a fifth of a larger
 * standard total that operating cash flow could fund, gives way to that
 * total (or to PP&E + "other" PP&E, which only add up together). The larger line is NOT taken by default: for
 * Williams and SBA it bundles acquisitions ($5.6B vs $2.6B of capex).
 * Sector-specific lines count only when no standard one exists.
 */
const PPE_PLUS_OTHER = 'PaymentsToAcquirePropertyPlantAndEquipment+Other';

/** One period's capex from one source (a tag, or PP&E + other PP&E). */
function capexFrom(get: FlowGetter, source: string): Maybe {
  if (source === PPE_PLUS_OTHER) {
    const [ppe, , , otherPpe] = TAGS.capex.map((t) => get([t]));
    return ppe != null && otherPpe != null ? Math.abs(ppe) + Math.abs(otherPpe) : null;
  }
  const v = get([source]);
  return v == null ? null : Math.abs(v);
}

/*
 * Decided per period, deliberately not anchored on one tag for all
 * years (as revenue is): tags change meaning over time, and anchoring
 * on the latest year's tag cut Verizon's 2009–2014 capex from ~$17B to
 * under $6B. The cost: PACCAR's lease-fleet purchases count in 2009–2018,
 * when its PP&E line was under half of D&A, and not since.
 */
function pickCapex(get: FlowGetter, da: Maybe): Maybe {
  const lines: number[] = [];
  for (const t of TAGS.capex) {
    const v = capexFrom(get, t);
    if (v != null) lines.push(v);
  }
  if (lines.length === 0) {
    for (const t of TAGS.capexFallback) {
      const v = capexFrom(get, t);
      if (v != null) return v;
    }
    return null;
  }
  const first = lines[0]!;
  const sum = capexFrom(get, PPE_PLUS_OTHER);
  const largest = Math.max(...lines, sum ?? 0);
  // A sub-line: under half of D&A; or under a fifth of a total that the
  // year's operating cash flow could fund (URI's D&A tag holds only
  // non-rental depreciation). A total beyond the cash flow bundles
  // acquisitions: Williams' 2014 line was $20.8B against $4.0B of capex.
  const ocf = get(TAGS.operatingCashFlow);
  const subLine =
    (da != null && first < 0.5 * Math.abs(da)) ||
    (largest >= 5 * first && ocf != null && largest <= Math.abs(ocf));
  return largest > first && subLine ? largest : first;
}

/** The most inclusive D&A line (the cash-flow add-back) among variants. */
function daFrom(get: FlowGetter): Maybe {
  const candidates = TAGS.da.map((t) => get([t])).filter((v): v is number => v != null);
  const dep = get(TAGS.depreciation);
  if (dep != null) candidates.push(dep + (get(TAGS.amortization) ?? 0));
  return candidates.length ? Math.max(...candidates) : null;
}

/** Gaps in the cash-flow lines that free cash flow needs. */
function settleCashFlowGaps(flows: Flows, note: Note): Flows {
  const out = { ...flows };
  if (out.sbc == null && out.operatingCashFlow != null) {
    // Usually small for the companies that bury it in "other" (Chevron,
    // Philip Morris, Southern); blanking free cash flow would be worse.
    out.sbc = 0;
    note('Stock-based compensation isn\'t in SEC\'s standard data: treated as zero, so free cash flow may be slightly overstated');
  }
  if (out.capex == null && out.operatingCashFlow != null) {
    note('Capital expenditure isn\'t in SEC\'s standard data, so free cash flow is blank');
  }
  return out;
}

function balanceFields(at: (tags: readonly string[]) => Maybe) {
  const equity = at(TAGS.equity);
  const goodwill = at(TAGS.goodwill) ?? 0;
  const intangibles =
    at(TAGS.intangibles) ??
    (at(TAGS.finiteIntangibles) ?? 0) + (at(TAGS.indefiniteIntangibles) ?? 0);
  return {
    totalDebt: debtAt(at),
    cash: at(TAGS.cash),
    tangibleBook: equity == null ? null : equity - goodwill - intangibles,
  };
}

const FIELD_NAMES: Record<keyof Flows, string> = {
  revenue: 'revenue',
  operatingIncome: 'operating income',
  operatingCashFlow: 'operating cash flow',
  capex: 'capex',
  sbc: 'stock-based compensation',
  depreciationAmortization: 'D&A',
  grossProfit: 'gross profit',
  netIncome: 'net income',
};

const BANK_DERIVED = 'net interest income + non-interest income';

/** Revenue candidates for one period: tag (or derivation) -> value. */
function revenueCandidates(
  get: FlowGetter,
  bankLike: boolean,
  operatingCashFlow: Maybe,
): Map<string, number> {
  const out = new Map<string, number>();
  const tags = bankLike
    ? ['RevenuesNetOfInterestExpense', 'Revenues'] // banks: ASC 606 revenue is fees only
    : TAGS.revenue;
  for (const t of tags) {
    const v = get([t]);
    if (v != null) out.set(t, v);
  }
  if (bankLike) {
    const nii = get(TAGS.netInterestIncome);
    const nonInterest = get(TAGS.noninterestIncome);
    if (nii != null && nonInterest != null) out.set(BANK_DERIVED, nii + nonInterest);
  }
  // net of excise taxes is the standard presentation (Philip Morris, Altria)
  if (out.has('RevenueFromContractWithCustomerExcludingAssessedTax')) {
    out.delete('RevenueFromContractWithCustomerIncludingAssessedTax');
  }
  // a sub-item tagged as revenue (a REIT's "other" contract revenue) is
  // implausibly small against the cash the business generates
  for (const [k, v] of out) {
    if (!(v > 0) || (operatingCashFlow != null && v < 0.2 * Math.abs(operatingCashFlow))) out.delete(k);
  }
  return out;
}

/**
 * Pick revenue across years from one consistent definition: the anchor
 * is the LARGEST plausible candidate in the latest year (General Mills'
 * "Revenues" tag is a $2B sub-item beside $19B of contract revenue).
 * Other years use the anchor; where it is missing, the candidate closest
 * to the neighbouring year, within 0.5–2×, else nothing (a gap beats a
 * figure on a different basis).
 */
function chooseRevenue(byLabel: Map<number, Map<string, number>>): {
  values: Map<number, number>;
  anchor: string | null;
} {
  const labels = [...byLabel.keys()].sort((a, b) => b - a); // latest first
  const values = new Map<number, number>();
  const latest = labels.find((l) => byLabel.get(l)!.size > 0);
  if (latest == null) return { values, anchor: null };
  let anchor: string | null = null;
  for (const [k, v] of byLabel.get(latest)!) {
    if (anchor == null || v > byLabel.get(latest)!.get(anchor)!) anchor = k;
  }
  let reference: number | null = null;
  for (const l of labels) {
    const c = byLabel.get(l)!;
    let v: number | null = anchor != null && c.has(anchor) ? c.get(anchor)! : null;
    if (v == null && reference != null) {
      let best: number | null = null;
      for (const x of c.values()) {
        const r = x / reference;
        if (r < 0.5 || r > 2) continue;
        if (best == null || Math.abs(Math.log(r)) < Math.abs(Math.log(best / reference))) best = x;
      }
      v = best;
    }
    if (v != null) {
      values.set(l, v);
      reference = v;
    }
  }
  return { values, anchor };
}

/** Share counts below this are scale errors (reported in millions). */
const MIN_SHARES = 100_000;

/**
 * A total share count from reported candidates. Net income ÷ diluted EPS
 * (dollars over dollars-per-share) can't carry a share-count scale error,
 * so when it exists every candidate must land within 50% of it
 * (McDonald's tags diluted shares in millions: 711 for 711,000,000).
 * Reported counts more than 15% from diluted shares are one class only.
 */
function pickShares(
  reported: (SecFact | null)[],
  diluted: SecFact | null,
  ref: { val: number; end: string; filed: string } | null,
): Dated | null {
  const sane = (f: SecFact | null): f is SecFact =>
    f != null && f.val >= MIN_SHARES && (ref == null || Math.abs(f.val / ref.val - 1) <= 0.5);
  const dil = sane(diluted) ? diluted : null;
  const ok = reported
    .filter(sane)
    .filter((f) => dil == null || Math.abs(f.val / dil.val - 1) <= 0.15)
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : a.filed < b.filed ? 1 : -1));
  const pick = ok[0] ?? dil;
  if (pick) return { val: pick.val, end: pick.end, filed: pick.filed };
  if (ref && ref.val >= MIN_SHARES) return ref;
  return null;
}

/**
 * Shares at a fiscal year end, with the filing date (for split
 * adjustment): balance-sheet shares, else the 10-K cover count, else
 * annual diluted weighted-average, else net income ÷ diluted EPS. A
 * balance-sheet count >15% away from diluted shares is one class only.
 */
function sharesAtYearEnd(docs: SecCompanyFacts[], label: number, end: string): Dated | null {
  const diluted = annualByLabel(docs, TAGS.dilutedShares[0], 'shares').get(label) ?? null;
  const cso = instantNear(docs, TAGS.sharesOutstanding[0], end, 7, 'shares');
  const cover = (() => {
    let best: SecFact | null = null;
    for (const f of facts(docs, 'EntityCommonStockSharesOutstanding', 'shares', 'dei')) {
      const gap = days(end, f.end);
      if (gap < 0 || gap > 120 || !ANNUAL_FORMS.has(f.form)) continue;
      if (!best || f.filed > best.filed) best = f;
    }
    return best;
  })();
  const ni = annualByLabel(docs, 'NetIncomeLoss').get(label);
  const eps = annualByLabel(docs, TAGS.epsDiluted[0], 'USD/shares').get(label);
  const ref =
    ni && eps && eps.val !== 0 && ni.val / eps.val > 0
      ? { val: ni.val / eps.val, end: ni.end, filed: ni.filed }
      : null;
  return pickShares([cso, cover], diluted, ref);
}

/** The revenue definition chosen for each document set (TTM reuses it). */
const revenueAnchors = new WeakMap<SecCompanyFacts[], string | null>();

export interface AnnualExtraction extends AnnualFundamentals {
  /** Share count with its filing date, for split adjustment. */
  sharesDated: Dated | null;
}

/** Annual fundamentals for every fiscal year from `sinceYear`. */
export function extractAnnuals(
  docs: SecCompanyFacts[],
  sinceYear: number,
  notes: Set<string> = new Set(),
): AnnualExtraction[] {
  const bankLike = isBankLike(docs);
  // fiscal-year ends: union of revenue, net income and OCF periods
  const ends = new Map<number, string>();
  for (const tags of [TAGS.revenue, TAGS.netIncome, TAGS.operatingCashFlow]) {
    for (const t of tags) {
      for (const [label, f] of annualByLabel(docs, t)) {
        if (!ends.has(label) || f.end > ends.get(label)!) ends.set(label, f.end);
      }
    }
  }
  const getterFor = (label: number): FlowGetter => {
    const end = ends.get(label)!;
    return (tags) => {
      const f = firstAnnual(docs, tags, label);
      // must be the same fiscal period, not a neighbouring one
      return f != null && near(f.end, end, 10) ? f.val : null;
    };
  };
  const labels = [...ends.keys()].filter((l) => l >= sinceYear).sort((a, b) => a - b);
  const { values: revenueByLabel, anchor } = chooseRevenue(
    new Map(
      labels.map((l) => {
        const get = getterFor(l);
        return [l, revenueCandidates(get, bankLike, get(TAGS.operatingCashFlow))];
      }),
    ),
  );
  if (anchor === BANK_DERIVED) notes.add('Revenue = net interest income + non-interest income (bank presentation).');
  revenueAnchors.set(docs, anchor);
  const out: AnnualExtraction[] = [];
  for (const label of labels) {
    const end = ends.get(label)!;
    const get = getterFor(label);
    const note = periodNote(notes, label);
    const flows = settleCashFlowGaps(
      flowFields(get, bankLike, note, revenueByLabel.get(label) ?? null),
      note,
    );
    if (flows.revenue == null && flows.netIncome == null) continue;
    const bal = balanceFields((tags) => firstInstant(docs, tags, end));
    const sharesDated = sharesAtYearEnd(docs, label, end);
    out.push({
      fiscalYear: label,
      fiscalYearEnd: end,
      ...flows,
      ...bal,
      shares: sharesDated?.val ?? null,
      sharesDated,
      marketCap: null, // needs prices: the market provider fills these
      enterpriseValue: null,
      roic: null,
    });
  }
  return out;
}

/** The latest 10-Q year-to-date window that begins right after `fyEnd`. */
function latestYtdWindow(docs: SecCompanyFacts[], fyEnd: string): { start: string; end: string } | null {
  let best: { start: string; end: string } | null = null;
  for (const t of [...TAGS.revenue, ...TAGS.netIncome]) {
    for (const f of facts(docs, t, 'USD')) {
      if (f.start == null || !QUARTER_FORMS.has(f.form)) continue;
      const gap = days(fyEnd, f.start);
      if (gap < 0 || gap > 20) continue;
      if (!best || f.end > best.end) best = { start: f.start, end: f.end };
    }
  }
  return best;
}

/**
 * Trailing twelve months: FY + current YTD − YTD a year earlier, each
 * field from a single tag; balance sheet from the latest instant. Falls
 * back to the latest fiscal year when no 10-Q followed it.
 */
export function extractTtm(
  docs: SecCompanyFacts[],
  annuals: AnnualExtraction[],
  notes: Set<string> = new Set(),
): TtmFundamentals & { sharesDated: Dated | null } {
  const latest = annuals[annuals.length - 1];
  if (!latest) throw new Error('EDGAR: no annual data');
  const prior = annuals.find((a) => a.fiscalYear === latest.fiscalYear - 1);
  const fyEnd = latest.fiscalYearEnd!;
  const label = latest.fiscalYear;
  const win = latestYtdWindow(docs, fyEnd);
  const bankLike = isBankLike(docs);
  const sharesDated = latestShares(docs, fyEnd);

  const { fiscalYear: _fy, sharesDated: _sd, ...base } = latest;
  if (!win) {
    return { ...base, asOf: fyEnd, priorTtmRevenue: prior?.revenue ?? null, sharesDated };
  }
  const roll: FlowGetter = (tags) => {
    for (const t of tags) {
      const fy = annualByLabel(docs, t).get(label);
      if (!fy || !near(fy.end, fyEnd, 10)) continue;
      const cur = durationFact(docs, t, win.start, win.end);
      const ago = durationFact(docs, t, shift(win.start, -1), shift(win.end, -1));
      if (cur && ago) return fy.val + cur.val - ago.val;
    }
    return null;
  };
  const anchor = revenueAnchors.get(docs) ?? null;
  let ttmRevenue: Maybe = null;
  if (anchor === BANK_DERIVED) {
    const nii = roll(TAGS.netInterestIncome);
    const nonInterest = roll(TAGS.noninterestIncome);
    ttmRevenue = nii != null && nonInterest != null ? nii + nonInterest : null;
  } else if (anchor != null) {
    ttmRevenue = roll([anchor]);
  }
  // a rolled figure far from the fiscal year means the windows didn't match
  if (ttmRevenue != null && latest.revenue != null) {
    const r = ttmRevenue / latest.revenue;
    if (r < 0.5 || r > 2.5) ttmRevenue = null;
  }
  const fyGet: FlowGetter = (tags) => {
    for (const t of tags) {
      const fy = annualByLabel(docs, t).get(label);
      if (fy && near(fy.end, fyEnd, 10)) return fy.val;
    }
    return null;
  };
  const ttmNote = periodNote(notes, 'TTM');
  const rolled = flowFields(
    roll,
    bankLike,
    ttmNote,
    ttmRevenue,
    fyGet(TAGS.interest),
    latest.depreciationAmortization,
  );
  if (rolled.revenue == null || rolled.netIncome == null) {
    return { ...base, asOf: fyEnd, priorTtmRevenue: prior?.revenue ?? null, sharesDated };
  }
  // A secondary field the 10-Qs don't carry keeps its fiscal-year value
  // (flagged), rather than blanking free cash flow for the whole company;
  // only then does a still-missing SBC default to zero.
  const filled = { ...rolled };
  const kept: string[] = [];
  for (const k of Object.keys(filled) as (keyof Flows)[]) {
    if (filled[k] == null && base[k] != null) {
      filled[k] = base[k] as number;
      kept.push(FIELD_NAMES[k]);
    }
  }
  if (kept.length) {
    notes.add(`TTM uses fiscal-year figures for ${kept.join(', ')}: the 10-Qs don't tag them.`);
  }
  const flows = settleCashFlowGaps(filled, ttmNote);
  const bal = balanceFields((tags) => firstLatestInstant(docs, tags, fyEnd));
  let priorTtmRevenue: Maybe = null;
  for (const t of TAGS.revenue) {
    const fyPrior = annualByLabel(docs, t).get(label - 1);
    const ago = durationFact(docs, t, shift(win.start, -1), shift(win.end, -1));
    const ago2 = durationFact(docs, t, shift(win.start, -2), shift(win.end, -2));
    if (fyPrior && ago && ago2) {
      priorTtmRevenue = fyPrior.val + ago.val - ago2.val;
      break;
    }
  }
  return {
    ...base,
    ...flows,
    totalDebt: bal.totalDebt ?? base.totalDebt,
    cash: bal.cash ?? base.cash,
    tangibleBook: bal.tangibleBook ?? base.tangibleBook,
    shares: sharesDated?.val ?? base.shares,
    asOf: win.end,
    priorTtmRevenue,
    sharesDated,
  };
}

/**
 * The most current total share count. Candidates must be recent (within
 * 120 days before the latest fiscal year end or after it): the 10-K/10-Q
 * cover count, balance-sheet shares, the latest quarter's diluted
 * weighted average, or that quarter's net income ÷ diluted EPS. A cover
 * or balance-sheet count >15% away from diluted shares is a single class.
 */
export function latestShares(docs: SecCompanyFacts[], fyEnd: string): Dated | null {
  const since = shift(fyEnd, 0);
  const recentFrom = new Date(Date.parse(since) - 120 * DAY).toISOString().slice(0, 10);
  const cover = latestInstant(docs, 'EntityCommonStockSharesOutstanding', recentFrom, 'shares', 'dei');
  const cso = latestInstant(docs, TAGS.sharesOutstanding[0], recentFrom, 'shares');
  const quarterly = (tag: string, unit: string) => {
    let best: SecFact | null = null;
    for (const f of facts(docs, tag, unit)) {
      if (f.start == null || f.end < recentFrom) continue;
      const len = days(f.start, f.end);
      if (len < 80 || len > 100) continue;
      if (!best || f.end > best.end || (f.end === best.end && f.filed > best.filed)) best = f;
    }
    return best;
  };
  const diluted = quarterly(TAGS.dilutedShares[0], 'shares');
  const ni = quarterly('NetIncomeLoss', 'USD');
  const eps = quarterly(TAGS.epsDiluted[0], 'USD/shares');
  const ref =
    ni && eps && eps.end === ni.end && eps.val !== 0 && ni.val / eps.val > 0
      ? { val: ni.val / eps.val, end: ni.end, filed: ni.filed }
      : null;
  return pickShares([cover, cso], diluted, ref);
}

/** Reporting currency check: the model only takes USD statements. */
export function reportsInUsd(docs: SecCompanyFacts[]): boolean {
  return TAGS.revenue.some((t) => facts(docs, t, 'USD').some(isAnnual)) ||
    TAGS.netIncome.some((t) => facts(docs, t, 'USD').some(isAnnual));
}
