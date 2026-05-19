import type { SVGAttributes } from 'react';

export interface LogoProps extends SVGAttributes<SVGElement> {
  size?: number;
  color?: string;
  className?: string;
}
