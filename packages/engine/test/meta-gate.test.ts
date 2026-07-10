/**
 * THE META GATE.
 *
 * Feeds the extracted META snapshot (2026-07-10) through the engine and
 * asserts every derived value against the spreadsheet's cached values.
 * Relative tolerance 1e-9 for pure arithmetic, 1e-6 for IRR.
 *
 * If any assertion here fails, the engine is wrong; fix the engine,
 * never the fixture.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../fixtures/meta-2026-07-10.json';
import expectedJson from '../fixtures/meta-2026-07-10.expected.json';
import {
  analyzeCompany,
  computeDerivedRows,
  momentumFromHistory,
  fiftyTwoWeekRange,
  trimmeanExcel,
  roundExcel,
  irr,
  type CompanySnapshot,
  type DerivedRow,
  type Maybe,
} from '../src/index';

const fixture = fixtureJson as unknown as CompanySnapshot;
const expected = expectedJson as {
  scalars: Record<string, number | string | null>;
  derivedRows: Record<string, Record<string, number | string | null>>;
  base5Forecast: Record<string, number>[];
  base3Forecast: Record<string, number>[];
  irrStrip: { price: number; irr: number | string | null }[];
};

const ARITH_TOL = 1e-9;
const IRR_TOL = 1e-6;

function expectClose(
  actual: Maybe,
  exp: number | string | null | undefined,
  relTol = ARITH_TOL,
  label = '',
) {
  if (exp === null || exp === undefined || typeof exp === 'string') {
    // cached "" / '#NUM!' / text states are asserted separately by status
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  const a = actual as number;
  if (exp === 0) {
    expect(Math.abs(a), label).toBeLessThanOrEqual(relTol);
  } else {
    expect(Math.abs(a - exp) / Math.abs(exp), label).toBeLessThanOrEqual(relTol);
  }
}

const analysis = analyzeCompany(fixture);
const S = expected.scalars;

describe('META gate: snapshot integrity', () => {
  it('carries the headline inputs from the sheet', () => {
    expect(fixture.quote.price).toBe(631.48); // I6
    expect(fixture.quote.marketCap).toBe(1636079379597); // D9
    expect(fixture.snapshotMarketCap).toBe(1664086890000); // P53
    expect(fixture.snapshotShares).toBe(2574000000); // O53
    const ttm = fixture.rows[fixture.rows.length - 1]!;
    expect(ttm.revenue).toBe(200966000000); // D53
    expect(ttm.operatingIncome).toBe(83276000000); // F53
    expect(ttm.operatingCashFlow).toBe(115800000000); // H53
    expect(ttm.capex).toBe(-69691000000); // I53, negative as stored
    expect(ttm.sbc).toBe(20427000000); // J53
    expect(ttm.netDebt).toBe(48024000000); // M53
    expect(ttm.netIncome).toBe(60458000000); // X53
    expect(ttm.tangibleBook).toBe(192709000000); // T53
    expect(fixture.roic).toBe(0.1795); // E15
  });

  it('computes TTM Adj FCF and EV under the sheet sign convention', () => {
    const ttmDerived = analysis.derived[analysis.derived.length - 1]!;
    expectClose(ttmDerived.adjFcf, 165064000000, ARITH_TOL, 'K53');
    expectClose(ttmDerived.enterpriseValue, S.enterpriseValueTTM as number, ARITH_TOL, 'Q53');
  });
});

describe('META gate: header metrics', () => {
  const h = analysis.header;
  it('P/E (live cap) E10', () => expectClose(h.peLiveCap, S.peLiveCap as number));
  it('P/E (snapshot cap) Q120', () => expectClose(h.peSnapshotCap, S.peSnapshotCap as number));
  it('EV / Op Income E11', () =>
    expectClose(h.evOverOperatingIncome, S.evOverOperatingIncome as number));
  it('EV/EBIT other-metrics twin Q119', () =>
    expectClose(h.evOverOperatingIncome, S.evEbitOther as number));
  it('Adj FCF yield E12', () => expectClose(h.adjFcfYield, S.adjFcfYield as number));
  it('Net debt / Op income E13', () =>
    expectClose(h.netDebtOverOpIncome, S.netDebtOverOpIncome as number));
  it('Operating margin E14', () => expectClose(h.operatingMargin, S.operatingMargin as number));
  it('ROIC (provider) E15', () => expect(h.roic).toBe(0.1795));
  it('P / Tangible book Q121', () =>
    expectClose(h.priceToTangibleBook, S.priceToTangibleBook as number));
  it('P / Adj OCF Q122', () => expectClose(h.priceToAdjOcf, S.priceToAdjOcf as number));
  it('P / Adj FCF Q123', () => expectClose(h.priceToAdjFcf, S.priceToAdjFcf as number));
  it('Adj ROIC Q124', () => expectClose(h.adjRoic as Maybe, S.adjRoic as number));
});

describe('META gate: per-year derived columns (E,G,K,L,N,R,S,W,Y,Z,AA,AB)', () => {
  const COLMAP: Record<string, keyof DerivedRow> = {
    E: 'revenueYoY',
    G: 'operatingMargin',
    K: 'adjFcf',
    L: 'adjFcfMargin',
    N: 'netDebtToEbit',
    R: 'adjFcfYield',
    S: 'evToEbit',
    W: 'grossMargin',
    Y: 'netMargin',
    Z: 'opIncMinusNetInc',
    AA: 'grossProfitMinusOpInc',
    AB: 'revenueMinusGrossProfit',
  };
  for (let i = 0; i < fixture.rows.length; i++) {
    const sheetRow = 34 + i;
    it(`row ${sheetRow} (${fixture.rows[i]!.yearLabel})`, () => {
      const exp = expected.derivedRows[String(sheetRow)]!;
      const act = analysis.derived[i]!;
      for (const [col, key] of Object.entries(COLMAP)) {
        expectClose(act[key] as Maybe, exp[col] as number | null, ARITH_TOL, `${col}${sheetRow}`);
      }
    });
  }
});

describe('META gate: summary statistics (row 54)', () => {
  const sum = analysis.summary;
  const cases: [string, Maybe][] = [
    ['revenueCagr8', sum.revenueCagr8],
    ['revenueYoyAvg4', sum.revenueYoyAvg4],
    ['operatingIncomeCagr8', sum.operatingIncomeCagr8],
    ['operatingMarginAvg4', sum.operatingMarginAvg4],
    ['ocfCagr8', sum.ocfCagr8],
    ['capexCagr8', sum.capexCagr8],
    ['sbcCagr8', sum.sbcCagr8],
    ['adjFcfCagr8', sum.adjFcfCagr8],
    ['adjFcfMarginAvg4', sum.adjFcfMarginAvg4],
    ['netDebtEbitAvg13', sum.netDebtEbitAvg13],
    ['sharesCagr10', sum.sharesCagr10],
    ['marketCapCagr10', sum.marketCapCagr10],
    ['evCagr10', sum.evCagr10],
    ['adjFcfYieldTrimmean', sum.adjFcfYieldTrimmean],
    ['evEbitTrimmean', sum.evEbitTrimmean],
    ['tangibleBookCagr10', sum.tangibleBookCagr10],
  ];
  for (const [name, actual] of cases) {
    it(name, () => expectClose(actual, S[name] as number | null, ARITH_TOL, name));
  }
  it('netDebtCagr10 (M54) errors to blank: negative base', () => {
    expect(sum.netDebtCagr10).toBeNull();
  });
});

describe('META gate: seeded Base 5-year block', () => {
  const v = analysis.scenarios.base[5];
  it('status ok', () => expect(v.status).toBe('ok'));
  it('forecast grid rows 63:67', () => {
    for (let t = 0; t < 5; t++) {
      const exp = expected.base5Forecast[t]!;
      const act = v.forecast[t]!;
      expect(act.year).toBe(exp.year);
      expectClose(act.revenue, exp.revenue, ARITH_TOL, `D${63 + t}`);
      expectClose(act.revenueYoY, exp.revenueYoY, ARITH_TOL, `E${63 + t}`);
      expectClose(act.operatingIncome, exp.operatingIncome, ARITH_TOL, `F${63 + t}`);
      expectClose(act.operatingMargin, exp.operatingMargin, ARITH_TOL, `G${63 + t}`);
      expectClose(act.adjFcfMargin, exp.adjFcfMargin, ARITH_TOL, `H${63 + t}`);
      expectClose(act.adjFcf, exp.adjFcf, ARITH_TOL, `I${63 + t}`);
      expectClose(act.pvOfAdjFcf, exp.pvOfAdjFcf, ARITH_TOL, `J${63 + t}`);
    }
  });
  it('exit multiple N61 = S53', () => expectClose(v.exitMultiple, S.base5ExitMultiple as number));
  it('terminal EV N62', () => expectClose(v.terminalEv, S.base5TerminalEv as number));
  it('net debt N63', () => expectClose(v.netDebt, S.base5NetDebt as number));
  it('terminal market cap N65', () =>
    expectClose(v.terminalMarketCap, S.base5TerminalMarketCap as number));
  it('intrinsic value N67', () => expectClose(v.intrinsicValue, S.base5IntrinsicValue as number));
  it('IRR Q61 / S6', () => {
    expectClose(v.irr, S.base5Irr as number, IRR_TOL, 'Q61');
    expectClose(v.irr, S.headerBaseIrr as number, IRR_TOL, 'S6');
  });
  it('fair value Q63 / R6', () => {
    expectClose(v.fairValuePerShare, S.base5FairValue as number, ARITH_TOL, 'Q63');
    expectClose(v.fairValuePerShare, S.headerBaseFairValue as number, ARITH_TOL, 'R6');
  });
  it('price delta T6', () =>
    expectClose(v.priceDelta, S.headerBasePriceDelta as number, ARITH_TOL, 'T6'));
  it('5-yr price change Q66', () =>
    expectClose(v.horizonPriceChange, S.base5PriceChange as number, IRR_TOL, 'Q66'));
});

describe('META gate: seeded Base 3-year block (incl. nper=5 quirk)', () => {
  const v = analysis.scenarios.base[3];
  it('status ok', () => expect(v.status).toBe('ok'));
  it('forecast grid rows 88:90', () => {
    for (let t = 0; t < 3; t++) {
      const exp = expected.base3Forecast[t]!;
      const act = v.forecast[t]!;
      expect(act.year).toBe(exp.year);
      expectClose(act.revenue, exp.revenue, ARITH_TOL, `D${88 + t}`);
      expectClose(act.adjFcf, exp.adjFcf, ARITH_TOL, `I${88 + t}`);
      expectClose(act.pvOfAdjFcf, exp.pvOfAdjFcf, ARITH_TOL, `J${88 + t}`);
    }
  });
  it('exit multiple N86 = N61 - 2', () =>
    expectClose(v.exitMultiple, S.base3ExitMultiple as number));
  it('terminal EV N87', () => expectClose(v.terminalEv, S.base3TerminalEv as number));
  it('terminal market cap N90', () =>
    expectClose(v.terminalMarketCap, S.base3TerminalMarketCap as number));
  it('intrinsic value N92 (terminal discounted 5 periods, sheet quirk)', () =>
    expectClose(v.intrinsicValue, S.base3IntrinsicValue as number));
  it('IRR Q86', () => expectClose(v.irr, S.base3Irr as number, IRR_TOL, 'Q86'));
  it('fair value Q88', () =>
    expectClose(v.fairValuePerShare, S.base3FairValue as number, ARITH_TOL, 'Q88'));
  it('3-yr price change Q91', () =>
    expectClose(v.horizonPriceChange, S.base3PriceChange as number, IRR_TOL, 'Q91'));
});

describe('META gate: unedited Bear/Bull states', () => {
  it('Bear 5y is No Forecast (Q69 = NA, S7 = No Forecast)', () => {
    const v = analysis.scenarios.bear[5];
    expect(S.bear5Irr).toBe('NA');
    expect(S.headerBearIrr).toBe('No Forecast');
    expect(v.status).toBe('no-forecast');
    expect(v.irr).toBeNull();
    expect(v.fairValuePerShare).toBeNull();
  });
  it('Bear 5y intrinsic value N75 still computes', () => {
    expectClose(
      analysis.scenarios.bear[5].intrinsicValue,
      S.bear5IntrinsicValue as number,
      ARITH_TOL,
      'N75',
    );
  });
  it('Bull 5y is No Forecast', () => {
    expect(S.bull5Irr).toBe('NA');
    expect(analysis.scenarios.bull[5].status).toBe('no-forecast');
  });
  it('Bear 3y hits the countif=10 quirk: #NUM!, not No Forecast', () => {
    const v = analysis.scenarios.bear[3];
    expect(S.bear3Irr).toBe('#NUM!');
    expect(v.status).toBe('num-error');
    expect(v.irr).toBeNull();
    expect(v.fairValuePerShare).toBeNull();
  });
  it('3y exit multiple offsets: bear -3 (N94), bull -2 (N102)', () => {
    expect(analysis.scenarios.bear[3].exitMultiple).toBe(S.bear3ExitMultiple);
    expect(analysis.scenarios.bull[3].exitMultiple).toBe(S.bull3ExitMultiple);
  });
});

describe('META gate: IRR-at-price strip (L15:T16)', () => {
  it('reproduces the 9-cell grid and IRRs', () => {
    expect(analysis.irrStrip).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      const exp = expected.irrStrip[i]!;
      const act = analysis.irrStrip[i]!;
      expect(act.price, `price col ${i}`).toBe(exp.price);
      expectClose(act.irr, exp.irr as number, IRR_TOL, `IRR at ${exp.price}`);
    }
  });
  it('headline cells: IRR at 631 (P16) and 379 (L16)', () => {
    const at = (p: number) => analysis.irrStrip.find((c) => c.price === p)!.irr;
    expectClose(at(631), 0.3410459718, IRR_TOL, 'P16');
    expectClose(at(379), 0.5211114241, IRR_TOL, 'L16');
  });
});

describe('META gate: margin of safety and verdict', () => {
  it('target buy prices R11:T11', () => {
    const [t15, t20, t30] = analysis.marginOfSafety;
    expect(t15!.threshold).toBe(0.15);
    expectClose(t15!.targetBuyPrice, S.targetBuy15 as number, ARITH_TOL, 'R11');
    expectClose(t20!.targetBuyPrice, S.targetBuy20 as number, ARITH_TOL, 'S11');
    expectClose(t30!.targetBuyPrice, S.targetBuy30 as number, ARITH_TOL, 'T11');
  });
  it('verdict card F20:H22', () => {
    expect(analysis.verdict.bearFairValue).toBeNull(); // F21 blank
    expectClose(analysis.verdict.baseFairValue, S.verdictBaseFairValue as number, ARITH_TOL, 'G21');
    expect(analysis.verdict.bullFairValue).toBeNull(); // H21 blank
    expect(analysis.verdict.price).toBe(631.48);
  });
});

describe('engine primitives', () => {
  it('TRIMMEAN drops floor(n*0.4/2) from each tail (Excel semantics)', () => {
    // n=13, 40% trim -> drop 2 from each tail, average middle 9
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    expect(trimmeanExcel(vals, 0.4)).toBe(7);
  });
  it('ROUND is half-away-from-zero', () => {
    expect(roundExcel(0.5)).toBe(1);
    expect(roundExcel(-0.5)).toBe(-1);
    expect(roundExcel(63.148, 0)).toBe(63);
  });
  it('IRR returns null when no root exists', () => {
    expect(irr([-100, -5, -5])).toBeNull();
    expect(irr([100, 5, 5])).toBeNull();
  });
  it('52-week range comes from price history', () => {
    const { high, low } = fiftyTwoWeekRange(fixture.priceHistory);
    expect(high).not.toBeNull();
    expect(low).not.toBeNull();
    expect(high!).toBeGreaterThan(low!);
  });
  it('momentum helper matches the sheet formula shape on history', () => {
    const m = momentumFromHistory(fixture.priceHistory, fixture.priceHistory.at(-1)!.date);
    expect(m).not.toBeNull();
  });
  it('capex treatment toggle: conventional differs from sheet default', () => {
    const conventional = computeDerivedRows(fixture.rows, 'conventional');
    const ttm = conventional[conventional.length - 1]!;
    // OCF - |capex| - SBC = 115800 - 69691 - 20427 (millions)
    expectClose(ttm.adjFcf, 25682000000, ARITH_TOL, 'conventional TTM FCF');
  });
});
