/** Seven-year weekly price chart with 52-week high/low markers. */
import React from 'react';
import { View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import type { PricePoint } from '@dvh/engine';
import { fiftyTwoWeekRange } from '@dvh/engine';
import { colors, type } from '../theme';
import { Mono } from './ui';

export function PriceChart({
  history,
  width,
  height = 160,
}: {
  history: PricePoint[];
  width: number;
  height?: number;
}) {
  if (history.length < 2) {
    return <Mono color={colors.textDim}>price history unavailable</Mono>;
  }
  const closes = history.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const x = (i: number) => (i / (history.length - 1)) * width;
  const y = (v: number) => height - ((v - min) / range) * (height - 18) - 9;

  const d = history
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`)
    .join(' ');

  const { high, low } = fiftyTwoWeekRange(history);
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
            <SvgText x={4} y={y(high) - 3} fill={colors.textFaint} fontSize={type.size.xs}>
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
            <SvgText x={4} y={y(low) + 10} fill={colors.textFaint} fontSize={type.size.xs}>
              {`52wL ${low.toFixed(0)}`}
            </SvgText>
          </>
        )}
        <Path d={d} stroke={up ? colors.accent : colors.red} strokeWidth={1.25} fill="none" />
      </Svg>
    </View>
  );
}
