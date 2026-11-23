/**
 * The SEC extraction rules, each pinned to the real filing pattern that
 * motivated it (company named in each test). Synthetic facts, dated
 * relative to today so nothing ages out.
 */
import { describe, expect, it } from 'vitest';
import {
  FreeProvider,
  UsdOnlyFxTable,
  cleanShareSeries,
  extractAnnuals,
  extractTtm,
  fiscalYearLabel,
  formatPeriods,
  isBankLike,
  loadCompanySnapshot,
  sharesToday,
  type SecCompanyFacts,
  type SecFact,
} from '../src/index';

const Y = new Date().getFullYear() - 1; // latest completed fiscal year
const fy = (y: number, val: number, filed = `${y + 1}-02-15`): SecFact => ({
  start: `${y}-01-01`, end: `${y}-12-31`, val, form: '10-K', filed,
});
const at = (date: string, val: number, form = '10-K', filed?: string): SecFact => ({
  end: date, val, form, filed: filed ?? date.replace(/^(\d{4})/, (m) => String(Number(m) + 1)),
});

type Spec = Record<string, SecFact[]>;
function doc(usd: Spec, shares: Spec = {}, perShare: Spec = {}, dei: Spec = {}): SecCompanyFacts {
  const g: SecCompanyFacts['facts'][string] = {};
  for (const [t, a] of Object.entries(usd)) g[t] = { units: { USD: a } };
  for (const [t, a] of Object.entries(shares)) g[t] = { units: { ...(g[t]?.units ?? {}), shares: a } };
  for (const [t, a] of Object.entries(perShare)) g[t] = { units: { 'USD/shares': a } };
  const d: SecCompanyFacts['facts'][string] = {};
  for (const [t, a] of Object.entries(dei)) d[t] = { units: { shares: a } };
  return { cik: 1, entityName: 'Synthetic', facts: { 'us-gaap': g, dei: d } };
}
const years = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const base = (y0: number) => ({
  NetIncomeLoss: years(y0, Y).map((y) => fy(y, 10)),
  NetCashProvidedByUsedInOperatingActivities: years(y0, Y).map((y) => fy(y, 20)),
  OperatingIncomeLoss: years(y0, Y).map((y) => fy(y, 15)),
  PaymentsToAcquirePropertyPlantAndEquipment: years(y0, Y).map((y) => fy(y, 5)),
  ShareBasedCompensation: years(y0, Y).map((y) => fy(y, 1)),
});

describe('fiscal-year labels', () => {
  it('names a year by its end, except 52/53-week years ending in early January', () => {
    expect(fiscalYearLabel('2026-01-02')).toBe(2025); // L3Harris-style
    expect(fiscalYearLabel('2026-01-25')).toBe(2026); // NVIDIA's own naming
    expect(fiscalYearLabel('2025-06-30')).toBe(2025); // Microsoft
  });
});

describe('revenue: one consistent definition across years', () => {
  it('anchors on the largest plausible tag (General Mills: "Revenues" was a $2B sub-item)', () => {
    const a = extractAnnuals(
      [doc({
        ...base(Y - 3),
        Revenues: years(Y - 3, Y - 1).map((y) => fy(y, 20)),
        RevenueFromContractWithCustomerExcludingAssessedTax: years(Y - 3, Y).map((y) => fy(y, 190)),
      })],
      2007,
    );
    expect(a.map((r) => r.revenue)).toEqual([190, 190, 190, 190]);
  });

  it('uses net-of-excise revenue when both bases exist (Philip Morris)', () => {
    const a = extractAnnuals(
      [doc({
        ...base(Y),
        RevenueFromContractWithCustomerExcludingAssessedTax: [fy(Y, 400)],
        RevenueFromContractWithCustomerIncludingAssessedTax: [fy(Y, 800)],
      })],
      2007,
    );
    expect(a.at(-1)!.revenue).toBe(400);
  });

  it('falls back to another tag only when it stays continuous; else leaves a gap', () => {
    const a = extractAnnuals(
      [doc({
        ...base(Y - 2),
        RevenueFromContractWithCustomerExcludingAssessedTax: [fy(Y - 1, 100), fy(Y, 110)],
        SalesRevenueNet: [fy(Y - 2, 95)],
      })],
      2007,
    );
    expect(a.map((r) => r.revenue)).toEqual([95, 100, 110]);
    const b = extractAnnuals(
      [doc({
        ...base(Y - 2),
        RevenueFromContractWithCustomerExcludingAssessedTax: [fy(Y - 1, 100), fy(Y, 110)],
        SalesRevenueNet: [fy(Y - 2, 250)], // gross of excise: a different basis
      })],
      2007,
    );
    expect(b.map((r) => r.revenue)).toEqual([null, 100, 110]);
  });

  it('drops a candidate implausibly small against operating cash flow (REIT "other revenue")', () => {
    const a = extractAnnuals(
      [doc({
        ...base(Y),
        RevenueFromContractWithCustomerExcludingAssessedTax: [fy(Y, 1)],
        OperatingLeaseLeaseIncome: [fy(Y, 150)],
      })],
      2007,
    );
    expect(a.at(-1)!.revenue).toBe(150);
  });
});

