/**
 * Spreadsheet-function primitives, implemented to Excel/Google Sheets
 * semantics because every engine output is validated byte-for-byte against
 * the sheet's cached values.
 */
import type { Maybe } from './types';

/** IFERROR(a/b, ""): null on missing operands or division by zero. */
export function safeDiv(a: Maybe | undefined, b: Maybe | undefined): Maybe {
  if (a == null || b == null || b === 0) return null;
  const q = a / b;
  return Number.isFinite(q) ? q : null;
}

/** IFERROR(a-b-c, "") style subtraction chain. */
export function safeSub(...terms: (Maybe | undefined)[]): Maybe {
  let acc: number | null = null;
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    if (t == null) return null;
    acc = i === 0 ? t : (acc as number) - t;
  }
  return acc;
}

/** (end/start)^(1/n) - 1 with Excel error semantics (#NUM! -> null). */
export function cagr(end: Maybe | undefined, start: Maybe | undefined, years: number): Maybe {
  if (end == null || start == null || start === 0) return null;
  const ratio = end / start;
  // Excel: negative base with fractional exponent is #NUM!
  if (ratio < 0) return null;
  const r = Math.pow(ratio, 1 / years) - 1;
  return Number.isFinite(r) ? r : null;
}

/** AVERAGE ignoring blanks (nulls); null when no numeric values. */
export function average(values: (Maybe | undefined)[]): Maybe {
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * TRIMMEAN to Excel semantics: excludes floor(n * percent / 2) data points
 * from EACH tail of the sorted data set.
 */
export function trimmeanExcel(values: (Maybe | undefined)[], percent: number): Maybe {
  const nums = values.filter((v): v is number => typeof v === 'number');
  const n = nums.length;
  if (n === 0 || percent < 0 || percent >= 1) return null;
  const dropEach = Math.floor((n * percent) / 2);
  const sorted = [...nums].sort((a, b) => a - b);
  const kept = sorted.slice(dropEach, n - dropEach);
  if (kept.length === 0) return null;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/** Excel ROUND: half away from zero. */
export function roundExcel(x: number, digits = 0): number {
  const f = Math.pow(10, digits);
  return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f;
}

/** Excel PV(rate, nper, 0, fv) with pmt = 0: -fv / (1+rate)^nper. */
export function pvExcel(rate: number, nper: number, pmt: number, fv: number): number {
  if (rate === 0) return -(fv + pmt * nper);
  const g = Math.pow(1 + rate, nper);
  return -(fv + (pmt * (g - 1)) / rate) / g;
}

/** Excel NPV(rate, v1..vn) = sum v_i / (1+rate)^i, i starting at 1. */
export function npvExcel(rate: number, values: number[]): number {
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i]! / Math.pow(1 + rate, i + 1);
  }
  return acc;
}

/** Derivative wrt rate of the t0-anchored NPV used by irr(). */
function npvDerivative(rate: number, values: number[]): number {
  let acc = 0;
  for (let i = 1; i < values.length; i++) {
    acc += (-i * values[i]!) / Math.pow(1 + rate, i + 1);
  }
  return acc;
}

function npvFromT0(rate: number, values: number[]): number {
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i]! / Math.pow(1 + rate, i);
  }
  return acc;
}

/**
 * Excel IRR: cash flow vector with values[0] at t=0. Newton-Raphson from
 * `guess` (default 0.1 like Excel), with a bisection fallback over a
 * sign-change bracket. Returns null when no root exists (#NUM!).
 */
export function irr(values: number[], guess = 0.1): Maybe {
  const hasPos = values.some((v) => v > 0);
  const hasNeg = values.some((v) => v < 0);
  if (!hasPos || !hasNeg) return null;

  const f = (r: number) => npvFromT0(r, values);

  // Newton-Raphson
  let rate = guess;
  for (let iter = 0; iter < 50; iter++) {
    const y = f(rate);
    if (Math.abs(y) < 1e-11 * Math.abs(values[0]!)) {
      if (rate <= -1) break;
      return rate;
    }
    const d = npvDerivative(rate, values);
    if (d === 0 || !Number.isFinite(d)) break;
    const next = rate - y / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < 1e-12) {
      return next;
    }
    rate = next;
  }

  // Bisection fallback: scan for a sign change on a wide bracket.
  let lo = -0.999999999;
  let hi = 10;
  let flo = f(lo);
  const STEPS = 4000;
  let prevR = lo;
  let prevF = flo;
  let bracket: [number, number] | null = null;
  for (let i = 1; i <= STEPS; i++) {
    const r = lo + ((hi - lo) * i) / STEPS;
    const fr = f(r);
    if (Number.isFinite(fr) && Number.isFinite(prevF) && prevF * fr <= 0) {
      bracket = [prevR, r];
      break;
    }
    prevR = r;
    prevF = fr;
  }
  if (!bracket) return null;
  let [a, b] = bracket;
  let fa = f(a);
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0 || (b - a) / 2 < 1e-13) return m;
    if (fa * fm < 0) {
      b = m;
    } else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}
