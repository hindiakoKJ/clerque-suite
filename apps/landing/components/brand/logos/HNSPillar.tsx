import type { LogoProps } from './types';

/** HNScorpPH · Pillar mark */
export function HNSPillar({
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
      <rect x="11" y="10" width="6" height="44" rx="3" fill={color} />
      <rect x="47" y="10" width="6" height="44" rx="3" fill={color} />
      <rect x="11" y="29" width="42" height="6" rx="3" fill={color} />
      <circle cx="14" cy="56" r="1.5" fill={color} opacity="0.5" />
      <circle cx="50" cy="56" r="1.5" fill={color} opacity="0.5" />
    </svg>
  );
}
