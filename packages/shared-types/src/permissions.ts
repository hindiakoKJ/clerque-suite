/**
 * Granular Segregation-of-Duties (SOD) Permission Matrix
 *
 * Maps named actions → the roles that are allowed to perform them.
 * This is the single source of truth for both backend guards and frontend
 * conditional rendering. Import `hasPermission()` anywhere in the stack.
 *
 * Naming convention: `<domain>:<verb>_<resource>`
 * SUPER_ADMIN always bypasses all checks — do NOT list it here; the helper
 * short-circuits before consulting the matrix.
 */

import type { UserRole } from './auth';

export type PermissionKey =
  // ── Products ──────────────────────────────────────────────────────────────
  | 'product:create'
  | 'product:edit_details'       // name, description, sku, category
  | 'product:edit_price'         // SOD WALL: price / costPrice — CASHIER/SALES_LEAD blocked
  | 'product:deactivate'
  // ── Orders & Sales ────────────────────────────────────────────────────────
  | 'order:create'
  | 'order:void_direct'          // SALES_LEAD / OWNER can void without co-auth
  | 'order:void_supervised'      // CASHIER can void with supervisorId (SALES_LEAD/OWNER) in body
  | 'order:apply_discount'       // SOD: CASHIER cannot self-authorize discounts
  // ── Inventory ─────────────────────────────────────────────────────────────
  | 'inventory:view'
  | 'inventory:adjust'
  | 'inventory:set_threshold'
  // ── Ledger ────────────────────────────────────────────────────────────────
  | 'ledger:view'
  | 'ledger:journal_entry'
  | 'ledger:period_close'
  | 'ledger:period_reopen'
  | 'ledger:trial_balance'
  | 'ledger:export'
  // ── Finance ───────────────────────────────────────────────────────────────
  | 'finance:bank_recon'         // FINANCE_LEAD exclusive
  | 'finance:cash_flow'
  // ── Payroll ───────────────────────────────────────────────────────────────
  | 'payroll:view_salary'        // SOD: OWNER + PAYROLL_MASTER only
  | 'payroll:edit'
  | 'payroll:run'
  // ── People / HR ───────────────────────────────────────────────────────────
  | 'staff:view'
  | 'staff:create'
  | 'staff:edit'
  | 'staff:deactivate'
  | 'staff:reset_password'
  | 'staff:assign_mdm'           // OWNER only
  | 'staff:assign_payroll_master'// OWNER only
  // ── Settings ──────────────────────────────────────────────────────────────
  | 'settings:tax'
  | 'settings:general'
  // ── Audit ─────────────────────────────────────────────────────────────────
  | 'audit:view'
  // ── BIR ───────────────────────────────────────────────────────────────────
  | 'bir:view'
  | 'bir:generate_eis';

/**
 * Roles allowed for each action.
 * BUSINESS_OWNER inherits all non-payroll permissions automatically via the
 * helper function — only list it here where a reminder or explicit exclusion
 * is necessary for documentation clarity.
 */
