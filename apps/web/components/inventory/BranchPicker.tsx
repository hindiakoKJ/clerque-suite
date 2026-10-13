'use client';
import { useInventoryBranch } from '@/hooks/inventory/useInventoryBranch';

/**
 * "Which branch?" for someone with no home branch in a shop with more than
 * one. Shows nothing for everyone else: they work where they are.
 */
export function BranchPicker({ label = 'Branch' }: { label?: string }) {
  const { branchId, branches, canChoose, setBranchId } = useInventoryBranch();
  if (!canChoose) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={branchId}
        onChange={(e) => setBranchId(e.target.value)}
        className="h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none focus:border-[var(--accent)]"
      >
        {!branchId && <option value="">Pick a branch</option>}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
    </label>
  );
}
