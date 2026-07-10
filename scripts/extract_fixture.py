#!/usr/bin/env python3
"""Extract the META snapshot from Latest_Deep_Value_Hunter_Model.xlsx into
engine fixtures.

Outputs:
  packages/engine/fixtures/meta-2026-07-10.json           -- engine INPUTS
  packages/engine/fixtures/meta-2026-07-10.expected.json  -- cached sheet OUTPUTS

The META sheet is the executable specification; every value here is read from
the workbook's cached values (data_only=True), never hand-typed. If any
assertion in this script fails, the workbook layout has changed and the
extraction must be revisited -- do not edit the JSON by hand.
"""
import json
import datetime
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "Latest_Deep_Value_Hunter_Model.xlsx"
FIXTURE_DIR = ROOT / "packages" / "engine" / "fixtures"

# Historical table rows on the META sheet: 34..51 = FY2007..FY2024,
# 52 = latest full FY (2025), 53 = TTM.
FIRST_ROW, LAST_ROW = 34, 53

INPUT_COLS = {
    "B": "fx",
    "D": "revenue",
    "F": "operatingIncome",
    "H": "operatingCashFlow",
    "I": "capex",  # arrives NEGATIVE from the data layer -- sheet convention
    "J": "sbc",
    "M": "netDebt",
    "O": "shares",
    "P": "marketCap",
    "Q": "enterpriseValue",
    "T": "tangibleBook",
    "V": "grossProfit",
    "X": "netIncome",
}

DERIVED_COLS = ["E", "G", "K", "L", "N", "R", "S", "W", "Y", "Z", "AA", "AB"]

# Scalar cells whose cached values the engine must reproduce (or, for pure
# inputs, consume). Cell -> semantic name.
EXPECTED_SCALARS = {
    # header / summary card
    "E10": "peLiveCap",
    "Q120": "peSnapshotCap",
    "E11": "evOverOperatingIncome",
    "E12": "adjFcfYield",
    "E13": "netDebtOverOpIncome",
    "E14": "operatingMargin",
    "Q119": "evEbitOther",
    "Q121": "priceToTangibleBook",
    "Q122": "priceToAdjOcf",
    "Q123": "priceToAdjFcf",
    "Q124": "adjRoic",
    # TTM / snapshot anchors
    "Q53": "enterpriseValueTTM",
    # summary row 54
    "D54": "revenueCagr8",
    "E54": "revenueYoyAvg4",
    "F54": "operatingIncomeCagr8",
    "G54": "operatingMarginAvg4",
    "H54": "ocfCagr8",
    "I54": "capexCagr8",
    "J54": "sbcCagr8",
    "K54": "adjFcfCagr8",
    "L54": "adjFcfMarginAvg4",
    "N54": "netDebtEbitAvg13",
    "O54": "sharesCagr10",
    "P54": "marketCapCagr10",
    "Q54": "evCagr10",
    "R54": "adjFcfYieldTrimmean",
    "S54": "evEbitTrimmean",
    "T54": "tangibleBookCagr10",
    # base 5y valuation block
    "N61": "base5ExitMultiple",
    "N62": "base5TerminalEv",
    "N63": "base5NetDebt",
    "N65": "base5TerminalMarketCap",
    "N67": "base5IntrinsicValue",
    "Q61": "base5Irr",
    "Q63": "base5FairValue",
    "Q66": "base5PriceChange",
    "R6": "headerBaseFairValue",
    "S6": "headerBaseIrr",
    "T6": "headerBasePriceDelta",
    # base 3y valuation block
    "N86": "base3ExitMultiple",
    "N87": "base3TerminalEv",
    "N90": "base3TerminalMarketCap",
    "N92": "base3IntrinsicValue",
    "Q86": "base3Irr",
    "Q88": "base3FairValue",
    "Q91": "base3PriceChange",
    # bear/bull (unseeded -> error/no-forecast states)
    "Q69": "bear5Irr",
    "N75": "bear5IntrinsicValue",
    "Q77": "bull5Irr",
    "S7": "headerBearIrr",
    "S8": "headerBullIrr",
    "N94": "bear3ExitMultiple",
    "N102": "bull3ExitMultiple",
    "Q94": "bear3Irr",
    # margin of safety
    "R11": "targetBuy15",
    "S11": "targetBuy20",
    "T11": "targetBuy30",
    # verdict card
    "F21": "verdictBearFairValue",
    "G21": "verdictBaseFairValue",
    "H21": "verdictBullFairValue",
}


def cellv(ws, coord):
    v = ws[coord].value
    if isinstance(v, datetime.datetime):
        return v.isoformat()
    return v