describe('banks', () => {
  const bank = (signals: string[]) =>
    doc({
      ...base(Y),
      InterestIncomeExpenseNet: [fy(Y, 60)],
      NoninterestIncome: [fy(Y, 40)],
      RevenueFromContractWithCustomerExcludingAssessedTax: [fy(Y, 30)], // fees only
      ...Object.fromEntries(signals.map((s) => [s, [fy(Y, 1)]])),
    });
  it('needs two signals; then revenue = net interest + non-interest income', () => {
    expect(isBankLike([bank(['InterestExpenseDeposits'])])).toBe(true); // + NoninterestIncome
    const a = extractAnnuals([bank(['InterestExpenseDeposits'])], 2007);
    expect(a.at(-1)!.revenue).toBe(100);
  });
  it('one stray signal is not a bank (O\'Reilly, Nucor)', () => {
    const d = doc({ ...base(Y), InterestAndDividendIncomeOperating: [fy(Y, 1)] });
    expect(isBankLike([d])).toBe(false);
  });
});

describe('debt includes lease liabilities, without double counting', () => {
  it('borrowings + finance + operating leases (the sheet\'s FMP definition)', () => {
    const end = `${Y}-12-31`;
    const a = extractAnnuals(
      [doc({
        ...base(Y),
        Revenues: [fy(Y, 100)],
        LongTermDebtNoncurrent: [at(end, 100)],
        LongTermDebt: [at(end, 110)], // total incl. current: must not add again
        LongTermDebtCurrent: [at(end, 10)],
        FinanceLeaseLiability: [at(end, 5)],
        OperatingLeaseLiability: [at(end, 20)],
        CashAndCashEquivalentsAtCarryingValue: [at(end, 30)],
      })],
      2007,
    );
    expect(a.at(-1)!.totalDebt).toBe(135);
    expect(a.at(-1)!.cash).toBe(30);
  });
});

describe('share counts', () => {
  const end = `${Y}-12-31`;
  it('rejects a scale error using net income ÷ EPS (McDonald\'s tags millions)', () => {
    const a = extractAnnuals(
      [doc(
        { ...base(Y), Revenues: [fy(Y, 100)], NetIncomeLoss: [fy(Y, 7.1e9)] },
        { WeightedAverageNumberOfDilutedSharesOutstanding: [fy(Y, 711)] },
        { EarningsPerShareDiluted: [fy(Y, 10)] },
        { EntityCommonStockSharesOutstanding: [at(`${Y + 1}-01-31`, 705e6, '10-K', `${Y + 1}-02-20`)] },
      )],
      2007,
    );
    expect(a.at(-1)!.shares).toBe(705e6);
  });

  it('a single-class count gives way to diluted shares (Alphabet-style)', () => {
    const a = extractAnnuals(
      [doc(
        { ...base(Y), Revenues: [fy(Y, 100)] },
        {
          CommonStockSharesOutstanding: [at(end, 300e6)],
          WeightedAverageNumberOfDilutedSharesOutstanding: [fy(Y, 500e6)],
        },
      )],
      2007,
    );
    expect(a.at(-1)!.shares).toBe(500e6);
  });

  it('restates a pre-split count to today\'s basis from its filing date (NVIDIA 10:1)', () => {
    const splits = [{ date: '2024-06-10', ratio: 10 }];
    expect(sharesToday({ val: 2.47e9, end: '2023-01-29', filed: '2023-02-24' }, splits)).toBe(24.7e9);
    expect(sharesToday({ val: 24.5e9, end: '2025-01-26', filed: '2025-02-26' }, splits)).toBe(24.5e9);
  });

  it('drops one-year spikes and counts >5× from today', () => {
    expect(cleanShareSeries([100, 101, 300, 102, 103], 100)).toEqual([100, 101, null, 102, 103]);
    expect(cleanShareSeries([900, 100, 100], 100)).toEqual([null, 100, 100]);
    expect(cleanShareSeries([50, 100, 200], 200)).toEqual([50, 100, 200]); // real growth stays
  });
});

