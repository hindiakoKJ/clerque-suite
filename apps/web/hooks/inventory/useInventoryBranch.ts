'use client';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import {
  BRANCHES_ROUTE, activeBranchesOnly, defaultBranchId, type BranchOption,
} from '@/app/pos/(pos)/branch-options';

/**
 * Which branch the Inventory screens work in.
 *
 * A cashier or stock person has a home branch and works there. The owner has
 * none, so with more than one branch they pick one, and the pick is kept while
 * they move between Inventory screens (not across a reload: a new day starts
 * at the default again, which is the safer place to start).
 */
const useChosenBranch = create<{ branchId: string | null; choose: (id: string) => void }>((set) => ({
  branchId: null,
  choose: (branchId) => set({ branchId }),
}));

export function useInventoryBranch() {
  const user = useAuthStore((s) => s.user);
  const chosen = useChosenBranch((s) => s.branchId);
  const choose = useChosenBranch((s) => s.choose);

  const { data: rows = [], isLoading } = useQuery<BranchOption[]>({
    queryKey: ['branches'],
    queryFn: () => api.get(BRANCHES_ROUTE).then((r) => r.data),
    enabled: !!user,
    staleTime: 300_000,
  });
  const branches = activeBranchesOnly(rows);

  // A home branch is where this person works; only someone without one picks.
  const homeBranch = user?.branchId ?? null;
  const canChoose = !homeBranch && branches.length > 1;
  const branchId = canChoose && chosen && branches.some((b) => b.id === chosen)
    ? chosen
    : defaultBranchId(homeBranch, branches);

  return {
    branchId,
    branches,
    canChoose,
    loading: isLoading,
    setBranchId: choose,
    branchName: branches.find((b) => b.id === branchId)?.name ?? null,
  };
}
