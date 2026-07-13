/**
 * Price chart: trailing TWO years of weekly closes with 52-week high/low
 * markers. Labels are clamped inside the canvas and the y-domain includes
 * the 52-week band, so nothing ever renders off-chart.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import type { PricePoint } from '@dvh/engine';
import { fiftyTwoWeekRange } from '@dvh/engine';
import { colors, type } from '../theme';
import { Mono } from './ui';

const LOOKBACK_WEEKS = 104; // 2 years

export function PriceChart({
  history,
  width,
  height = 160,
}: {
  history: PricePoint[];
  width: number;
  height?: number;
}) {
  const window = history.slice(Math.max(0, history.length - LOOKBACK_WEEKS));
  if (window.length < 2) {
    return <Mono color={colors.textDim}>price history unavailable</Mono>;
  }
  // 52-week range from the full history (helper looks back from the last date)
  const { high, low } = fiftyTwoWeekRange(history);

  const closes = window.map((p) => p.close);
  // domain includes the 52w band so its lines always fit on-canvas
  const min = Math.min(...closes, ...(low != null ? [low] : []));
  const max = Math.max(...closes, ...(high != null ? [high] : []));
  const range = max - min || 1;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 16;
  const x = (i: number) => (i / (window.length - 1)) * width;
  const y = (v: number) =>
    height - PAD_BOTTOM - ((v - min) / range) * (height - PAD_TOP - PAD_BOTTOM);
  /** Keep a text baseline inside the canvas. */
  const clampY = (v: number) => Math.min(Math.max(v, 11), height - 3);

  const d = window
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`)
    .join(' ');

  const last = closes[closes.length - 1]!;
  const first = closes[0]!;
  const up = last >= first;

  return (
    <View>
      <Svg width={width} height={height}>
        {high != null && (
          <>
            <Line
              x1={0}
              x2={width}
              y1={y(high)}
              y2={y(high)}
              stroke={colors.textFaint}
              strokeDasharray="3 4"
              strokeWidth={0.5}
            />
            <SvgText
              x={4}
              y={clampY(y(high) - 4)}
              fill={colors.textFaint}
              fontSize={type.size.xs}
            >
              {`52wH ${high.toFixed(0)}`}
            </SvgText>
          </>
        )}
        {low != null && (
          <>
            <Line
              x1={0}
              x2={width}
              y1={y(low)}
              y2={y(low)}
              stroke={colors.textFaint}
              strokeDasharray="3 4"
              strokeWidth={0.5}
            />
            <SvgText
              x={4}
              y={clampY(y(low) + 11)}
              fill={colors.textFaint}
              fontSize={type.size.xs}
            >
              {`52wL ${low.toFixed(0)}`}
            </SvgText>
          </>
        )}
        <Path d={d} stroke={up ? colors.accent : colors.red} strokeWidth={1.25} fill="none" />
      </Svg>
    </View>
  );
}
