'use client';
/**
 * "Usually ₱86 to ₱89 for 1,000 ml — is this the correct cost?"
 *
 * The hint that appears under a price box as soon as a number is entered, while
 * the person can still just fix it. It uses the same rule the server applies
 * when the save is pressed (@repo/shared-types judgeCost), over the same
 * history, so the hint and the question on save can never disagree. It only
 * informs; the save asks for itself.
 */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { judgeCost, isMagnitudeOff, isPackChanged, judgeMargin } from '@repo/shared-types';
import { api } from '@/lib/api';
import { formatPeso, formatUnitCost } from '@/lib/utils';

export interface CostBand {
  rawMaterialId: string;
  name: string;
  unit: string;
  /** Recent purchase prices, VAT included, per the ingredient's own unit, newest first. */
  points: number[];
  referenceGross: number | null;
  usualPackSize: number | null;
}

/** What each ingredient usually costs. Empty for anyone the shop hides purchase costs from. */
export function useCostBands(rawMaterialIds: string[], branchId?: string | null) {
  const ids = [...new Set(rawMaterialIds.filter(Boolean))].sort();
  return useQuery<Map<string, CostBand>>({
    queryKey: ['cost-bands', ids.join(','), branchId ?? ''],
    queryFn: () => api
      .get<CostBand[]>('/inventory/raw-materials/cost-bands', { params: { ids: ids.join(','), ...(branchId ? { branchId } : {}) } })
      .then((r) => new Map(r.data.map((b) => [b.rawMaterialId, b]))),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
}

function howFar(ratio: number): string {
  if (ratio >= 2) return `about ${ratio.toFixed(1)} times as much`;
  if (ratio > 1) return `about ${Math.round((ratio - 1) * 100)}% more`;
  if (ratio <= 0.5) return `about ${(1 / ratio).toFixed(1)} times less`;
  return `about ${Math.round((1 - ratio) * 100)}% less`;
}

/**
 * The verdict for one typed cost, or null when there is nothing to say.
 * Pass a pack (cost + size) when that is how it was typed, or a per-unit cost.
 */
export function costHintText(
  band: CostBand | undefined,
  typed: { perUnit?: number | null; packCost?: number | null; packSize?: number | null },
): { text: string; severe: boolean } | null {
  if (!band) return null;
  const perPack = typed.packCost != null && typed.packSize != null && typed.packSize > 0;
  const perUnit = perPack ? typed.packCost! / typed.packSize! : typed.perUnit;
  if (perUnit == null || !Number.isFinite(perUnit) || perUnit < 0) return null;

  const verdict = judgeCost({
    typed: perUnit,
    history: band.points,
    reference: band.referenceGross,
    packChanged: perPack ? isPackChanged(typed.packSize, band.usualPackSize) : false,
  });
  const magnitude = isMagnitudeOff(perUnit, band.referenceGross);
  if (!verdict.unusual && !magnitude) return null;

  const scale = perPack ? typed.packSize! : 1;
  const money = (n: number) => (perPack ? formatPeso(n) : formatUnitCost(n));
  const label = perPack ? `for ${typed.packSize!.toLocaleString('en-PH')} ${band.unit}` : `per ${band.unit}`;
  if (magnitude && band.referenceGross != null) {
    return {
      severe: true,
      text: `Against ${money(band.referenceGross * scale)} ${label} on file, that is ${howFar(perUnit / band.referenceGross)}. Usually the wrong unit${perPack ? ' or pack size' : ''} — is this the correct cost?`,
    };
  }
  const low = verdict.usualLow != null ? verdict.usualLow * scale : null;
  const high = verdict.usualHigh != null ? verdict.usualHigh * scale : null;
  // One figure when the ends are within half a percent — however small the unit.
  const usual = low != null && high != null ? (high <= low * 1.005 + 1e-9 ? money(low) : `${money(low)} to ${money(high)}`) : null;
  const basis = verdict.basis === 'trend' ? `last ${verdict.points} deliveries` : verdict.points > 0 ? `last ${verdict.points === 1 ? 'delivery' : `${verdict.points} deliveries`}` : 'cost on file';
  const ratio = verdict.ratio != null ? ` — ${howFar(verdict.ratio)}` : '';
  return {
    severe: false,
    text: `${band.name} is usually ${usual} ${label} (${basis})${ratio}. Is this the correct cost?`,
  };
}

export function CostHint(props: {
  band: CostBand | undefined;
  perUnit?: number | null;
  packCost?: number | null;
  packSize?: number | null;
  /** Show only once the box has been left or Enter pressed, not on every keystroke. */
  show?: boolean;
  className?: string;
}) {
  if (props.show === false) return null;
  const hint = costHintText(props.band, props);
  if (!hint) return null;
  return (
    <p
      role="status"
      className={`mt-1 flex items-start gap-1.5 text-[11px] leading-snug ${hint.severe ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'} ${props.className ?? ''}`}
    >
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
      <span>{hint.text}</span>
    </p>
  );
}

/**
 * What a drink costs to make against what it sells for, as the product form
 * fills in. Quiet when the margin is ordinary; amber when it loses money or is
 * so cheap to make that an ingredient must be in the wrong unit.
 */
export function MarginReadout(props: { cost: number | null; price: number | null; vatable: boolean; vatTenant: boolean }) {
  if (props.cost == null || props.price == null || !(props.price > 0)) return null;
  const m = judgeMargin({ cost: props.cost, price: props.price, vatable: props.vatable, vatTenant: props.vatTenant });
  if (m.marginShare == null) return null;
  const pct = Math.round(m.marginShare * 100);
  if (m.losesMoney) {
    return (
      <p role="status" className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-red-700 dark:text-red-400">
        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
        <span>Costs {formatPeso(props.cost)} to make{props.vatTenant && props.vatable ? ` and brings in ${formatPeso(m.netPrice)} after VAT` : ` and sells for ${formatPeso(props.price)}`}, so each one loses {formatPeso(props.cost - m.netPrice)}. Is this the correct cost and price?</span>
      </p>
    );
  }
  if (m.suspiciouslyCheap) {
    return (
      <p role="status" className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
        <span>Costs only {formatPeso(props.cost)} to make — under 1% of the price. An ingredient cost or recipe quantity is probably in the wrong unit.</span>
      </p>
    );
  }
  return <p className="mt-1 text-[11px] text-muted-foreground">Margin {pct}%</p>;
}
