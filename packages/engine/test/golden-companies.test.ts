/**
 * GOLDEN-COMPANY ROBUSTNESS SUITE.
 *
 * The META gate proves exactness on one mega-cap tech; this suite proves
 * the engine stays HONEST on every company shape the App Store will throw
 * at it. Synthetic archetypes — bank, insurer, REIT, recent IPO,
 * money-losing biotech, negative tangible book, pre-revenue shell,
 * null-riddled provider data — each run through the full analysis with
 * three invariants:
 *
 *   1. never throw;
 *   2. never emit NaN/Infinity anywhere in the output tree — impossible
 *      values render as null (a dash), exactly like the sheet's
 *      IFERROR(...,"") semantics;
 *   3. degrade states are the sheet's states ('No Forecast', '#NUM!',
 *      'Neg Book'), not garbage numbers.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeCompany,
  computeDerivedRows,
  fiftyTwoWeekRange,
  momentumFromHistory,
  type CompanyAnalysis,
  type CompanySnapshot,
  type HistoricalRowInput,
  type Maybe,
  type PricePoint,
} from '../src/index';

/* ---------------- archetype builders ---------------- */

interface YearSpec {
  revenue?: Maybe;
  operatingIncome?: Maybe;
  operatingCashFlow?: Maybe;
  capex?: Maybe;
  sbc?: Maybe;
  netDebt?: Maybe;
  shares?: Maybe;
  marketCap?: Maybe;
  enterpriseValue?: Maybe;
  tangibleBook?: Maybe;
  grossProfit?: Maybe;
  netIncome?: Maybe;
}

/**
 * Build a 20-row history (2007..latest FY, TTM) from a per-year recipe.
 * A field OMITTED from the recipe defaults to 0 (zero-filled pre-history);
 * a field explicitly set to null stays null (provider returned nothing).
 */
function buildRows(recipe: (year: number, i: number) => YearSpec | null): HistoricalRowInput[] {
  const rows: HistoricalRowInput[] = [];
  const YEARS = 19; // 2007..2025
  for (let i = 0; i < YEARS; i++) {
    const year = 2007 + i;
    const spec = recipe(year, i);
    const v = (key: keyof YearSpec): Maybe =>
      spec && key in spec ? (spec[key] as Maybe) : 0;
    rows.push({
      yearLabel: year,
      fx: 1,
      revenue: v('revenue'),
      operatingIncome: v('operatingIncome'),
      operatingCashFlow: v('operatingCashFlow'),
      capex: v('capex'),
      sbc: v('sbc'),
      netDebt: v('netDebt'),
      shares: v('shares'),
      marketCap: v('marketCap'),
      enterpriseValue: v('enterpriseValue'),
      tangibleBook: v('tangibleBook'),
      grossProfit: v('grossProfit'),
      netIncome: v('netIncome'),
    });
  }
  // TTM mirrors the latest FY (as the fixture does), minus provider EV
  const last = rows[rows.length - 1]!;
  const { enterpriseValue: _ev, ...ttmBase } = last;
  rows.push({ ...ttmBase, yearLabel: 'TTM' });
  return rows;
}

function buildHistory(price: number, weeks = 200): PricePoint[] {
  const out: PricePoint[] = [];
  const end = new Date('2026-07-10').getTime();
  for (let i = weeks - 1; i >= 0; i--) {
    const t = new Date(end - i * 7 * 24 * 3600 * 1000);
    // deterministic wobble, never touching zero
    const close = Math.max(0.01, price * (1 + 0.2 * Math.sin(i / 9)));
    out.push({ date: t.toISOString().slice(0, 10), close });
  }
  return out;
}

function buildSnapshot(
  ticker: string,
  rows: HistoricalRowInput[],
  price: number,
  marketCap: number,
  roic: Maybe = null,
): CompanySnapshot {
  return {
    ticker,
    name: `${ticker} Test Co`,
    exchange: 'TEST',
    reportingCurrency: 'USD',
    snapshotDate: '2026-07-10',
    quote: { price, marketCap },
    snapshotShares: price > 0 ? marketCap / price : 0,
    snapshotMarketCap: marketCap,
    roic,
    ownership: {
      insiderOwnership: null,
      insiderOwnershipChange: null,
      institutionalOwnership: null,
      shortInterest: null,
      momentum: null,
    },
    rows,
    priceHistory: buildHistory(price),
  };
}

