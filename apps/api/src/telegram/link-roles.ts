/**
 * Who may link a Telegram chat for alerts, and who receives them: the shop's
 * owner and its branch managers. Nobody else -- the alerts carry every sale
 * and every purchase. Checked when a link is made, again when Telegram hands
 * the code back, on every send, and when a person's role or access changes.
 */
export const LINKABLE_ROLES: readonly string[] = ['BUSINESS_OWNER', 'BRANCH_MANAGER'];

/**
 * Staff the owner or a manager may link for ordering supplies only (KJ,
 * 2026-11-19): they tick what is running low in a checklist and it lands on
 * the next buy list. Such a link never receives an alert -- the alert reader
 * only ever picks owners and managers, and the link is saved with every alert
 * switched off as well.
 */
export const ORDER_ONLY_ROLES: readonly string[] = ['SALES_LEAD', 'CASHIER', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE', 'MDM'];
