import { ImageResponse } from 'next/og';

// PWA "Add to home screen" — 512×512 (Android splash-screen + maskable
// icon hint size). Larger version of the same brand mark, sharper for
// high-DPI launchers.

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon512() {
  return new ImageResponse(
    (
      <div
        style={{
          width:  '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #8B5E3C 0%, #6B3F1D 100%)',
          color: '#EEE9DF',
          fontSize: 380,
          fontWeight: 700,
          letterSpacing: '-0.05em',
          fontFamily: 'Georgia, serif',
        }}
      >
        C
      </div>
    ),
    size,
  );
}
