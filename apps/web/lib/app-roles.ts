/**
 * Which roles may enter which app. ONE table, read by both gates.
 *
 * There were two: `middleware.ts` enforced role sets at the edge, and
 * `lib/apps.ts` decided which cards to offer using only the per-app ACCESS
 * LEVEL. They disagreed, and the disagreement was invisible until someone
 * clicked:
 *
 *   - MDM and WAREHOUSE_STAFF hold POS:OPERATOR, so the launcher and the app
 *     switcher both offered them Counter — and the edge threw them straight
 *     back out to /select?reason=pos-restricted. From inside Procure that is
 *     not a detour, it ends the session they were working in.
 *   - KIOSK_DISPLAY was worse. It has exactly one app, so /select auto-
 *     redirects to it, the edge bounced it back to /select, and /select
 *     redirected again: an infinite loop with a repeating error toast, on an
 *     account that could never open any screen.
 *
 * Deliberately free of React, icons and 'use client' so the edge middleware
 * can import it. Keep it that way.
 */

/**
 * The till floor. KIOSK_DISPLAY is here because a KDS or customer-display
 * tablet signs in as one and needs /pos/select-display and /pos/station —
 * the API grants it that on purpose (layouts.controller.ts). It is a device
 * credential, and the pages it can reach are gated separately by role.
 */
export const POS_ROLES = new Set([
  'BUSINESS_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'KIOSK_DISPLAY',
]);

/** Back-office accounting. */
export const LEDGER_ROLES = new Set([
  'BUSINESS_OWNER', 'BRANCH_MANAGER',
  'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD',
  'AR_ACCOUNTANT', 'AP_ACCOUNTANT', 'EXTERNAL_AUDITOR',
]);

/**
 * Stock. Everyone who already touches it: the cashier who notices the
 * shortage, the cook who needs it, the staff who receive and move it, and the
 * owner who buys it.
 */
export const PROCURE_ROLES = new Set([
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM',
  'WAREHOUSE_STAFF', 'CASHIER', 'SALES_LEAD', 'GENERAL_EMPLOYEE',
]);

/**
 * Sync (/payroll) is unrestricted by role — every employee uses it for
 * self-service (clock-in, payslips, leave). Specific HR pages are gated
 * inside the layout.
 */
export function canEnterApp(app: 'pos' | 'ledger' | 'procure' | 'payroll', role: string): boolean {
  if (app === 'pos')     return POS_ROLES.has(role);
  if (app === 'ledger')  return LEDGER_ROLES.has(role);
  if (app === 'procure') return PROCURE_ROLES.has(role);
  return true;
}
