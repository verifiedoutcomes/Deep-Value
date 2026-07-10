/**
 * Column sparkline (sheet row 55): small bar chart over the last 11 table
 * rows with the final (TTM) bar highlighted, y-min anchored at min(v, 0).
 */
import React from 'react';
import Svg, { Rect } from 'react-native-svg';
import type { Maybe } from '@dvh/engine';
import { colors } from '../theme';

export function Sparkline({
  values,
  width = 72,
  height = 24,
}: {
  values: Maybe[];
  width?: number;
  height?: number;
}) {
  const nums = values.map((v) => (typeof v === 'number' ? v : 0));
  if (nums.length === 0) return <Svg width={width} height={height} />;
  const min = Math.min(...nums, 0);
  const max = Math.max(...nums, 0);
  const range = max - min || 1;
  const barW = width / nums.length;
  const zeroY = height - ((0 - min) / range) * height;
  return (
    <Svg width={width} height={height}>
      {nums.map((v, i) => {
        const y = height - ((v - min) / range) * height;
        const isLast = i === nums.length - 1;
        const top = Math.min(y, zeroY);
        const h = Math.max(Math.abs(zeroY - y), 1);
        return (
          <Rect
            key={i}
            x={i * barW + 0.5}
            y={top}
            width={Math.max(barW - 1, 1)}
            height={h}
            fill={isLast ? colors.red : colors.blue}
          />
        );
      })}
    </Svg>
  );
}
