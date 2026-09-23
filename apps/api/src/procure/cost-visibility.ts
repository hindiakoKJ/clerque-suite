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

// Type only: nothing is loaded at run time, so this stays a plain module.
import type { PrismaService } from '../prisma/prisma.service';

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

/**
 * The same answer for a controller that only has the person and the shop:
 * the deciders are answered without a query, everyone else by reading the
 * owner's switch now -- per request, not from the login, so turning it off
 * takes effect on the next screen load rather than after every member of
 * staff has signed out and back in.
 *
 * Takes the tenant reader rather than a service, for the reason above.
 */
export async function purchaseCostsVisibleTo(
  prisma: Pick<PrismaService, 'tenant'>,
  tenantId: string,
  role: string | null | undefined,
): Promise<boolean> {
  if (role && COST_DECIDER_ROLES.includes(role)) return true;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId }, select: { showPurchaseCostsToStaff: true },
  });
  return canSeePurchaseCosts(role, tenant?.showPurchaseCostsToStaff);
}

/** Keys that carry what the shop paid, wherever they sit in a product's tree. */
const COST_KEYS = new Set(['costPrice', 'costPriceIsDerived', 'packCost', 'unitCost', 'lastCost']);

/**
 * A product (or list of them) with every cost figure left out, recipe
 * ingredients included. Applied to the product list, detail and barcode
 * routes for someone the shop hides purchase costs from: those three carried
 * every make-cost and, through the recipe, each ingredient's buying price to
 * any signed-in account, while /products/pos alone was gated. Walks the
 * object graph so a new nested cost field cannot slip through; Decimal and
 * Date values pass as they are.
 */
export function withoutCosts<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => withoutCosts(v)) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  const proto = Object.getPrototypeOf(value);
  // Prisma.Decimal and other class instances are leaves, not records to walk.
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (COST_KEYS.has(k)) continue;
    out[k] = withoutCosts(v);
  }
  return out as T;
}