const M = 1e6;
const B = 1e9;

/** Every archetype the App Store will throw at us. */
const ARCHETYPES: {
  name: string;
  snapshot: CompanySnapshot;
  /** Allowed base-5y states; anything else is a failure. */
  base5States: ('ok' | 'no-forecast' | 'num-error')[];
}[] = [
  {
    // No capex, no gross profit, no SBC; enormous gross debt.
    name: 'bank (JPM-shaped)',
    // FCF margin seeds 0 (Adj FCF is null) but op margin is non-zero, so
    // the sheet's countif gate doesn't fire: the IRR computes from the
    // terminal value alone over zero FCF years. Sheet behaviour, kept.
    base5States: ['ok'],
    snapshot: buildSnapshot(
      'BANKX',
      buildRows((_y, i) => ({
        revenue: (60 + 4 * i) * B,
        operatingIncome: (18 + 1.5 * i) * B,
        operatingCashFlow: (20 + 2 * i) * B,
        capex: null, // banks: provider returns nothing
        sbc: null,
        netDebt: 300 * B, // gross debt >> cash
        shares: 3 * B,
        marketCap: (150 + 10 * i) * B,
        enterpriseValue: (450 + 10 * i) * B,
        tangibleBook: (120 + 6 * i) * B,
        grossProfit: null, // not reported
        netIncome: (12 + 1.2 * i) * B,
      })),
      180,
      560 * B,
      0.12,
    ),
  },
  {
    // Thin margins, heavy debt and capex, high payout.
    name: 'REIT (high leverage, capex heavy)',
    base5States: ['ok'],
    snapshot: buildSnapshot(
      'REITX',
      buildRows((_y, i) => ({
        revenue: (2 + 0.1 * i) * B,
        operatingIncome: (0.5 + 0.03 * i) * B,
        operatingCashFlow: (1 + 0.05 * i) * B,
        capex: -(0.9 + 0.04 * i) * B,
        sbc: 20 * M,
        netDebt: (8 + 0.2 * i) * B, // ND/EBIT ~ 14x
        shares: 400 * M,
        marketCap: (6 + 0.2 * i) * B,
        enterpriseValue: (14 + 0.4 * i) * B,
        tangibleBook: (4 + 0.1 * i) * B,
        grossProfit: (1.4 + 0.06 * i) * B,
        netIncome: (0.3 + 0.02 * i) * B,
      })),
      22,
      9 * B,
    ),
  },
  {
    // Only the last 3 fiscal years have data; everything before is zero.
    name: 'recent IPO (3 years of history)',
    base5States: ['ok'],
    snapshot: buildSnapshot(
      'IPOX',
      buildRows((_y, i) =>
        i < 16
          ? null // zero-filled pre-history, exactly like the sheet renders
          : {
              revenue: (1 + 0.8 * (i - 16)) * B,
              operatingIncome: (0.05 + 0.1 * (i - 16)) * B,
              operatingCashFlow: (0.2 + 0.2 * (i - 16)) * B,
              capex: -(0.1 + 0.05 * (i - 16)) * B,
              sbc: (0.15 + 0.05 * (i - 16)) * B,
              netDebt: -(0.5 * B), // net cash
              shares: 500 * M,
              marketCap: (8 + 4 * (i - 16)) * B,
              enterpriseValue: (7.5 + 4 * (i - 16)) * B,
              tangibleBook: (1 + 0.5 * (i - 16)) * B,
              grossProfit: (0.7 + 0.5 * (i - 16)) * B,
              netIncome: (-0.1 + 0.15 * (i - 16)) * B,
            },
      ),
      35,
      17 * B,
    ),
  },
  {
    // Negative operating income and net income throughout; burns cash.
    name: 'money-losing biotech',
    // seeded margins are the TTM's NEGATIVE margins: computes or errs honestly
    base5States: ['ok', 'num-error'],
    snapshot: buildSnapshot(
      'BIOX',
      buildRows((_y, i) =>
        i < 10
          ? null
          : {
              revenue: (0.05 + 0.02 * (i - 10)) * B,
              operatingIncome: -(0.4 + 0.05 * (i - 10)) * B,
              operatingCashFlow: -(0.3 + 0.04 * (i - 10)) * B,
              capex: -(0.02 * B),
              sbc: 0.08 * B,
              netDebt: -(1.5 - 0.1 * (i - 10)) * B, // cash pile shrinking
              shares: (200 + 20 * (i - 10)) * M,
              marketCap: 3 * B,
              enterpriseValue: 1.5 * B,
              tangibleBook: (1.2 - 0.08 * (i - 10)) * B,
              grossProfit: (0.04 + 0.015 * (i - 10)) * B,
              netIncome: -(0.42 + 0.05 * (i - 10)) * B,
            },
      ),
      12,
      3 * B,
    ),
  },
  {
    // Buyback-heavy staple: equity destroyed, tangible book NEGATIVE.
    name: 'negative tangible book (buyback staple)',
    base5States: ['ok'],
    snapshot: buildSnapshot(
      'STAPX',
      buildRows((_y, i) => ({
        revenue: (20 + 0.4 * i) * B,
        operatingIncome: (5 + 0.15 * i) * B,
        operatingCashFlow: (5.5 + 0.15 * i) * B,
        capex: -(0.8 * B),
        sbc: 0.2 * B,
        netDebt: (25 + 0.5 * i) * B,
        shares: (1500 - 30 * i) * M,
        marketCap: (80 + 3 * i) * B,
        enterpriseValue: (105 + 3.5 * i) * B,
        tangibleBook: -(8 + 0.3 * i) * B, // negative throughout
        grossProfit: (12 + 0.25 * i) * B,
        netIncome: (3.5 + 0.12 * i) * B,
      })),
      95,
      135 * B,
    ),
  },
  {
    // Revenue literally zero in every year: division-by-zero paths.
    name: 'pre-revenue shell',
    base5States: ['no-forecast'], // margins all zero
    snapshot: buildSnapshot(
      'SHELX',
      buildRows((_y, i) =>
        i < 17
          ? null
          : {
              revenue: 0,
              operatingIncome: -(30 * M),
              operatingCashFlow: -(25 * M),
              capex: 0,
              sbc: 5 * M,
              netDebt: -(100 * M),
              shares: 50 * M,
              marketCap: 300 * M,
              enterpriseValue: 200 * M,
              tangibleBook: 90 * M,
              grossProfit: 0,
              netIncome: -(32 * M),
            },
      ),
      6,
      300 * M,
    ),
  },
  {
    // Provider returned null for half the fields in half the years.
    name: 'sparse provider data (nulls everywhere)',
    // latest-FY revenue is null -> margins seed 0 -> honest No Forecast
    base5States: ['no-forecast'],
    snapshot: buildSnapshot(
      'NULLX',
      buildRows((_y, i) => ({
        revenue: i % 3 === 0 ? null : (5 + 0.3 * i) * B,
        operatingIncome: i % 4 === 0 ? null : (1 + 0.08 * i) * B,
        operatingCashFlow: i % 5 === 0 ? null : (1.2 + 0.09 * i) * B,
        capex: i % 2 === 0 ? null : -(0.3 * B),
        sbc: null,
        netDebt: i % 3 === 1 ? null : (0.6 * B),
        shares: 800 * M,
        marketCap: i % 4 === 2 ? null : (18 + 0.8 * i) * B,
        enterpriseValue: null,
        tangibleBook: i % 2 === 1 ? null : (4 + 0.2 * i) * B,
        grossProfit: null,
        netIncome: i % 3 === 2 ? null : (0.8 + 0.06 * i) * B,
      })),
      28,
      33 * B,
    ),
  },
];

