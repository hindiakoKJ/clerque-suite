import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { ActivePromotion } from '@/lib/pos/promotions';

interface UseActivePromotionsResult {
  promotions: ActivePromotion[];
  isLoading: boolean;
}

/**
 * Stable empty-array reference.
 *
 * Returned when no promotions data is available (query disabled or
 * still loading), so consumers using `promotions` in useEffect
 * dep-arrays don't re-run their effect on every render due to a fresh
 * `[]` literal.
 *
 * Bug history: previous `data ?? []` created a new array on every
 * render → useEffect re-fired → applyPromoDiscounts() called →
 * cart-store set() → re-render → infinite loop (React #185 "Maximum
 * update depth exceeded") which crashed the POS terminal.
 */
const EMPTY_PROMOTIONS: ActivePromotion[] = [];

/**
 * Fetch promotions that are active RIGHT NOW for the given product IDs.
 * Designed for POS checkout — re-validates every 60 seconds so time-gated
 * promotions (e.g. happy hour) automatically kick in / expire.
 *
 * @param productIds - IDs of products currently in the cart
 */
export function useActivePromotions(productIds: string[]): UseActivePromotionsResult {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? '';

  const { data, isLoading } = useQuery<ActivePromotion[]>({
    queryKey: ['promotions', 'active', branchId, productIds],
    queryFn: async () => {
      const idsParam = productIds.join(',');
      const { data: result } = await api.get('/promotions/active', {
        params: { branchId, productIds: idsParam },
      });
      return result as ActivePromotion[];
    },
    enabled: productIds.length > 0 && !!user,
    staleTime: 60_000,
  });

  return {
    promotions: data ?? EMPTY_PROMOTIONS,
    isLoading,
  };
}
