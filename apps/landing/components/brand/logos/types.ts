import type { SVGProps } from 'react';

export interface LogoProps extends Omit<SVGProps<SVGSVGElement>, 'color'> {
  /** Pixel size for both width and height. Default: 64. */
  size?: number;
  /** Stroke/fill color. Defaults to currentColor so Tailwind `text-*` works. */
  color?: string;
  /** Optional className passthrough (Tailwind, etc.). */
  className?: string;
}