export const PERMISSION_MATRIX: Record<PermissionKey, UserRole[]> = {
  // ── Products ──────────────────────────────────────────────────────────────
  'product:create':        ['BUSINESS_OWNER', 'MDM'],
  'product:edit_details':  ['BUSINESS_OWNER', 'MDM'],
  // 🔴 SOD WALL — CASHIER and SALES_LEAD are explicitly blocked from price edits
  'product:edit_price':    ['BUSINESS_OWNER', 'MDM'],
  'product:deactivate':    ['BUSINESS_OWNER'],

  // ── Orders & Sales ────────────────────────────────────────────────────────
  'order:create':          ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD', 'CASHIER'],
  'order:void_direct':     ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'],
  'order:void_supervised': ['CASHIER'],   // requires supervisorId in body
  'order:apply_discount':  ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'],

  // ── Inventory ─────────────────────────────────────────────────────────────
  'inventory:view':          ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD'],
  'inventory:adjust':        ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'WAREHOUSE_STAFF'],
  'inventory:set_threshold': ['BUSINESS_OWNER', 'MDM'],

  // ── Ledger ────────────────────────────────────────────────────────────────
  'ledger:view':           ['BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT', 'EXTERNAL_AUDITOR'],
  'ledger:journal_entry':  ['BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER'],
  'ledger:period_close':   ['BUSINESS_OWNER'],
  'ledger:period_reopen':  ['BUSINESS_OWNER'],
  'ledger:trial_balance':  ['BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR'],
  'ledger:export':         ['BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD'],

  // ── Finance ───────────────────────────────────────────────────────────────
  'finance:bank_recon':    ['BUSINESS_OWNER', 'FINANCE_LEAD'],
  'finance:cash_flow':     ['BUSINESS_OWNER', 'FINANCE_LEAD', 'ACCOUNTANT'],

  // ── Payroll ───────────────────────────────────────────────────────────────
  // 🔴 SOD WALL — salary columns restricted to OWNER + PAYROLL_MASTER only
  'payroll:view_salary':   ['BUSINESS_OWNER', 'PAYROLL_MASTER'],
  'payroll:edit':          ['BUSINESS_OWNER', 'PAYROLL_MASTER'],
  'payroll:run':           ['BUSINESS_OWNER', 'PAYROLL_MASTER'],

  // ── People / HR ───────────────────────────────────────────────────────────
  'staff:view':              ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SALES_LEAD'],
  'staff:create':            ['BUSINESS_OWNER', 'MDM'],
  'staff:edit':              ['BUSINESS_OWNER', 'MDM'],
  'staff:deactivate':        ['BUSINESS_OWNER'],
  'staff:reset_password':    ['BUSINESS_OWNER'],
  'staff:assign_mdm':        ['BUSINESS_OWNER'],
  'staff:assign_payroll_master': ['BUSINESS_OWNER'],

  // ── Settings ──────────────────────────────────────────────────────────────
  'settings:tax':            ['BUSINESS_OWNER'],
  'settings:general':        ['BUSINESS_OWNER'],

  // ── Audit ─────────────────────────────────────────────────────────────────
  'audit:view':              ['BUSINESS_OWNER', 'EXTERNAL_AUDITOR', 'FINANCE_LEAD'],

  // ── BIR ───────────────────────────────────────────────────────────────────
  'bir:view':                ['BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD'],
  'bir:generate_eis':        ['BUSINESS_OWNER', 'ACCOUNTANT', 'CASHIER'],
};

/**
 * Check if a role is allowed to perform an action.
 *
 * SUPER_ADMIN bypasses all checks.
 * Pass role = null/undefined for unauthenticated callers → always false.
 *
 * @example
 * hasPermission(user.role, 'product:edit_price')  // false for CASHIER
 * hasPermission('BUSINESS_OWNER', 'payroll:run')  // true
 */
export function hasPermission(
  role: string | null | undefined,
  action: PermissionKey,
  /**
   * Optional extra grants from User.customPermissions (RBAC Phase 3).
   * If the action is in this list the user passes regardless of role default.
   * Pre-RBAC callers (no third arg) get the original behaviour.
   */
  customPermissions?: readonly string[] | null,
): boolean {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  if (customPermissions && customPermissions.includes(action)) return true;
  return (PERMISSION_MATRIX[action] as string[]).includes(role);
}

/**
 * Assert that a role has permission; throws a descriptive error string if not.
 * Used in backend service methods as an additional defense-in-depth layer
 * beyond the @Roles() controller guard.
 *
 * @throws string — suitable for use in BadRequestException / ForbiddenException
 */
export function assertPermission(
  role: string | null | undefined,
  action: PermissionKey,
  customPermissions?: readonly string[] | null,
): void {
  if (!hasPermission(role, action, customPermissions)) {
    throw new Error(
      `Role '${role ?? 'unknown'}' is not authorized to perform '${action}'. ` +
      `Contact your Business Owner if you believe this is incorrect.`,
    );
  }
}
