/**
 * Who may link a Telegram chat for alerts, and who receives them: the shop's
 * owner and its branch managers. Nobody else -- the alerts carry every sale
 * and every purchase. Checked when a link is made, again when Telegram hands
 * the code back, on every send, and when a person's role or access changes.
 */
export const LINKABLE_ROLES: readonly string[] = ['BUSINESS_OWNER', 'BRANCH_MANAGER'];
