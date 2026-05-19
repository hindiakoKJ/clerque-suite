import type { LogoProps } from './types';

/** HNScorpPH · Keystone mark */
export function HNSKeystone({
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
        d="M10 54V18a8 8 0 0 1 8-8h0a8 8 0 0 1 8 8v36"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M38 54V18a8 8 0 0 1 8-8h0a8 8 0 0 1 8 8v36"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path d="M10 32h44" stroke={color} strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
