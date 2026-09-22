/**
 * Small decisions the Products table makes per row.
 *
 * Kept free of React and Next so they can be tested on their own.
 */

/** One page of a paged API list: `{ data, pages }`, the shape GET /inventory answers. */
export interface Paged<T> {
  data?: T[] | null;
  pages?: number | null;
}

/**
 * Every row of a paged list, not only the first page.
 *
 * GET /inventory answers 50 rows a page. The Products table read page 1 and
 * stopped, so every product past the 50th had a blank stock figure, never
 * showed under "Low stock", and opened the adjust box at zero.
 *
 * `maxPages` is only a stop for a server that never says it is done.
 */
export async function fetchAllPages<T>(
  getPage: (page: number) => Promise<Paged<T> | null | undefined>,
  maxPages = 100,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await getPage(page);
    const batch = res?.data ?? [];
    rows.push(...batch);
    if (batch.length === 0 || page >= (res?.pages ?? 1)) break;
  }
  return rows;
}

export interface VatBadge {
  label: 'VAT' | 'EXEMPT' | 'NON-VAT' | 'NO VAT';
  /** true = drawn in the accent colour; false = muted. */
  highlighted: boolean;
}

/**
 * What the VAT column says for a product.
 *
 * "Exempt" is a BIR class of its own (a VAT-registered shop selling a
 * VAT-exempt item). A Non-VAT shop charges no VAT on anything, so calling
 * every product of theirs EXEMPT was the wrong word 76 times over.
 */
export function vatBadge(isVatable: boolean, taxStatus: string | null | undefined): VatBadge {
  if (taxStatus === 'NON_VAT')      return { label: 'NON-VAT', highlighted: false };
  if (taxStatus === 'UNREGISTERED') return { label: 'NO VAT',  highlighted: false };
  return isVatable
    ? { label: 'VAT',    highlighted: true }
    : { label: 'EXEMPT', highlighted: false };
}

/**
 * Is this product low on stock?
 *
 * The product row carries the server's own answer, which also knows about
 * recipe-based products (how many can still be made). The inventory row is
 * only the fallback for an older API that does not send it.
 */
export function isProductLow(
  product: { isLowStock?: boolean; stockQty?: number | null },
  stockRow: { isLowStock?: boolean } | undefined,
): boolean {
  if (product.stockQty != null) return !!product.isLowStock;
  return !!stockRow?.isLowStock;
}
