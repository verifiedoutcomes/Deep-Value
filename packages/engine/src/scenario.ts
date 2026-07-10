/**
 * Forecast scenarios and valuation: seeding, forecast grid, terminal value,
 * intrinsic value, fair value, IRR, IRR-at-price strip, margin of safety
 * and the verdict card. Replicates sheet blocks N61..Q108 exactly,
 * including their quirks (flagged inline).
 */
import type {
  DerivedRow,
  ForecastYear,
  HistoricalRowInput,
  HorizonYears,
  IrrStripCell,
  MarginOfSafetyRow,
  Maybe,
  ScenarioInputs,
  ScenarioKind,
  ScenarioValuation,
  ScenarioYearInput,
  VerdictCard,
} from './types';
import { irr, npvExcel, pvExcel, roundExcel } from './math';

/** Anchor values every valuation needs, all taken from the snapshot. */
export interface ValuationAnchors {
  /** D53: TTM revenue that the forecast compounds off. */
  ttmRevenue: number;
  /** M53: net debt subtracted from the terminal EV. */
  netDebt: number;
  /** P53: snapshot market cap -- the IRR outlay and fair-value denominator. */
  snapshotMarketCap: number;
  /** I6: current price. */
  price: number;
  /** First forecast calendar year (C63; latest full FY + 1). */
  firstForecastYear: number;
}

export function anchorsFromRows(
  rows: HistoricalRowInput[],
  snapshotMarketCap: number,
  price: number,
): ValuationAnchors {
  const n = rows.length;
  const ttm = rows[n - 1];
  const latestFy = rows[n - 2];
  if (!ttm || ttm.yearLabel !== 'TTM' || !latestFy) {
    throw new Error('rows must end with [.., latest FY, TTM]');
  }
  return {
    ttmRevenue: ttm.revenue ?? 0,
    netDebt: ttm.netDebt ?? 0,
    snapshotMarketCap,
    price,
    firstForecastYear: Number(latestFy.yearLabel) + 1,
  };
}

/**
 * Auto-seeded Base case (rows 63:67 / 88:90):
 *  - year-1 growth = latest full-FY YoY (E52), held flat through year 3,
 *    then minus one point in each of years 4 and 5. The 3-year variant
 *    seeds year 1 identically then decays one point in years 2 and 3.
 *  - operating margin held flat at the TTM level (G53).
 *  - Adj FCF margin held flat at the latest-FY level (L52). Note the sheet
 *    mixes references here (TTM for op margin, FY-latest for FCF margin);
 *    replicated as-is.
 */
export function seedBaseScenario(
  derived: DerivedRow[],
  horizon: HorizonYears,
): ScenarioYearInput[] {
  const n = derived.length;
  const latestFy = derived[n - 2];
  const ttm = derived[n - 1];
  const e = latestFy?.revenueYoY ?? 0;
  const g = ttm?.operatingMargin ?? 0;
  const h = latestFy?.adjFcfMargin ?? 0;
  const yoy =
    horizon === 5
      ? [e, e, e, e - 0.01, e - 0.02]
      : [e, e - 0.01, e - 0.02];
  return yoy.map((revenueYoY) => ({
    revenueYoY,
    operatingMargin: g,
    adjFcfMargin: h,
  }));
}

/**
 * Bear and Bull default to zero margins ("No Forecast" until edited), but
 * the sheet's growth column still applies its decay pattern to the zero
 * seed (E74 = -1%, E75 = -2%), so revenue drifts below TTM. Replicated.
 */
export function seedEmptyScenario(horizon: HorizonYears): ScenarioYearInput[] {
  const yoy = horizon === 5 ? [0, 0, 0, -0.01, -0.02] : [0, -0.01, -0.02];
  return yoy.map((revenueYoY) => ({
    revenueYoY,
    operatingMargin: 0,
    adjFcfMargin: 0,
  }));
}

/**
 * Default exit multiples: Base 5y auto-seeds to the current EV/EBIT (S53);
 * Bear/Bull 5y default to 0. The 3-year multiples are DERIVED from the
 * 5-year ones with per-scenario offsets exactly as the sheet's formulas
 * have them: base N86 = N61 - 2, bear N94 = N69 - 3, bull N102 = N77 - 2.
 * (The bear offset of 3 is the sheet's own inconsistency; kept as-is.)
 */
export function derive3yExitMultiple(kind: ScenarioKind, fiveYearMultiple: number): number {
  const offset = kind === 'bear' ? 3 : 2;
  return fiveYearMultiple - offset;
}

function isAllMarginsZero(years: ScenarioYearInput[]): boolean {
  return years.every((y) => y.operatingMargin === 0 && y.adjFcfMargin === 0);
}

export function computeForecast(
  anchors: ValuationAnchors,
  years: ScenarioYearInput[],
  fcfDiscountRate: number,
): ForecastYear[] {
  const out: ForecastYear[] = [];
  let prevRevenue = anchors.ttmRevenue;
  for (let t = 0; t < years.length; t++) {
    const y = years[t]!;
    const revenue = prevRevenue * (1 + y.revenueYoY);
    const operatingIncome = y.operatingMargin * revenue;
    const adjFcf = y.adjFcfMargin * revenue;
    // J column: year 1 discounted one period (exponent = year index + 1)
    const pvOfAdjFcf = adjFcf / Math.pow(1 + fcfDiscountRate, t + 1);
    out.push({
      year: anchors.firstForecastYear + t,
      revenue,
      revenueYoY: y.revenueYoY,
      operatingIncome,
      operatingMargin: y.operatingMargin,
      adjFcfMargin: y.adjFcfMargin,
      adjFcf,
      pvOfAdjFcf,
    });
    prevRevenue = revenue;
  }
  return out;
}

