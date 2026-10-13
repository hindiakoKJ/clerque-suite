import { code128Bars } from '@/lib/inventory/code128';

/**
 * A Code 128 barcode as inline SVG, one SVG unit per module, so the printed
 * width is exact: 88 modules at 0.375 mm is 33 mm for a 6-digit tag number.
 * The white background carries the quiet zones; crispEdges stops the printer
 * driver from smoothing bar edges into grey.
 */
export function Code128Svg({
  value,
  moduleMm = 0.375,
  heightMm = 12,
  className,
}: {
  value: string;
  moduleMm?: number;
  heightMm?: number;
  className?: string;
}) {
  const { bars, totalModules } = code128Bars(value);
  // Height in module units, so the viewBox keeps the bars' true proportions.
  const h = heightMm / moduleMm;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${totalModules} ${h}`}
      width={`${totalModules * moduleMm}mm`}
      height={`${heightMm}mm`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Barcode ${value}`}
      className={className}
    >
      <rect x={0} y={0} width={totalModules} height={h} fill="#fff" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={h} fill="#000" />
      ))}
    </svg>
  );
}
