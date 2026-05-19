/**
 * Clerque Counter — brand mark (brown earth-tone)
 *
 * Pixel-faithful to the `.brand-mark-glyph` SVG in design-source-v3:
 *   brown rounded-square backdrop + small inner rounded square (22% alpha
 *   white) + Plus Jakarta Sans "c" centered on top.
 *
 * Sizes: 28dp (top-bar), 40dp (medium), 96dp (splash), 152dp (tablet splash).
 *
 * Use this for in-app chrome (top bar, splash). The full purple ecosystem
 * mark (ClerqueLogo.tsx) is only for the marketing pages and is NOT what
 * the design source uses inside Counter itself.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { colors } from '@/theme';

interface Props {
  size: number;
  /** Outer corner radius. Defaults to size * 0.28 (matches design CSS). */
  radius?: number;
}

export default function CounterMark({ size, radius }: Props): React.ReactElement {
  const r = radius ?? Math.round(size * 0.28);
  // The inner rounded square sits inset by 12.5% — same ratio as the design's
  // viewBox 80×80 rect(10,10,60,60) inner.
  const inner = size * 0.75;
  const innerOffset = size * 0.125;
  const innerR = size * 0.22;
  // "c" font sized at 65% of the size, baseline near 70% so the optical
  // center sits inside the inner square.
  const fontSize = size * 0.65;
  const baselineY = size * 0.72;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Rect x={0} y={0} width={size} height={size} rx={r} ry={r} fill={colors.primary} />
        <Rect
          x={innerOffset}
          y={innerOffset}
          width={inner}
          height={inner}
          rx={innerR}
          ry={innerR}
          fill="rgba(255,255,255,0.22)"
        />
        <SvgText
          x={size / 2}
          y={baselineY}
          fontFamily="Plus Jakarta Sans"
          fontWeight="800"
          fontSize={fontSize}
          fill="#FFFFFF"
          textAnchor="middle"
        >
          c
        </SvgText>
      </Svg>
    </View>
  );
}
