/**
 * /pos/orders?focus=<order id>
 *
 * Stock pages link here so the owner can answer "which sale used up this
 * stock?". The Orders page never read the parameter, so she landed on the full
 * list with nothing picked out and had to hunt for the order herself.
 *
 *   - the order is in the list on screen  -> open that row and scroll to it
 *   - it is not (the list holds the latest 200; this one is older, or belongs
 *     to another branch)                  -> go to the order's own page
 *   - no usable value (?focus= with nothing after it) -> do nothing
 *
 * An order NUMBER is accepted as well as an id, so a link written by hand
 * still lands somewhere sensible.
 */
export type OrderFocusOutcome =
  | { kind: 'expand'; orderId: string }
  | { kind: 'open'; href: string }
  | null;

export function resolveOrderFocus(
  focus: string | null | undefined,
  orders: ReadonlyArray<{ id: string; orderNumber: string }>,
): OrderFocusOutcome {
  const wanted = (focus ?? '').trim();
  if (!wanted) return null;
  const hit = orders.find((o) => o.id === wanted || o.orderNumber === wanted);
  if (hit) return { kind: 'expand', orderId: hit.id };
  return { kind: 'open', href: `/pos/orders/${encodeURIComponent(wanted)}` };
}
