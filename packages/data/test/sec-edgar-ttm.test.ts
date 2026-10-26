/**
 * EDGAR trailing twelve months: rolled forward from 10-Q year-to-date
 * facts (FY + YTD − YTD a year earlier), balance sheet from the latest
 * instant. Synthetic company facts, dated relative to today so the test
 * never ages out.
 */
import { describe, expect, it } from 'vitest';
import { SecEdgarProvider } from '../src/sec-edgar';

const Y = new Date().getFullYear() - 1; // latest completed fiscal year
const fyFact = (y: number, val: number) => ({
  start: `${y}-01-01`, end: `${y}-12-31`, val, fy: y, fp: 'FY', form: '10-K',
});
const ytdFact = (y: number, val: number, form = '10-Q') => ({
  start: `${y}-01-01`, end: `${y}-09-30`, val, fy: y + (form === '10-Q' ? 0 : 0), fp: 'Q3', form,
});
const instant = (end: string, val: number, form: string) => ({ end, val, fy: Y, fp: 'FY', form });

function facts(withQ3: boolean) {
  const usd = (arr: object[]) => ({ units: { USD: arr } });
  return {
    cik: 1,
    entityName: 'Synthetic Co',
    facts: {
      'us-gaap': {
        Revenues: usd([
          fyFact(Y - 1, 80), fyFact(Y, 100),
          // each 10-Q carries the prior-year comparative
          ytdFact(Y - 1, 50), ytdFact(Y, 70),
          ...(withQ3 ? [ytdFact(Y + 1, 90)] : []),
        ]),
        OperatingIncomeLoss: usd([
          fyFact(Y, 20), ytdFact(Y, 14), ...(withQ3 ? [ytdFact(Y + 1, 21)] : []),
        ]),
        NetCashProvidedByUsedInOperatingActivities: usd([
          fyFact(Y, 30), ytdFact(Y, 20), ...(withQ3 ? [ytdFact(Y + 1, 26)] : []),
        ]),
        // XBRL reports capex as a positive outflow
        PaymentsToAcquirePropertyPlantAndEquipment: usd([
          fyFact(Y, 10), ytdFact(Y, 6), ...(withQ3 ? [ytdFact(Y + 1, 9)] : []),
        ]),
        NetIncomeLoss: usd([fyFact(Y - 1, 8), fyFact(Y, 12), ytdFact(Y, 9), ...(withQ3 ? [ytdFact(Y + 1, 11)] : [])]),
        CashAndCashEquivalentsAtCarryingValue: usd([
          instant(`${Y}-12-31`, 20, '10-K'),
          ...(withQ3 ? [instant(`${Y + 1}-09-30`, 25, '10-Q')] : []),
        ]),
      },
    },
  };
}

const provider = (withQ3: boolean) =>
  new SecEdgarProvider('internal://edgar', (async () =>
    new Response(JSON.stringify(facts(withQ3)), { status: 200 })) as typeof fetch);
const sym = { ticker: 'SYN', exchange: 'US', reportingCurrency: 'USD' };

describe('SecEdgarProvider TTM', () => {
  it('rolls the fiscal year forward with 10-Q year-to-date figures', async () => {
    const t = await provider(true).ttmFundamentals(sym);
    expect(t.asOf).toBe(`${Y + 1}-09-30`);
    expect(t.revenue).toBe(100 + 90 - 70);
    expect(t.operatingIncome).toBe(20 + 21 - 14);
    expect(t.operatingCashFlow).toBe(30 + 26 - 20);
    expect(t.capex).toBe(-(10 + 9 - 6)); // stored negative at the boundary
    expect(t.netIncome).toBe(12 + 11 - 9);
    expect(t.cash).toBe(25); // latest instant, from the 10-Q
    // prior TTM window = prior FY + YTD a year ago − YTD two years ago
    expect(t.priorTtmRevenue).toBe(80 + 70 - 50);
  });

  it('falls back to the latest fiscal year when no 10-Q has been filed since', async () => {
    const t = await provider(false).ttmFundamentals(sym);
    expect(t.asOf).toBe(`${Y}-12-31`);
    expect(t.revenue).toBe(100);
    expect(t.capex).toBe(-10);
    expect(t.cash).toBe(20);
    expect(t.priorTtmRevenue).toBe(80);
  });
});
