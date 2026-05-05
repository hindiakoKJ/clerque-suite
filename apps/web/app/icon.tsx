import { ImageResponse } from 'next/og';
import { ClerqueIcon } from '@/lib/clerque-icon';

// Browser tab favicon — 32×32. Same brand mark as every other size,
// just scaled down. Inner cards become tiny but still readable as
// "three slabs on a purple square."

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(<ClerqueIcon size={32} />, size);
}
