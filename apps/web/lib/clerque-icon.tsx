/**
 * Clerque brand icon — shared JSX used by every icon route.
 *
 * Design (matches the user-supplied master PNG):
 *   - Purple gradient rounded square (light → deep purple)
 *   - 3 inset cards (one per app: Counter "C", Ledger dots, Sync lines)
 *   - Cards rendered in cream / lavender / muted-purple tints
 *
 * Used by app/icon.tsx (32px), app/apple-icon.tsx (180px),
 * app/icon1.tsx (192px), app/icon2.tsx (512px). All four call this
 * function with their own size so proportions stay consistent.
 *
 * Satori (next/og) supports HTML/CSS-in-JS via flexbox; we avoid SVG
 * here for broader Satori compatibility.
 */

export const CLERQUE_BG_FROM = '#A78BFA';
export const CLERQUE_BG_TO   = '#7C3AED';
export const CLERQUE_DARK    = '#5B21B6';

export function ClerqueIcon({ size }: { size: number }) {
  // Proportional measurements scale with size.
  const radius     = Math.round(size * 0.20);
  const cardWidth  = Math.round(size * 0.16);
  const cardHeight = Math.round(size * 0.34);
  const cardRadius = Math.round(size * 0.04);
  const cardGap    = Math.round(size * 0.03);
  const dotSize    = Math.round(size * 0.05);
  const lineW      = Math.round(size * 0.08);
  const lineH      = Math.round(size * 0.018);
  const fontSize   = Math.round(size * 0.20);

  return (
    <div
      style={{
        width:  '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${CLERQUE_BG_FROM} 0%, ${CLERQUE_BG_TO} 100%)`,
        borderRadius: radius,
        gap: cardGap,
      }}
    >
      {/* Card 1 — Counter (C in serif) */}
      <div
        style={{
          width: cardWidth,
          height: cardHeight,
          background: '#F4ECFB',
          borderRadius: cardRadius,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: CLERQUE_DARK,
          fontSize,
          fontFamily: 'Georgia, serif',
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        c
      </div>

      {/* Card 2 — Ledger (3 vertical dots) */}
      <div
        style={{
          width: cardWidth,
          height: cardHeight,
          background: '#E9DCF7',
          borderRadius: cardRadius,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: Math.round(size * 0.025),
        }}
      >
        <div style={{ width: dotSize, height: dotSize, borderRadius: dotSize, background: CLERQUE_BG_TO }} />
        <div style={{ width: dotSize, height: dotSize, borderRadius: dotSize, background: CLERQUE_BG_TO }} />
        <div style={{ width: dotSize, height: dotSize, borderRadius: dotSize, background: CLERQUE_BG_TO }} />
      </div>

      {/* Card 3 — Sync (3 horizontal lines) */}
      <div
        style={{
          width: cardWidth,
          height: cardHeight,
          background: '#DCC8F2',
          borderRadius: cardRadius,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: Math.round(size * 0.025),
        }}
      >
        <div style={{ width: lineW, height: lineH, borderRadius: lineH, background: CLERQUE_BG_FROM }} />
        <div style={{ width: lineW, height: lineH, borderRadius: lineH, background: CLERQUE_BG_FROM }} />
        <div style={{ width: lineW, height: lineH, borderRadius: lineH, background: CLERQUE_BG_FROM }} />
      </div>
    </div>
  );
}
