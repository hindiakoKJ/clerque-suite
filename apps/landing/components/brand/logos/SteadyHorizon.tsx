import type { LogoProps } from './types';

/** Steady · Horizon mark */
export function SteadyHorizon({
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
        d="M8 36 L 22 36 Q 28 36, 30 28 Q 32 18, 34 28 Q 36 36, 42 36 L 56 36"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="56" cy="36" r="2.5" fill={color} />
    </svg>
  );
}
