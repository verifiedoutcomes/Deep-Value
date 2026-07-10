/**
 * FX handling, mirroring the `Currency Conversion` sheet: a per-year table
 * of {currency -> USD} factors. Column B of the analysis sheet looks the
 * factor up by {fiscal year, reporting currency} and multiplies every
 * fetched fundamental by it.
 *
 * USD-only behaviour is implemented now (factor 1); the interface is the
 * internationalisation hook for other markets later.
 */

export interface FxTable {
  /** factor to multiply a `currency` amount by to get USD, for a year. */
  factor(currency: string, fiscalYear: number | 'TTM'): number;
}

export class UsdOnlyFxTable implements FxTable {
  factor(currency: string, _fiscalYear: number | 'TTM'): number {
    if (currency !== 'USD') {
      throw new Error(
        `FX factors for ${currency} not loaded: only USD reporters are supported at launch`,
      );
    }
    return 1;
  }
}

/** Static table in the shape of the Currency Conversion sheet (rows 4:23). */
export class StaticFxTable implements FxTable {
  constructor(
    private readonly byYear: Record<number, Record<string, number>>,
    private readonly latestYear: number,
  ) {}

  factor(currency: string, fiscalYear: number | 'TTM'): number {
    if (currency === 'USD') return 1;
    const year = fiscalYear === 'TTM' ? this.latestYear : fiscalYear;
    const f = this.byYear[year]?.[currency];
    if (f == null) throw new Error(`no FX factor for ${currency} in ${year}`);
    return f;
  }
}
