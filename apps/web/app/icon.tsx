import { ImageResponse } from 'next/og';

// Browser tab favicon — Next.js auto-serves this at /icon and renders it
// at the specified size. We use the brand mark: a serif "C" in cream on
// a warm-brown rounded square. Warm earth tones (#8B5E3C primary) match
// the rest of the Clerque visual identity.

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
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
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '-0.05em',
          fontFamily: 'Georgia, serif',
          borderRadius: 6,
        }}
      >
        C
      </div>
    ),
    size,
  );
}
