import { ImageResponse } from 'next/og';

// PWA "Add to home screen" — 192×192 (Android Chrome standard size).
// Next.js multi-icon convention: icon.tsx + icon1.tsx + icon2.tsx are
// all picked up and exposed via Metadata.icons automatically. The
// manifest then references them at the standard sizes that Android /
// Chrome expect for app shortcuts.

export const size = { width: 192, height: 192 };
export const contentType = 'image/png';

export default function Icon192() {
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
          fontSize: 140,
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