export function computeScenarioValuation(
  anchors: ValuationAnchors,
  inputs: ScenarioInputs,
): ScenarioValuation {
  const horizon = inputs.years.length as HorizonYears;
  const forecast = computeForecast(anchors, inputs.years, inputs.fcfDiscountRate);
  const finalYear = forecast[forecast.length - 1]!;

  const terminalEv = finalYear.operatingIncome * inputs.exitMultiple; // N62
  const terminalMarketCap =
    terminalEv - anchors.netDebt + inputs.adjustmentMillions * 1_000_000; // N65

  // N67 / N92: sum of FCF PVs + PV(rate, 5, 0, -terminal cap).
  // QUIRK (replicated for fixture parity): the sheet's 3-year block N92
  // still uses nper = 5 in its PV term, discounting the 3-year terminal
  // market cap FIVE periods instead of three.
  const intrinsicValue =
    forecast.reduce((a, f) => a + f.pvOfAdjFcf, 0) +
    pvExcel(inputs.terminalDiscountRate, 5, 0, -terminalMarketCap);

  // "No Forecast" gate: countif(G..:H..,"=0") = 10. Only the 5-year blocks
  // have 10 margin cells; the 3-year blocks compare a 6-cell range against
  // 10, which is never true, so a zero 3-year scenario computes an IRR of
  // all-negative flows and yields #NUM! instead of "No Forecast".
  // Sheet quirk, replicated exactly.
  const noForecast = horizon === 5 && isAllMarginsZero(inputs.years);

  let status: ScenarioValuation['status'] = 'ok';
  let irrValue: Maybe = null;
  if (noForecast) {
    status = 'no-forecast';
  } else {
    // Q61: IRR({-P53, I63, I64, I65, I66, I67 + N65})
    // Q86: IRR({-P53, I88, I89, I90 + N90})
    const flows = [
      -anchors.snapshotMarketCap,
      ...forecast.slice(0, -1).map((f) => f.adjFcf),
      finalYear.adjFcf + terminalMarketCap,
    ];
    irrValue = irr(flows);
    if (irrValue == null) status = 'num-error';
  }

  // Q63: if(Q61="NA","-",(N67/P$53)*I$6); an IRR #NUM! propagates.
  const fairValuePerShare =
    status === 'ok' ? (intrinsicValue / anchors.snapshotMarketCap) * anchors.price : null;
  const priceDelta =
    fairValuePerShare == null ? null : fairValuePerShare / anchors.price - 1; // T6

  // Q66: (npv(Q61, I63:I66, I67)*(1+Q61)^5 + N65)/P$53 - 1 (and the
  // 3-year analogue with exponent 3).
  let horizonPriceChange: Maybe = null;
  if (status === 'ok' && irrValue != null) {
    horizonPriceChange =
      (npvExcel(irrValue, forecast.map((f) => f.adjFcf)) *
        Math.pow(1 + irrValue, horizon) +
        terminalMarketCap) /
        anchors.snapshotMarketCap -
      1;
  }

  return {
    status,
    forecast,
    exitMultiple: inputs.exitMultiple,
    terminalEv,
    netDebt: anchors.netDebt,
    terminalMarketCap,
    intrinsicValue,
    irr: status === 'ok' ? irrValue : null,
    fairValuePerShare,
    priceDelta,
    horizonPriceChange,
  };
}

/**
 * IRR-at-price sensitivity strip (L15:T16): a 9-cell price grid centred on
 * round(price), stepped by round(price/10), four steps down and four up
 * (the sheet's L..T chain resolves to exactly this). Each cell's IRR uses
 * outlay -P53 * (gridPrice / price) with the Base 5-year cash flows.
 */
export function computeIrrStrip(
  anchors: ValuationAnchors,
  base5: ScenarioValuation,
): IrrStripCell[] {
  const centre = roundExcel(anchors.price, 0); // P15
  const step = roundExcel(anchors.price / 10, 0);
  const cells: IrrStripCell[] = [];
  for (let k = -4; k <= 4; k++) {
    const gridPrice = centre + k * step;
    const flows = [
      -anchors.snapshotMarketCap * (gridPrice / anchors.price),
      ...base5.forecast.slice(0, -1).map((f) => f.adjFcf),
      base5.forecast[base5.forecast.length - 1]!.adjFcf + base5.terminalMarketCap,
    ];
    cells.push({ price: gridPrice, irr: irr(flows) });
  }
  return cells;
}

/** Margin of safety (Q10:T11): Target Buy = base fair value x (1 - t). */
export function computeMarginOfSafety(
  baseFairValue: Maybe,
  thresholds: number[],
): MarginOfSafetyRow[] {
  return thresholds.map((threshold) => ({
    threshold,
    targetBuyPrice: baseFairValue == null ? null : baseFairValue * (1 - threshold),
  }));
}

/** Verdict card (F20:H22): scenario fair values vs the current price. */
export function computeVerdict(
  price: number,
  bear: ScenarioValuation,
  base: ScenarioValuation,
  bull: ScenarioValuation,
): VerdictCard {
  const fv = (s: ScenarioValuation): Maybe =>
    s.status === 'ok' ? s.fairValuePerShare : null;
  return {
    bearFairValue: fv(bear),
    baseFairValue: fv(base),
    bullFairValue: fv(bull),
    price,
  };
}
