/**
 * Clerque brand icon — React Native port of the web `ClerqueIcon`
 * (apps/web/lib/clerque-icon.tsx). Matches the master PNG / favicon
 * exactly so the Counter sign-in screen, splash, and launcher icon
 * all read as the same product.
 *
 * Visual:
 *   • Purple gradient rounded square (light → deep purple)
 *   • Three inset cards inside:
 *      1. Cream card with a serif "c"          → Counter (this app)
 *      2. Lavender card with 3 vertical dots   → Ledger
 *      3. Muted-purple card with 3 horizontal lines → Sync
 */

import React from 'react';
import { View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
  Text as SvgText,
  Circle,
} from 'react-native-svg';

export const CLERQUE_BG_FROM = '#A78BFA';
export const CLERQUE_BG_TO   = '#7C3AED';
export const CLERQUE_DARK    = '#5B21B6';

interface Props {
  size: number;
}

export default function ClerqueLogo({ size }: Props): React.ReactElement {
  // Proportional measurements scale with size — kept in lockstep with
  // the web version's ratios so the marks read identically.
  const radius     = size * 0.20;
  const cardWidth  = size * 0.16;
  const cardHeight = size * 0.34;
  const cardRadius = size * 0.04;
  const cardGap    = size * 0.03;
  const dotSize    = size * 0.05;
  const lineW      = size * 0.08;
  const lineH      = size * 0.018;
  const fontSize   = size * 0.20;

  // 3 cards centered horizontally inside the rounded square.
  const totalCards = cardWidth * 3 + cardGap * 2;
  const cardsStart = (size - totalCards) / 2;
  const cardY      = (size - cardHeight) / 2;

  const card1X = cardsStart;
  const card2X = cardsStart + cardWidth + cardGap;
  const card3X = cardsStart + (cardWidth + cardGap) * 2;

  return (
    <View>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <LinearGradient id="clerqueBg" x1="0" y1="0" x2={size} y2={size} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={CLERQUE_BG_FROM} />
            <Stop offset="1" stopColor={CLERQUE_BG_TO} />
          </LinearGradient>
        </Defs>

        {/* Purple gradient backdrop */}
        <Rect x={0} y={0} width={size} height={size} rx={radius} ry={radius} fill="url(#clerqueBg)" />

        {/* Card 1 — Counter (serif "c") */}
        <Rect x={card1X} y={cardY} width={cardWidth} height={cardHeight} rx={cardRadius} ry={cardRadius} fill="#F4ECFB" />
        <SvgText
          x={card1X + cardWidth / 2}
          y={cardY + cardHeight / 2 + fontSize * 0.35}
          fontFamily="Georgia, serif"
          fontWeight="700"
          fontSize={fontSize}
          fill={CLERQUE_DARK}
          textAnchor="middle"
        >
          c
        </SvgText>

        {/* Card 2 — Ledger (3 vertical dots) */}
        <Rect x={card2X} y={cardY} width={cardWidth} height={cardHeight} rx={cardRadius} ry={cardRadius} fill="#E9DCF7" />
        {[0, 1, 2].map((i) => {
          const totalH = dotSize * 3 + size * 0.025 * 2;
          const startY = cardY + (cardHeight - totalH) / 2 + dotSize / 2;
          return (
            <Circle
              key={i}
              cx={card2X + cardWidth / 2}
              cy={startY + i * (dotSize + size * 0.025)}
              r={dotSize / 2}
              fill={CLERQUE_BG_TO}
            />
          );
        })}

        {/* Card 3 — Sync (3 horizontal lines) */}
        <Rect x={card3X} y={cardY} width={cardWidth} height={cardHeight} rx={cardRadius} ry={cardRadius} fill="#DCC8F2" />
        {[0, 1, 2].map((i) => {
          const totalH = lineH * 3 + size * 0.025 * 2;
          const startY = cardY + (cardHeight - totalH) / 2;
          return (
            <Rect
              key={i}
              x={card3X + (cardWidth - lineW) / 2}
              y={startY + i * (lineH + size * 0.025)}
              width={lineW}
              height={lineH}
              rx={lineH / 2}
              ry={lineH / 2}
              fill={CLERQUE_BG_FROM}
            />
          );
        })}
      </Svg>
    </View>
  );
}