def main():
    wbv = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wbv["META"]

    assert ws["C3"].value == "Static", "META sheet must be in Static mode"
    assert ws["C5"].value == "META"

    snapshot_date = ws["D8"].value
    assert isinstance(snapshot_date, datetime.datetime)

    rows = []
    for r in range(FIRST_ROW, LAST_ROW + 1):
        row = {"yearLabel": ws[f"C{r}"].value}
        for col, key in INPUT_COLS.items():
            if r == LAST_ROW and col == "Q":
                # Q53 = P53 + M53 is derived, not an input
                continue
            row[key] = ws[f"{col}{r}"].value
        rows.append(row)
    assert rows[0]["yearLabel"] == 2007 and rows[-1]["yearLabel"] == "TTM"

    # weekly price history AC54:AD449
    history = []
    for r in range(54, 450):
        d, c = ws[f"AC{r}"].value, ws[f"AD{r}"].value
        if d is None and c is None:
            continue
        assert isinstance(d, datetime.datetime), f"AC{r} = {d!r}"
        history.append({"date": d.date().isoformat(), "close": c})

    fixture = {
        "ticker": ws["C5"].value,
        "name": ws["F5"].value,
        "exchange": "NASDAQ",
        "reportingCurrency": ws["E16"].value,
        "snapshotDate": snapshot_date.date().isoformat(),
        "quote": {
            # I6: price refreshed on Update; D9: live market cap
            "price": ws["I6"].value,
            "marketCap": ws["D9"].value,
        },
        # O53/P53 in Static mode freeze to O52/P52 (load-time values)
        "snapshotShares": ws["O53"].value,
        "snapshotMarketCap": ws["P53"].value,
        # E15: ROIC comes straight from the data provider (DVH)
        "roic": ws["E15"].value,
        "ownership": {
            "insiderOwnership": ws["T119"].value,
            "insiderOwnershipChange": ws["T120"].value,
            "institutionalOwnership": ws["T121"].value,
            "shortInterest": ws["T122"].value,
            "momentum": ws["T124"].value,
        },
        "valuationDefaults": {
            # user-editable cells shipped with the snapshot
            "discountRate": ws["N66"].value,
            "adjustmentMillions5y": ws["N64"].value,
            "adjustmentMillions3y": ws["N89"].value,
            "marginOfSafetyThresholds": [
                ws["R10"].value, ws["S10"].value, ws["T10"].value,
            ],
        },
        "rows": rows,
        "priceHistory": history,
    }

    expected = {
        "scalars": {name: cellv(ws, coord) for coord, name in EXPECTED_SCALARS.items()},
        # per-year derived columns, cached: rows keyed by sheet row number
        "derivedRows": {
            str(r): {col: cellv(ws, f"{col}{r}") for col in DERIVED_COLS}
            for r in range(FIRST_ROW, LAST_ROW + 1)
        },
        # seeded Base 5y forecast grid, rows 63..67: C..J
        "base5Forecast": [
            {
                "year": ws[f"C{r}"].value,
                "revenue": ws[f"D{r}"].value,
                "revenueYoY": ws[f"E{r}"].value,
                "operatingIncome": ws[f"F{r}"].value,
                "operatingMargin": ws[f"G{r}"].value,
                "adjFcfMargin": ws[f"H{r}"].value,
                "adjFcf": ws[f"I{r}"].value,
                "pvOfAdjFcf": ws[f"J{r}"].value,
            }
            for r in range(63, 68)
        ],
        # seeded Base 3y forecast grid, rows 88..90
        "base3Forecast": [
            {
                "year": ws[f"C{r}"].value,
                "revenue": ws[f"D{r}"].value,
                "revenueYoY": ws[f"E{r}"].value,
                "operatingIncome": ws[f"F{r}"].value,
                "operatingMargin": ws[f"G{r}"].value,
                "adjFcfMargin": ws[f"H{r}"].value,
                "adjFcf": ws[f"I{r}"].value,
                "pvOfAdjFcf": ws[f"J{r}"].value,
            }
            for r in range(88, 91)
        ],
        # IRR-at-price strip: L..T columns, rows 15 (price) and 16 (IRR)
        "irrStrip": [
            {"price": ws[f"{c}15"].value, "irr": ws[f"{c}16"].value}
            for c in ["L", "M", "N", "O", "P", "Q", "R", "S", "T"]
        ],
    }

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    stem = f"meta-{snapshot_date.date().isoformat()}"
    (FIXTURE_DIR / f"{stem}.json").write_text(
        json.dumps(fixture, indent=2, allow_nan=False) + "\n"
    )
    (FIXTURE_DIR / f"{stem}.expected.json").write_text(
        json.dumps(expected, indent=2, allow_nan=False) + "\n"
    )
    print(f"wrote {stem}.json ({len(rows)} rows, {len(history)} weekly closes)")
    print(f"wrote {stem}.expected.json "
          f"({len(EXPECTED_SCALARS)} scalars, {LAST_ROW - FIRST_ROW + 1} derived rows)")


if __name__ == "__main__":
    sys.exit(main())
