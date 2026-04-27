import type { LogoProps } from './types';

/** Clerque · Tally mark */
export function ClerqueTally({
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
      <line x1="16" y1="14" x2="16" y2="50" stroke={color} strokeWidth="3.2" strokeLinecap="round" />
      <line x1="26" y1="14" x2="26" y2="50" stroke={color} strokeWidth="3.2" strokeLinecap="round" />
      <line x1="36" y1="14" x2="36" y2="50" stroke={color} strokeWidth="3.2" strokeLinecap="round" />
      <line x1="46" y1="14" x2="46" y2="50" stroke={color} strokeWidth="3.2" strokeLinecap="round" />
      <line x1="11" y1="46" x2="51" y2="18" stroke={color} strokeWidth="3.2" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
