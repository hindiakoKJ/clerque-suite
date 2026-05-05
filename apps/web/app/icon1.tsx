import { ImageResponse } from 'next/og';
import { ClerqueIcon } from '@/lib/clerque-icon';

// PWA "Add to home screen" — 192×192 (Android Chrome standard).

export const size = { width: 192, height: 192 };
export const contentType = 'image/png';

export default function Icon192() {
  return new ImageResponse(<ClerqueIcon size={192} />, size);
}
