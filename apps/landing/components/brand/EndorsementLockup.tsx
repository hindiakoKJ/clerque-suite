import type { ComponentType } from 'react';
import { HNSLogo, type LogoProps } from './logos';

interface EndorsementLockupProps {
  ProductMark: ComponentType<LogoProps>;
  productName: string;
  /** Tailwind text color class, e.g. "text-clerque-600" */
  productColorClass: string;
  /** Optional override for the parent mark (defaults to HNSLogo). */
  ParentMark?: ComponentType<LogoProps>;
}

/**
 * Stacked + inline endorsement lockup.
 * Drop on marketing pages and product splash screens.
 *
 * Shows "Product · by HNScorpPH" in both light (stacked) and dark (inline strip) variants.
 */
export function EndorsementLockup({
  ProductMark,
  productName,
  productColorClass,
  ParentMark = HNSLogo,
}: EndorsementLockupProps) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-ink/10 bg-paper">

      {/* Stacked variant — light background */}
      <div className="flex flex-col gap-3 px-9 py-8">
        <div className="flex items-center gap-3">
          <ProductMark size={44} className={productColorClass} />
          <span className="text-[32px] font-semibold tracking-wordmark text-ink leading-none">
            {productName}
          </span>
        </div>
        <div className="flex items-center gap-2 pl-14">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink/45">
            by
          </span>
          <ParentMark size={16} className="text-hns-600" />
          <span className="text-[13px] font-semibold tracking-tight text-ink/60">
            HNScorpPH
          </span>
        </div>
      </div>

      {/* Inline variant — dark strip */}
      <div className="flex items-center gap-3.5 bg-ink px-9 py-4">
        <ProductMark size={24} color="#FFFFFF" />
        <span className="text-lg font-semibold tracking-wordmark text-paper leading-none">
          {productName}
        </span>
        <span className="mx-1.5 h-[18px] w-px bg-paper/20" />
        <ParentMark size={14} className="text-paper/55" />
        <span className="text-[11px] font-medium text-paper/55">HNScorpPH</span>
      </div>
    </div>
  );
}
