/**
 * What an item on the buy list still serves, in words.
 *
 * The server works the numbers out from the same stock and recipes the POS
 * tile reads; this file only says them, so the request screen, the PDF sent
 * to the group chat, the copied message and the owner email all say the
 * same thing in the same words.
 *
 * Two numbers, never mixed up:
 *
 *   by this item   what the stock of THIS item alone covers. Several dishes
 *                  share an item and compete for it, so each is its own
 *                  ceiling, joined with "or" and never added up.
 *   till shows     the POS tile's own "N left" for that dish, which may be
 *                  lower because another ingredient runs out first.
 *
 * Not counted anywhere: add-ons (said so). A count typed while building the
 * list is its own figure ("by the count"), never blended into Clerque's.
 */

export interface ServesDish {
  productId: string;
  /** "Spaghetti", or "Americano (16oz)" when only that size's recipe uses the item. */
  name: string;
  /** How much of the item one serving takes, in the item's unit. */
  perServing: number;
  /** Servings the stock of this item alone covers. */
  byThisItem: number;
  /** The same, from the count typed while building the list; null when none. */
  byCounted: number | null;
  /**
   * The POS tile's number for this dish or size. For a product the till counts
   * as finished stock rather than by recipe, the same as byThisItem.
   */
  sellableNow: number;
  /** The ingredient that sets sellableNow, when one does. */
  limitedBy: string | null;
}

export interface LineServes {
  /** Tightest first. */
  dishes: ServesDish[];
  /** Add-ons that use the item. Their use is not counted. */
  addOns: string[];
  /** Kitchen preps the item goes into, and what each prep's own stock serves. */
  goesInto: Array<{ prepName: string; dishes: Array<{ name: string; byThisItem: number }> }>;
}

/** A stock that went negative (a sale allowed past zero) serves nothing, not "-3". */
function count(n: number): string {
  return Math.max(0, n).toLocaleString('en-PH');
}

/**
 * "4 Lasagna or 10 Spaghetti". Past `max`, the rest are counted in words that
 * cannot be read as a number of servings: "enough for 0 Carbonara or 1 more"
 * reads as one more plate, when it meant one more menu item.
 */
function listOr(parts: string[], max: number): string {
  const shown = parts.slice(0, max);
  const list = shown.length <= 2 ? shown.join(' or ') : `${shown.slice(0, -1).join(', ')} or ${shown[shown.length - 1]}`;
  const more = parts.length - shown.length;
  return more > 0 ? `${list} (${more} other menu item${more === 1 ? ' uses' : 's use'} it too)` : list;
}

/**
 * The short form, for a line of a copied message or under an item on the PDF:
 * "enough for 10 Spaghetti or 4 Lasagna". Null when there is nothing to say.
 *
 * `fromCount`: the line shows a count ("left: 200 g"), so the servings beside
 * it must be the count's too, or 200 g reads as enough for Clerque's 20 plates.
 */
export function servesSummary(s: LineServes | null | undefined, max = 3, opts: { fromCount?: boolean } = {}): string | null {
  if (!s) return null;
  if (s.dishes.length > 0) {
    const n = (d: ServesDish) => (opts.fromCount && d.byCounted != null ? d.byCounted : d.byThisItem);
    const dishes = [...s.dishes].sort((a, b) => n(a) - n(b) || a.name.localeCompare(b.name));
    return `enough for ${listOr(dishes.map((d) => `${count(n(d))} ${d.name}`), max)}`;
  }
  if (s.goesInto.length > 0) return `goes into ${s.goesInto.map((g) => g.prepName).join(', ')}`;
  if (s.addOns.length > 0) return 'used only as an add-on';
  return null;
}

/**
 * The full account, one sentence per fact, for the request screen.
 */
export function servesSentences(s: LineServes | null | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.dishes.length > 0) {
    out.push(`By this item alone: enough for ${listOr(s.dishes.map((d) => `${count(d.byThisItem)} ${d.name}`), 4)}.`);
    const counted = s.dishes
      .filter((d) => d.byCounted != null)
      .sort((a, b) => a.byCounted! - b.byCounted! || a.name.localeCompare(b.name));
    if (counted.length > 0) {
      out.push(`By the count: ${listOr(counted.map((d) => `${count(d.byCounted!)} ${d.name}`), 4)}.`);
    }
    /*
      The till's own number, where another ingredient runs out first. Said as
      what the till shows, not as what can be sold: a shop that sells past zero
      still rings the dish up. Compared as shown (never below zero), so an item
      itself below zero is not named as the thing that runs out "first".
    */
    const held = s.dishes.find((d) => Math.max(0, d.sellableNow) < d.byThisItem);
    if (held) {
      out.push(`The till shows ${count(held.sellableNow)} ${held.name} left${held.limitedBy ? ` — ${held.limitedBy} runs out first` : ''}.`);
    }
  }
  for (const g of s.goesInto) {
    out.push(g.dishes.length > 0
      ? `Goes into ${g.prepName} (it has enough for ${listOr(g.dishes.map((d) => `${count(d.byThisItem)} ${d.name}`), 3)}).`
      : `Goes into ${g.prepName}.`);
  }
  if (s.addOns.length > 0) {
    out.push(`${out.length === 0 ? 'Used only as an add-on' : 'Also an add-on'}, not counted: ${s.addOns.join(', ')}.`);
  }
  if (out.length === 0) out.push('Not in any recipe.');
  return out;
}
