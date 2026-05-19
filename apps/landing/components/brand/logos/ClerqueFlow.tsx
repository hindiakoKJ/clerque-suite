import type { LogoProps } from './types';

/** Clerque · Flow mark */
export function ClerqueFlow({
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
        d="M50 18a18 18 0 1 0 0 28"
        stroke={color}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M44 26a10 10 0 1 0 0 12"
        stroke={color}
        strokeWidth="3.4"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}
