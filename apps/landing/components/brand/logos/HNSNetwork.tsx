import type { LogoProps } from './types';

/** HNScorpPH · Network mark */
export function HNSNetwork({
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
      <line x1="14" y1="14" x2="14" y2="50" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <line x1="50" y1="14" x2="50" y2="50" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <line x1="14" y1="32" x2="50" y2="32" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <line x1="14" y1="14" x2="50" y2="50" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
      <line x1="50" y1="14" x2="14" y2="50" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
      <circle cx="14" cy="14" r="3.5" fill={color} />
      <circle cx="50" cy="14" r="3.5" fill={color} />
      <circle cx="14" cy="50" r="3.5" fill={color} />
      <circle cx="50" cy="50" r="3.5" fill={color} />
      <circle cx="32" cy="32" r="4.5" fill={color} />
    </svg>
  );
}
