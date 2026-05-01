/**
 * Multi-branch user scoping helpers.
 *
 * Some roles (CASHIER, SALES_LEAD, BRANCH_MANAGER, MDM, WAREHOUSE_STAFF)
 * are tied to a single branch via User.branchId. When set, queries should
 * be auto-scoped to that branch — preventing a Cashier from listing
 * another branch's orders or inventory just by typing a different
 * branchId in the URL.
 *
 * Owner-tier roles (BUSINESS_OWNER, SUPER_ADMIN, ACCOUNTANT, FINANCE_LEAD,
 * EXTERNAL_AUDITOR) bypass scoping — they need cross-branch oversight.
 */

import { ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '@repo/shared-types';

const BRANCH_SCOPED_ROLES = new Set([
  'CASHIER',
  'SALES_LEAD',
  'BRANCH_MANAGER',
  'MDM',
  'WAREHOUSE_STAFF',
  'GENERAL_EMPLOYEE',
]);

/**
 * Returns the branchId the request must be scoped to. If the user is
 * branch-scoped, ignores any user-supplied branchId and forces their own.
 * If the user is owner-tier, returns whatever was requested (may be undefined).
 *
 * Throws ForbiddenException if a branch-scoped user requests a different branch.
 */
export function effectiveBranchId(
  user: JwtPayload,
  requestedBranchId?: string,
): string | undefined {
  if (user.isSuperAdmin) return requestedBranchId;
  if (!BRANCH_SCOPED_ROLES.has(user.role)) return requestedBranchId;
  // Branch-scoped role: force their own branchId
  if (!user.branchId) return undefined; // user without a branchId set falls through
  if (requestedBranchId && requestedBranchId !== user.branchId) {
    throw new ForbiddenException(
      `Your role '${user.role}' is scoped to one branch and cannot query another.`,
    );
  }
  return user.branchId;
}
