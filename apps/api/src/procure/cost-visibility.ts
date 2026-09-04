/**
 * Who may see what the shop paid.
 *
 * Procure is one screen for the whole shop: the cook adds what is short, the
 * owner records what was bought. That means the cost of a delivery sat in
 * front of everyone who could open the request — fine in a small cafe where
 * the staff unpack the bags anyway, awkward in a shop that would rather its
 * baristas not know the supplier's price list.
 *
 * So it is the owner's call, one switch, and the default is the behaviour
 * every existing shop already has: everyone sees.
 *
 * A plain function rather than a service on purpose — ProcureModule already
 * imports DocumentsModule, so anything the documents side could inject back
 * would be a cycle. Both sides call this with what they already know.
 */

/** Roles that decide on a request, and therefore always see its costs. */
export const COST_DECIDER_ROLES: readonly string[] = [
  'BUSINESS_OWNER',
  'BRANCH_MANAGER',
  'MDM',
  'SUPER_ADMIN',
  // The books already carry every peso of this; hiding it here would only
  // make the accountant's job harder without hiding anything.
  'ACCOUNTANT',
  'BOOKKEEPER',
  'FINANCE_LEAD',
  'AP_ACCOUNTANT',
  'EXTERNAL_AUDITOR',
];

/**
 * `showToStaff` is Tenant.showPurchaseCostsToStaff. It is read as "not
 * false" rather than "true" so that a caller who could not load the tenant,
 * or a row written before the column existed, keeps the open behaviour
 * instead of silently hiding money from everyone.
 */
export function canSeePurchaseCosts(
  role: string | null | undefined,
  showToStaff: boolean | null | undefined,
): boolean {
  if (showToStaff !== false) return true;
  return !!role && COST_DECIDER_ROLES.includes(role);
}
