import type { LogoProps } from './types';

/** Steady · Anchor-S mark */
export function SteadyAnchorS({
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
      <path
        d="M48 18 C 36 18, 36 32, 32 32 S 28 46, 16 46"
        stroke={color}
        strokeWidth="3.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="32" cy="32" r="2.5" fill={color} />
    </svg>
  );
}
