import { ImageResponse } from 'next/og';
import { ClerqueIcon } from '@/lib/clerque-icon';

// PWA "Add to home screen" — 512×512 (Android splash + maskable).

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon512() {
  return new ImageResponse(<ClerqueIcon size={512} />, size);
}
