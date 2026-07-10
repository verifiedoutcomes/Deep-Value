/** Terminal-dense number formatting. Nulls render as an em dash. */
import type { Maybe } from '@dvh/engine';

const DASH = '–';

export function money(v: Maybe, currency = '$'): string {
  if (v == null) return DASH;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${currency}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${currency}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${currency}${(abs / 1e6).toFixed(0)}M`;
  return `${sign}${currency}${abs.toFixed(0)}`;
}

export function price(v: Maybe, currency = '$'): string {
  if (v == null) return DASH;
  return `${currency}${v.toFixed(2)}`;
}

export function pct(v: Maybe, digits = 1): string {
  if (v == null) return DASH;
  return `${(v * 100).toFixed(digits)}%`;
}

export function pctSigned(v: Maybe, digits = 1): string {
  if (v == null) return DASH;
  const s = (v * 100).toFixed(digits);
  return v > 0 ? `+${s}%` : `${s}%`;
}

export function ratio(v: Maybe, digits = 1): string {
  if (v == null) return DASH;
  return `${v.toFixed(digits)}x`;
}

export function num(v: Maybe, digits = 2): string {
  if (v == null) return DASH;
  return v.toFixed(digits);
}

export function shares(v: Maybe): string {
  if (v == null) return DASH;
  return `${(v / 1e9).toFixed(2)}B`;
}
