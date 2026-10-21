/**
 * Which offline sales in this device's queue belong to the shop signed in now.
 *
 * The queue (Dexie, lib/pos/db.ts) outlives a sign-in. On a tablet two shops
 * share, shop A's offline sales are still queued when shop B signs in. B must
 * not see them, send them or delete them: the API refuses them under B's
 * token, the sync then parks them as failed, and A's paid sales never reach
 * A's books. They stay queued, untouched, until a user of A signs in again.
 *
 * No imports, so `node --test lib/pos/pending-scope.spec.mjs` loads it as is.
 */

/** The signed-in shop, as far as the queue cares. */
export interface QueueOwner {
  tenantId: string;
  /** The branch on the sign-in token. Null for owners who span branches. */
  branchId: string | null;
  userId:   string | null;
}

/** The fields of a queued sale that say whose it is. */
export interface QueuedSaleTag {
  /** The shop that rang it. Absent on sales queued before this was recorded. */
  tenantId?: string;
  branchId:  string;
}

/** The queue owner for a signed-in user, or null when nobody is (or the user has no shop). */
export function queueOwnerFrom(
  user: { tenantId?: string | null; branchId?: string | null; sub?: string | null } | null | undefined,
): QueueOwner | null {
  if (!user?.tenantId) return null;
  return { tenantId: user.tenantId, branchId: user.branchId || null, userId: user.sub || null };
}

/**
 * An untagged sale (queued by a build that did not record the shop) that this
 * sign-in can safely take as its own.
 *
 * The payload has no shop id, so the shop cannot be read back from it. It does
 * carry the branch the sale was rung at, and branch ids are unique across all
 * shops: a user whose sign-in token names that same branch is of the same
 * shop. Anyone else -- another shop, or an owner whose token names no branch --
 * does not get it; it waits, hidden, for a user of that branch. Waiting is
 * safe: the sale is never sent under the wrong shop and never dropped.
 */
export function isUnclaimedSaleOf(owner: QueueOwner | null, sale: QueuedSaleTag): boolean {
  if (!owner || sale.tenantId) return false;
  return !!owner.branchId && !!sale.branchId && sale.branchId === owner.branchId;
}

/** Is this queued sale the signed-in shop's to show, send or delete? */
export function ownsQueuedSale(owner: QueueOwner | null, sale: QueuedSaleTag): boolean {
  if (!owner) return false;
  if (sale.tenantId) return sale.tenantId === owner.tenantId;
  return isUnclaimedSaleOf(owner, sale);
}

/** Still the same shop? A sync stops if the sign-in changed shops under it. */
export function sameShop(a: QueueOwner | null, b: QueueOwner | null): boolean {
  return !!a && !!b && a.tenantId === b.tenantId;
}

/**
 * The signed-in shop's own sales, and whether anything else is waiting.
 * Only a yes/no for the rest: how many, or what, is not this shop's business.
 */
export function splitQueue<T extends QueuedSaleTag>(
  owner: QueueOwner | null,
  sales: T[],
): { own: T[]; othersWaiting: boolean } {
  const own: T[] = [];
  let othersWaiting = false;
  for (const s of sales) {
    if (ownsQueuedSale(owner, s)) own.push(s);
    else othersWaiting = true;
  }
  return { own, othersWaiting };
}
