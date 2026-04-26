import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { ActivePromotion } from '@/lib/pos/promotions';

interface UseActivePromotionsResult {
  promotions: ActivePromotion[];
  isLoading: boolean;
}

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
    promotions: data ?? [],
    isLoading,
  };
}
