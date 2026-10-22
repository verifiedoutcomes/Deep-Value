import { Platform } from 'react-native';

/** Dense, terminal-flavoured dark theme. */
export const colors = {
  bg: '#0B0F14',
  surface: '#111820',
  surfaceAlt: '#0E141B',
  border: '#1E2A36',
  text: '#D7E1EA',
  textDim: '#7E8FA0',
  textFaint: '#54636F',
  accent: '#4CC38A', // gains / buy
  accentDim: '#1E4634',
  red: '#E5534B', // losses
  redDim: '#3A1D1F', // loss-cell fill (sensitivity grid)
  redSoft: '#F2B8B5', // text on redDim
  amber: '#D9A036',
  blue: '#539BF5', // sparklines (sheet's 0044CC, lifted for dark bg)
  blueDim: '#274B78',
  chipBg: '#16202B',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const type = {
  // Native takes one family name; browsers get a fallback stack (Menlo
  // exists on Apple devices only).
  mono: Platform.OS === 'web' ? 'Menlo, ui-monospace, SFMono-Regular, Consolas, monospace' : 'Menlo',
  size: { xs: 10, sm: 12, md: 14, lg: 17, xl: 22 },
} as const;

export function deltaColor(v: number | null | undefined): string {
  if (v == null) return colors.textDim;
  return v > 0 ? colors.accent : v < 0 ? colors.red : colors.textDim;
}
