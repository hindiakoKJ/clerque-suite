import type { LogoProps } from './types';

/** Clerque · Stack mark ★ recommended */
export function ClerqueStack({
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
      <rect x="12" y="14" width="32" height="9" rx="2.5" fill={color} />
      <rect x="12" y="27.5" width="40" height="9" rx="2.5" fill={color} opacity="0.7" />
      <rect x="12" y="41" width="32" height="9" rx="2.5" fill={color} opacity="0.45" />
    </svg>
  );
}