/* ---------------- invariants ---------------- */

/** Walk the whole output tree: every number must be finite. */
function assertNoBadNumbers(value: unknown, path = 'root'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} = ${value}`).toBe(true);
    return;
  }
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoBadNumbers(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    assertNoBadNumbers(v, `${path}.${k}`);
  }
}

function assertHonestStates(a: CompanyAnalysis): void {
  // header: null or 'Neg Book' only where defined; ratios never +-Infinity
  const h = a.header;
  if (h.priceToTangibleBook != null && h.priceToTangibleBook < 0) {
    expect(h.adjRoic).toBe('Neg Book');
  }
  // scenarios: a non-'ok' status must not leak numeric results
  for (const kind of ['bear', 'base', 'bull'] as const) {
    for (const hz of [5, 3] as const) {
      const v = a.scenarios[kind][hz];
      if (v.status !== 'ok') {
        expect(v.irr, `${kind}/${hz} irr`).toBeNull();
        expect(v.fairValuePerShare, `${kind}/${hz} fv`).toBeNull();
        expect(v.priceDelta, `${kind}/${hz} delta`).toBeNull();
      }
      expect(v.forecast).toHaveLength(hz);
    }
  }
  // strip: always 9 cells, IRR null or finite (checked by NaN scan)
  expect(a.irrStrip).toHaveLength(9);
  // MoS: null target when no base fair value
  const base5 = a.scenarios.base[5];
  if (base5.status !== 'ok') {
    for (const row of a.marginOfSafety) {
      expect(row.targetBuyPrice).toBeNull();
    }
  }
}

/* ---------------- the suite ---------------- */

describe('golden companies: every sector archetype analyses without garbage', () => {
  for (const { name, snapshot, base5States } of ARCHETYPES) {
    describe(name, () => {
      it('analyzes without throwing, NaN or Infinity', () => {
        const analysis = analyzeCompany(snapshot);
        assertNoBadNumbers(analysis, name);
        assertHonestStates(analysis);
      });

      it('base 5y scenario lands in an expected state', () => {
        const analysis = analyzeCompany(snapshot);
        // never a numeric result under a non-ok status (checked above)
        expect(base5States).toContain(analysis.scenarios.base[5].status);
      });

      it('conventional capex treatment also stays clean', () => {
        const analysis = analyzeCompany(snapshot, {}, 'conventional');
        assertNoBadNumbers(analysis, `${name} (conventional)`);
      });

      it('price-history helpers behave', () => {
        const range = fiftyTwoWeekRange(snapshot.priceHistory);
        assertNoBadNumbers(range);
        const momentum = momentumFromHistory(snapshot.priceHistory, snapshot.snapshotDate);
        if (momentum != null) expect(Number.isFinite(momentum)).toBe(true);
      });
    });
  }

  it('bank: missing capex/SBC/gross profit blank out K, W and friends honestly', () => {
    const bank = ARCHETYPES[0]!.snapshot;
    const derived = computeDerivedRows(bank.rows);
    const ttm = derived[derived.length - 1]!;
    expect(ttm.adjFcf).toBeNull(); // K = H - I - J with null capex/sbc
    expect(ttm.adjFcfMargin).toBeNull();
    expect(ttm.grossMargin).toBeNull(); // V null
    expect(ttm.operatingMargin).not.toBeNull(); // still fine
    expect(ttm.netDebtToEbit).not.toBeNull();
  });

  it('negative tangible book: header shows Neg Book, P/TB negative', () => {
    const stap = ARCHETYPES[4]!.snapshot;
    const a = analyzeCompany(stap);
    expect(a.header.adjRoic).toBe('Neg Book');
    expect(a.header.priceToTangibleBook!).toBeLessThan(0);
  });

  it('pre-revenue shell: margins blank, scenarios say No Forecast, no crash', () => {
    const shell = ARCHETYPES[5]!.snapshot;
    const a = analyzeCompany(shell);
    const ttm = a.derived[a.derived.length - 1]!;
    expect(ttm.operatingMargin).toBeNull(); // F/0
    expect(a.scenarios.base[5].status).toBe('no-forecast');
    // 3-year block hits the countif quirk: never 'No Forecast'. With this
    // shell's NET CASH, the terminal cap is positive, so IRR finds a real
    // (deeply negative) root -- exactly what the sheet would show.
    const base3 = a.scenarios.base[3];
    expect(base3.status).toBe('ok');
    expect(base3.irr!).toBeLessThan(0);
    expect(base3.fairValuePerShare!).toBeGreaterThan(0);
  });

  it('IPO: 8y/10y CAGRs over zero-filled history blank out, not explode', () => {
    const ipo = ARCHETYPES[2]!.snapshot;
    const a = analyzeCompany(ipo);
    expect(a.summary.revenueCagr8).toBeNull(); // base year is 0
    expect(a.summary.sharesCagr10).toBeNull();
    assertNoBadNumbers(a.summary);
  });
});
