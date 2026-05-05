import { ImageResponse } from 'next/og';
import { ClerqueIcon } from '@/lib/clerque-icon';

// iOS home-screen icon — 180×180. iOS rounds corners automatically;
// we render the full square and let iOS handle squircle masking.

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(<ClerqueIcon size={180} />, size);
}
