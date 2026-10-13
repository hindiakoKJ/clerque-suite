'use client';
import { toast } from 'sonner';
import { useCartStore } from '@/store/pos/cart';
import { lookupCode } from './tag-api';
import { cleanCode, isTagCode, tagLineNote, type Tag } from './tags';

/**
 * Selling a tag at the till.
 *
 * Only a 6-digit code is looked up, so a shop that never uses tags sees no
 * change: every other code goes straight to today's product match, and a
 * 6-digit code that turns out to be a product (or nothing) falls back to it
 * too.
 *
 *   'HANDLED'  -- it was a tag: added to the cart (`added`), or refused with
 *                 the reason shown. The caller does nothing more.
 *   'FALLBACK' -- not a tag; the caller does what it always did. `error` is
 *                 set when the lookup itself failed (offline, server down),
 *                 for the caller to show if its own match finds nothing.
 */
export type TagScanOutcome = { outcome: 'HANDLED'; added: boolean } | { outcome: 'FALLBACK'; error?: string };

/** The till's own catalog row for the tag's product, for what the lookup does not carry. */
export interface TillProduct {
  id: string;
  isVatable: boolean;
  categoryId?: string | null;
  costPrice?: number | string | null;
}

export async function tryTagCode(
  raw: string,
  branchId: string | null | undefined,
  products: readonly TillProduct[] = [],
): Promise<TagScanOutcome> {
  const code = cleanCode(raw);
  if (!isTagCode(code)) return { outcome: 'FALLBACK' };
  let result;
  try {
    result = await lookupCode(code, branchId);
  } catch (e) {
    const offline = !(e as { response?: unknown })?.response;
    return {
      outcome: 'FALLBACK',
      error: offline
        ? `Could not check tag ${code}: no connection. A tagged part sells only while online.`
        : `Could not check tag ${code}.`,
    };
  }
  if (result.kind !== 'TAG') return { outcome: 'FALLBACK' };
  const { tag } = result;
  const added = addTagToCart(tag, products.find((p) => p.id === tag.productId));
  return { outcome: 'HANDLED', added };
}

/** Puts a sellable tag in the cart, or says why it cannot be sold. */
export function addTagToCart(tag: Tag, catalog?: TillProduct): boolean {
  if (!tag.sellable) {
    toast.error(`Tag ${tag.number}: ${tag.notSellableReason ?? 'This part cannot be sold right now.'}`);
    return false;
  }
  const added = useCartStore.getState().addTagItem(
    {
      id: tag.productId,
      name: tag.productName,
      sku: tag.sku ?? undefined,
      price: Number(tag.price),
      // VAT follows the product, from the till's catalog. Not in the catalog
      // (a stale list): vatable, the usual case for goods; it only counts at a
      // VAT-registered shop, where leaving VAT off would under-declare it.
      isVatable: catalog?.isVatable ?? true,
      categoryId: catalog?.categoryId ?? undefined,
      // The server books the tag's own cost; this is only the till's estimate.
      costPrice: catalog?.costPrice != null ? Number(catalog.costPrice) : undefined,
    },
    {
      id: tag.id,
      number: tag.number,
      photoUrl: tag.photos[0]?.url,
      note: tagLineNote(tag),
    },
  );
  if (added) toast.success(`Added: Tag ${tag.number} · ${tag.productName}`);
  return added;
}
