/**
 * Data-layer unit tests: snapshot assembly semantics (FX application, net
 * debt derivation, capex sign passthrough, TTM freezing) with a mocked
 * provider, plus the parity diff.
 *
 * Live-data parity (a real META pull within 3% of the fixture) is the
 * separate opt-in integration test in live-parity.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type {
  AnnualFundamentals,
  DataProvider,
  QuoteData,
  SymbolRef,
  TtmFundamentals,
} from '../src/provider';
import { loadCompanySnapshot } from '../src/snapshot';
import { StaticFxTable, UsdOnlyFxTable } from '../src/fx';
import { compareSnapshots } from '../src/live-parity';
import type { OwnershipStats, PricePoint } from '@dvh/engine';

const annual = (fiscalYear: number, over: Partial<AnnualFundamentals> = {}): AnnualFundamentals => ({
  fiscalYear,
  revenue: 1000,
  operatingIncome: 400,
  operatingCashFlow: 500,
  capex: -100, // negative outflow, sheet convention
  sbc: 50,
  grossProfit: 800,
  netIncome: 300,
  totalDebt: 200,
  cash: 150,
  tangibleBook: 900,
  shares: 10,
  marketCap: 5000,
  enterpriseValue: 5050,
  roic: 0.2,
  ...over,
});

class FakeProvider implements DataProvider {
  readonly id = 'fake';
  async search(): Promise<SymbolRef[]> {
    return [];
  }
  async quote(): Promise<QuoteData> {
    return {
      price: 100,
      marketCap: 6000,
      shares: 12,
      name: 'Fake Corp',
      fiftyTwoWeekHigh: 120,
      fiftyTwoWeekLow: 80,
    };
  }
  async annualFundamentals(): Promise<AnnualFundamentals[]> {
    return [annual(2023), annual(2024, { revenue: 1100 })];
  }
  async ttmFundamentals(): Promise<TtmFundamentals> {
    const { fiscalYear: _y, ...rest } = annual(2024, { revenue: 1200, roic: null });
    return { ...rest, asOf: '2026-06-30', shares: null, marketCap: null, enterpriseValue: null };
  }
  async ownership(): Promise<OwnershipStats> {
    return {
      insiderOwnership: null,
      insiderOwnershipChange: null,
      institutionalOwnership: null,
      shortInterest: null,
      momentum: null,
    };
  }
  async weeklyPrices(): Promise<PricePoint[]> {
    return [
      { date: '2026-06-19', close: 95 },
      { date: '2026-06-26', close: 100 },
    ];
  }
}

const symbol: SymbolRef = { ticker: 'FAKE', exchange: 'NYSE', reportingCurrency: 'USD' };

describe('loadCompanySnapshot', () => {
  it('builds rows 2007..latest FY plus a TTM row', async () => {
    const snap = await loadCompanySnapshot(new FakeProvider(), symbol, new UsdOnlyFxTable(), () =>
      new Date('2026-07-10T12:00:00Z'),
    );
    expect(snap.rows).toHaveLength(2024 - 2007 + 1 + 1);
    expect(snap.rows[0]!.yearLabel).toBe(2007);
    expect(snap.rows[0]!.revenue).toBe(0); // pre-history zero-filled
    expect(snap.rows.at(-2)!.yearLabel).toBe(2024);
    expect(snap.rows.at(-1)!.yearLabel).toBe('TTM');
  });

  it('derives net debt, keeps capex negative, freezes TTM to the quote', async () => {
    const snap = await loadCompanySnapshot(new FakeProvider(), symbol, new UsdOnlyFxTable());
    const fy = snap.rows.at(-2)!;
    expect(fy.netDebt).toBe(50); // 200 - 150
    expect(fy.capex).toBe(-100);
    const ttm = snap.rows.at(-1)!;
    expect(ttm.shares).toBe(12); // O53 <- quote
    expect(ttm.marketCap).toBe(6000); // P53 <- quote
    expect(ttm.enterpriseValue).toBeUndefined(); // Q53 derived by engine
    expect(snap.snapshotMarketCap).toBe(6000);
    expect(snap.roic).toBe(0.2); // TTM null -> prior FY fallback (E15 rule)
  });

  it('applies FX factors per fiscal year for non-USD reporters', async () => {
    const fx = new StaticFxTable({ 2023: { EUR: 1.1 }, 2024: { EUR: 1.2 } }, 2024);
    const snap = await loadCompanySnapshot(
      new FakeProvider(),
      { ...symbol, reportingCurrency: 'EUR' },
      fx,
    );
    const y23 = snap.rows.find((r) => r.yearLabel === 2023)!;
    const y24 = snap.rows.find((r) => r.yearLabel === 2024)!;
    expect(y23.revenue).toBeCloseTo(1100, 9); // 1000 * 1.1
    expect(y24.revenue).toBeCloseTo(1320, 9); // 1100 * 1.2
    expect(y24.netDebt).toBeCloseTo(60, 9); // (200-150) * 1.2
    expect(y24.shares).toBe(10); // share counts unconverted
  });
});

describe('compareSnapshots', () => {
  it('flags fields outside tolerance and passes those within', async () => {
    const a = await loadCompanySnapshot(new FakeProvider(), symbol, new UsdOnlyFxTable());
    const b = structuredClone(a);
    b.rows.at(-1)!.revenue = 1200 * 1.02; // +2% -> within 3%
    b.rows.at(-2)!.netIncome = 300 * 1.10; // +10% -> outside
    const report = compareSnapshots(a, b);
    expect(report.failures.map((f) => f.path)).toContain('2024.netIncome');
    expect(report.failures.map((f) => f.path)).not.toContain('TTM.revenue');
  });
});