describe('fallbacks are flagged, never silent', () => {
  it('missing SBC is zero with a note; missing capex stays blank with a note', () => {
    const notes = new Set<string>();
    const { PaymentsToAcquirePropertyPlantAndEquipment: _c, ShareBasedCompensation: _s, ...rest } = base(Y);
    const a = extractAnnuals([doc({ ...rest, Revenues: [fy(Y, 100)] })], 2007, notes);
    expect(a.at(-1)!.sbc).toBe(0);
    expect(a.at(-1)!.capex).toBeNull();
    expect([...notes].join(' ')).toMatch(/Stock-based compensation.*zero/);
    expect([...notes].join(' ')).toMatch(/Capital expenditure.*free cash flow is blank \(FY/);
  });

  it('operating income: pre-tax + interest when not reported (Nike-style)', () => {
    const notes = new Set<string>();
    const { OperatingIncomeLoss: _o, ...rest } = base(Y);
    const a = extractAnnuals(
      [doc({
        ...rest,
        Revenues: [fy(Y, 100)],
        IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: [fy(Y, 12)],
        InterestExpense: [fy(Y, 3)],
      })],
      2007,
      notes,
    );
    expect(a.at(-1)!.operatingIncome).toBe(15);
    expect([...notes].join(' ')).toMatch(/pre-tax income \+ interest/);
  });
});

describe('TTM keeps one revenue definition', () => {
  it('rolls the anchored tag forward through 10-Q year-to-date figures', () => {
    const q = (y: number, val: number): SecFact => ({
      start: `${y}-01-01`, end: `${y}-09-30`, val, form: '10-Q', filed: `${y}-11-01`,
    });
    const docs = [doc({
      ...base(Y),
      Revenues: [fy(Y, 20)], // sub-item (General Mills)
      RevenueFromContractWithCustomerExcludingAssessedTax: [fy(Y, 200), q(Y, 150), q(Y + 1, 165)],
      NetIncomeLoss: [fy(Y, 10), q(Y, 7), q(Y + 1, 8)],
    })];
    const annuals = extractAnnuals(docs, 2007);
    const ttm = extractTtm(docs, annuals);
    expect(ttm.revenue).toBe(200 + 165 - 150);
    expect(ttm.netIncome).toBe(10 + 8 - 7);
  });

  const q = (y: number, val: number): SecFact => ({
    start: `${y}-01-01`, end: `${y}-09-30`, val, form: '10-Q', filed: `${y}-11-01`,
  });

  it('keeps the fiscal year\'s interest when the 10-Qs stop tagging it (Genuine Parts)', () => {
    const { OperatingIncomeLoss: _o, ...rest } = base(Y);
    const notes = new Set<string>();
    const docs = [doc({
      ...rest,
      Revenues: [fy(Y, 200), q(Y, 150), q(Y + 1, 160)],
      NetIncomeLoss: [fy(Y, 10), q(Y, 7), q(Y + 1, 8)],
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: [
        fy(Y, 12), q(Y, 9), q(Y + 1, 10),
      ],
      InterestExpenseNonoperating: [fy(Y, 4), q(Y, 3)], // nothing for this year's 10-Q
    })];
    const ttm = extractTtm(docs, extractAnnuals(docs, 2007, notes), notes);
    expect(ttm.operatingIncome).toBe(12 + 10 - 9 + 4);
    expect([...notes].join(' ')).toMatch(/fiscal year's interest expense.*\(TTM\)/);
  });

  it('a cash-flow line missing from the 10-Qs keeps its fiscal-year value, not zero', () => {
    const notes = new Set<string>();
    const docs = [doc({
      ...base(Y), // SBC tagged in the 10-K only
      Revenues: [fy(Y, 200), q(Y, 150), q(Y + 1, 160)],
      NetIncomeLoss: [fy(Y, 10), q(Y, 7), q(Y + 1, 8)],
      NetCashProvidedByUsedInOperatingActivities: [fy(Y, 20), q(Y, 14), q(Y + 1, 16)],
    })];
    const ttm = extractTtm(docs, extractAnnuals(docs, 2007, notes), notes);
    expect(ttm.operatingCashFlow).toBe(20 + 16 - 14);
    expect(ttm.sbc).toBe(1);
    expect([...notes].join(' ')).toMatch(/TTM uses fiscal-year figures for .*stock-based compensation/);
    expect([...notes].join(' ')).not.toMatch(/treated as zero/);
  });
});

describe('notes name the periods they cover', () => {
  it('collapses consecutive fiscal years and lists TTM last', () => {
    expect(formatPeriods(new Set([2011, 2009, 2010, 2015, 'TTM']))).toBe('FY2009–FY2011, FY2015, TTM');
    expect(formatPeriods(new Set(['TTM']))).toBe('TTM');
  });

  it('one note per message, listing every year it applies to', () => {
    const notes = new Set<string>();
    const { ShareBasedCompensation: _s, ...rest } = base(Y - 2);
    extractAnnuals(
      [doc({
        ...rest,
        Revenues: years(Y - 2, Y).map((y) => fy(y, 100)),
        ShareBasedCompensation: [fy(Y, 1)], // tagged in the latest year only
      })],
      2007,
      notes,
    );
    const sbcNotes = [...notes].filter((n) => n.startsWith('Stock-based'));
    expect(sbcNotes).toHaveLength(1);
    expect(sbcNotes[0]).toMatch(/\(FY\d{4}–FY\d{4}\)\.$/);
    expect(sbcNotes[0]).toContain(`FY${Y - 2}–FY${Y - 1}`);
  });
});

describe('FreeProvider end to end', () => {
  const now = Math.floor(Date.now() / 1000);
  const chart = (price: number, splits: Record<string, unknown> = {}) => ({
    chart: {
      result: [{
        meta: { symbol: 'SYN', currency: 'USD', regularMarketPrice: price, longName: 'Synthetic Inc.' },
        timestamp: [now - 30 * 86400 * 7, now - 7 * 86400, now],
        indicators: { quote: [{ close: [price * 0.9, price * 0.95, price] }] },
        events: { splits },
      }],
    },
  });
  const facts = doc(
    { ...base(Y), Revenues: [fy(Y, 100)], NetIncomeLoss: [fy(Y, 10)] },
    { CommonStockSharesOutstanding: [at(`${Y}-12-31`, 1e9, '10-K', `${Y + 1}-02-15`)] },
  );
  const make = (overrides = {}, splits = {}) =>
    new FreeProvider({
      loadFacts: async () => facts,
      cikFor: async () => 1,
      fetchImpl: (async () => new Response(JSON.stringify(chart(50, splits)))) as typeof fetch,
      shareOverrides: overrides,
    });
  const sym = { ticker: 'SYN', exchange: 'US', reportingCurrency: 'USD' };

  it('market cap = SEC shares × price, restated through later splits', async () => {
    const q = await make().quote(sym);
    expect(q.marketCap).toBe(50e9);
    const split = { x: { date: now - 86400, numerator: 2, denominator: 1 } };
    expect((await make({}, split).quote(sym)).shares).toBe(2e9);
  });

  it('a share override wins and blanks historical market caps', async () => {
    const p = make({ SYN: { shares: 3e9, asOf: '2026-01-01', source: 'test' } });
    expect((await p.quote(sym)).marketCap).toBe(150e9);
    const snap = await loadCompanySnapshot(p, sym, new UsdOnlyFxTable());
    expect(snap.rows.at(-2)!.marketCap).toBeNull();
    expect(snap.dataSource).toBe('free:sec-edgar+yahoo');
    expect(snap.dataNotes!.join(' ')).toMatch(/Share count: test/);
  });
});
