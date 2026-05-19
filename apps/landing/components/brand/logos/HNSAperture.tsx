import type { LogoProps } from './types';

/** HNScorpPH · Aperture mark ★ recommended */
export function HNSAperture({
  size = 64,
  color = 'currentColor',
  className,
  ...rest
}: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <circle cx="32" cy="32" r="22" stroke={color} strokeWidth="2.4" opacity="0.35" />
      <path d="M32 10a22 22 0 0 1 22 22" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <path d="M32 22a10 10 0 0 1 10 10" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="32" r="3" fill={color} />
    </svg>
  );
}
