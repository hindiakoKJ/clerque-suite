/**
 * Branch pickers on the POS pages.
 *
 * The list comes from GET /tenant/branches. (Five pages used to ask for
 * GET /branches, a route the API never had, so their Branch picker was always
 * empty and a new record went out with no branch and was refused.)
 *
 * That route returns switched-off branches too, because the Branches settings
 * page needs them to switch one back on. A form that files a new record must
 * not offer them.
 *
 * Kept free of React and Next so it can be tested on its own.
 */

export const BRANCHES_ROUTE = '/tenant/branches';

export interface BranchOption {
  id: string;
  name: string;
  isActive?: boolean;
}

/** The branches a new record may be filed under: switched-off ones left out. */
export function activeBranchesOnly<T extends object>(rows: T[] | null | undefined): T[] {
  // A page's own Branch type may not declare isActive; the API sends it anyway.
  return (Array.isArray(rows) ? rows : []).filter((b) => (b as { isActive?: boolean }).isActive !== false);
}

/**
 * The branch a form opens on: the signed-in person's own branch, else the
 * shop's only branch. With several branches and no home branch the person has
 * to choose, so this answers ''.
 */
export function defaultBranchId(
  userBranchId: string | null | undefined,
  branches: Array<{ id: string; isActive?: boolean }> | null | undefined,
): string {
  if (userBranchId) return userBranchId;
  const active = activeBranchesOnly(branches);
  return active.length === 1 ? active[0].id : '';
}
