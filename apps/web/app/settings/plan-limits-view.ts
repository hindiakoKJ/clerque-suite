/**
 * How a plan limit reads on the Subscription and Branches pages.
 *
 * The plan table (packages/shared-types/src/plans.ts) has no real ceilings
 * yet: it uses large finite numbers, 9,999 seats and 999 branches, so that
 * every cap check still works. Shown as they are, the owner read "Staff seats
 * 2 of 9999 (9997 remaining)" and "1 of 999 active · 998 slots left". The
 * older API sentinel for the same idea is -1, and 0 for branches.
 *
 * Pure, so plan-limits-view.spec.mjs can pin it.
 */

/** True when the number means "no limit" rather than a real ceiling. */
export function isUncapped(limit: number | null | undefined): boolean {
  return limit == null || limit <= 0 || limit >= 999;
}

/** "2 of 5 (3 remaining)" on a real cap, "2 · no limit" otherwise. */
export function seatUsageLabel(used: number, ceiling: number | null | undefined): string {
  if (isUncapped(ceiling)) return `${used} · no limit`;
  const left = Math.max(0, (ceiling as number) - used);
  return `${used} of ${ceiling} (${left} remaining)`;
}

/** "1 of 3 active" on a real cap, "1 active · no limit" otherwise. */
export function branchUsageLabel(active: number, max: number | null | undefined): string {
  if (isUncapped(max)) return `${active} active · no limit`;
  return `${active} of ${max} active`;
}
