/**
 * EdgarFirstProvider unit tests: statements from a fake EDGAR source,
 * prices from a fake market source, and the derivations the DVH model
 * defines: per-year market cap = shares × close nearest fiscal year end
 * (incl. non-December FYE), EV = market cap + net debt.
 */
import { describe, expect, it } from 'vitest';
import type { OwnershipStats, PricePoint } from '@dvh/engine';
import type {
  AnnualFundamentals,
  DataProvider,
  QuoteData,
  SymbolRef,
  TtmFundamentals,
} from '../src/provider';
import { EdgarFirstProvider, closeNearest } from '../src/composite';

const B = 1e9;

const nullOwnership: OwnershipStats = {
  insiderOwnership: null,
  insiderOwnershipChange: null,
  institutionalOwnership: null,
  shortInterest: null,
  momentum: null,
};

/** Weekly closes: value = 100 + monthIndex, deterministic and easy to check. */
function weekly(fromYear: number, toYear: number): PricePoint[] {
  const out: PricePoint[] = [];
  for (let t = Date.UTC(fromYear, 0, 3); t <= Date.UTC(toYear, 11, 28); t += 7 * 24 * 3600 * 1000) {
    const d = new Date(t);
    out.push({
      date: d.toISOString().slice(0, 10),
      close: 100 + (d.getUTCFullYear() - fromYear) * 12 + d.getUTCMonth(),
    });
  }
  return out;
}

const edgarAnnual = (fiscalYear: number, fyEnd: string, over: Partial<AnnualFundamentals> = {}): AnnualFundamentals => ({
  fiscalYear,
  fiscalYearEnd: fyEnd,
  revenue: 10 * B,
  operatingIncome: 3 * B,
  operatingCashFlow: 4 * B,
  capex: -1 * B,
  sbc: 0.5 * B,
  grossProfit: 7 * B,
  netIncome: 2.5 * B,
  totalDebt: 5 * B,
  cash: 2 * B,
  tangibleBook: 8 * B,
  shares: 1 * B,
  marketCap: null, // EDGAR never has these three
  enterpriseValue: null,
  roic: null,
  ...over,
});

class FakeEdgar implements DataProvider {
  readonly id = 'fake-edgar';
  async annualFundamentals(): Promise<AnnualFundamentals[]> {
    return [
      edgarAnnual(2023, '2023-06-30'), // June FYE, like MSFT
      edgarAnnual(2024, '2024-06-30'),
      edgarAnnual(2025, '2025-06-30', { shares: null }), // no share count
    ];
  }
  async ttmFundamentals(): Promise<TtmFundamentals> {
    const { fiscalYear: _y, ...rest } = edgarAnnual(2025, '2025-06-30');
    return { ...rest, asOf: '2025-06-30' };
  }
  async quote(): Promise<QuoteData> {
    throw new Error('fundamentals only');
  }
  async weeklyPrices(): Promise<PricePoint[]> {
    throw new Error('fundamentals only');
  }
  async search(): Promise<SymbolRef[]> {
    throw new Error('fundamentals only');
  }
  async ownership(): Promise<OwnershipStats> {
    return nullOwnership;
  }
}

class FakeMarket implements DataProvider {
  readonly id = 'fake-market';
  async weeklyPrices(): Promise<PricePoint[]> {
    return weekly(2022, 2026);
  }
  async quote(): Promise<QuoteData> {
    return {
      price: 150,
      marketCap: 150 * B,
      shares: 1 * B,
      name: 'Fake Co',
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
    };
  }
  async search(): Promise<SymbolRef[]> {
    return [];
  }
  async ownership(): Promise<OwnershipStats> {
    return nullOwnership;
  }
  async annualFundamentals(): Promise<AnnualFundamentals[]> {
    return [];
  }
  async ttmFundamentals(): Promise<TtmFundamentals> {
    throw new Error('market only');
  }
}

const symbol: SymbolRef = { ticker: 'FAKE', exchange: 'US', reportingCurrency: 'USD' };

describe('closeNearest', () => {
  const hist = weekly(2023, 2024);
  it('finds the close nearest a mid-year date', () => {
    // 2023-06-30 -> June 2023 close = 100 + 5 = 105
    expect(closeNearest(hist, '2023-06-30')).toBe(105);
  });
  it('returns null outside the window', () => {
    expect(closeNearest(hist, '2030-01-01')).toBeNull();
  });
});

describe('EdgarFirstProvider', () => {
  const provider = new EdgarFirstProvider(new FakeEdgar(), new FakeMarket());

  it('derives per-year market cap from shares x close at the FISCAL year end', async () => {
    const hist = weekly(2022, 2026);
    const rows = await provider.annualFundamentals(symbol, 2007);
    const y2023 = rows.find((r) => r.fiscalYear === 2023)!;
    expect(y2023.marketCap).toBeCloseTo(closeNearest(hist, '2023-06-30')! * 1 * B, 0);
    const y2024 = rows.find((r) => r.fiscalYear === 2024)!;
    expect(y2024.marketCap).toBeCloseTo(closeNearest(hist, '2024-06-30')! * 1 * B, 0);
    // sanity: mid-year (June/July) closes, NOT December's
    expect(y2023.marketCap! / B).toBeGreaterThan(115);
    expect(y2023.marketCap! / B).toBeLessThan(120);
  });

  it('derives EV = market cap + (total debt - cash)', async () => {
    const rows = await provider.annualFundamentals(symbol, 2007);
    const y2023 = rows.find((r) => r.fiscalYear === 2023)!;
    expect(y2023.enterpriseValue).toBeCloseTo(y2023.marketCap! + 3 * B, 0);
  });

  it('leaves market cap/EV null when shares are missing — never invents', async () => {
    const rows = await provider.annualFundamentals(symbol, 2007);
    const y2025 = rows.find((r) => r.fiscalYear === 2025)!;
    expect(y2025.marketCap).toBeNull();
    expect(y2025.enterpriseValue).toBeNull();
  });

  it('delegates quotes and prices to the market source, TTM to EDGAR', async () => {
    expect((await provider.quote(symbol)).price).toBe(150);
    expect((await provider.weeklyPrices(symbol, 4)).length).toBeGreaterThan(100);
    expect((await provider.ttmFundamentals(symbol)).revenue).toBe(10 * B);
  });
});
