import type { LogoProps } from './types';

/** Clerque · Grid mark */

const CELLS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [2, 0],
  [0, 1],
  [0, 2], [1, 2], [2, 2],
];

export function ClerqueGrid({
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
      {CELLS.map(([x, y], i) => (
        <rect
          key={i}
          x={14 + x * 13}
          y={14 + y * 13}
          width="10"
          height="10"
          rx="2.5"
          fill={color}
          opacity={0.35 + (x + y) * 0.13}
        />
      ))}
    </svg>
  );
}
