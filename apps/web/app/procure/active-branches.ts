/**
 * Which branches Procure offers.
 *
 * GET /tenant/branches returns every branch, closed ones included, so the
 * settings screen can show and reopen them; it says so and leaves the
 * filtering to whoever reads it. Procure did not filter: a closed branch was
 * offered as somewhere to receive stock, and it counted towards "this shop has
 * more than one branch", which put Transfers and All branches in front of a
 * one-branch shop.
 *
 * Kept free of React so Node's own test runner can check it:
 *   cd apps/web && node --test app/procure/active-branches.spec.mjs
 */

export interface BranchRow { id: string; name?: string; isActive?: boolean }

/** The branches still in use. A row with no flag at all (an older API) counts as in use. */
export function activeBranches<T extends { isActive?: boolean }>(rows: readonly T[] | null | undefined): T[] {
  return (rows ?? []).filter((b) => b.isActive !== false);
}

/** More than one branch in use: the only time moving stock between branches means anything. */
export function isMultiBranch(rows: readonly { isActive?: boolean }[] | null | undefined): boolean {
  return activeBranches(rows).length > 1;
}
