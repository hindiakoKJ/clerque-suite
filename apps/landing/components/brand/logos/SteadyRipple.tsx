import type { LogoProps } from './types';

/** Steady · Ripple mark */
export function SteadyRipple({
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
      <circle cx="32" cy="32" r="22" stroke={color} strokeWidth="2" opacity="0.25" />
      <circle cx="32" cy="32" r="14" stroke={color} strokeWidth="2.4" opacity="0.55" />
      <circle cx="32" cy="32" r="6" fill={color} />
    </svg>
  );
}
