import { ImageResponse } from 'next/og';

// iOS home-screen icon. iOS rounds the corners automatically, so we render
// a flat square with full coverage; iOS handles the squircle shape.
// Larger size = better detail when scaled up by the launcher.

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
          fontSize: 130,
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
