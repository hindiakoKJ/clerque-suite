import type { PrismaService } from '../prisma/prisma.service';

/**
 * Lines sold below the price the owner set.
 *
 * The till sends each line's price, and the order is saved with it as sent.
 * The screen only ever sends the owner's price, but a request edited on the
 * device (a laptop till's developer tools) could ring a ₱150 latte at ₱50 and
 * the server would book it. Refusing such a sale would also refuse honest
 * ones -- a till that was offline when a price changed still sends the old
 * price -- so this does not refuse anything: it compares every line with the
 * catalog after the sale is saved and tells the owner.
 *
 * A line is below menu when:
 *   - its unit price is under the product's (or size's) price plus its add-ons;
 *   - or it carries a promo discount that no active promo of this shop for this
 *     product allows -- the amount is recomputed the way the till does it
 *     (lib/pos/promotions.ts: a percent of the line, or down to a fixed price).
 * A product or add-on that is no longer in the catalog cannot be judged and is
 * skipped. Order-level discounts (senior/PWD, manager) are checked where they
 * are granted, not here.
 */

/** Centavo rounding of the till's per-unit maths. */
const TOLERANCE = 0.01;

export interface SoldLine {
  productId:      string;
  variantId?:     string | null;
  productName:    string;
  unitPrice:      number;
  quantity:       number;
  /** The line's whole promo discount, as the till sends it (per-unit discount x quantity). */
  discountAmount: number;
  promoId?:       string | null;
  modifiers?:     { modifierOptionId: string }[];
}

export interface Catalog {
  productPrice:  Map<string, number>;
  /** Variant id -> its product and its own price (null = the product's price). */
  variants:      Map<string, { productId: string; price: number | null }>;
  optionPrice:   Map<string, number>;
  promos:        Map<string, { isActive: boolean; discountPercent: number | null; fixedPrice: number | null; appliesToAll: boolean; productIds: Set<string> }>;
}

export interface PriceFlag {
  productName: string;
  quantity:    number;
  /** What one unit was sold for, after its promo discount. */
  soldAt:      number;
  /** What one unit should have cost at most: menu price less any promo the shop really runs. */
  menuPrice:   number;
  why:         'BELOW_MENU' | 'DISCOUNT_WITHOUT_PROMO';
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function pricesBelowMenu(lines: SoldLine[], catalog: Catalog): PriceFlag[] {
  const flags: PriceFlag[] = [];
  for (const line of lines) {
    const qty = Number(line.quantity);
    if (!(qty > 0)) continue;

    let base = catalog.productPrice.get(line.productId);
    if (base === undefined) continue;
    if (line.variantId) {
      const v = catalog.variants.get(line.variantId);
      if (!v || v.productId !== line.productId) continue;
      if (v.price !== null) base = v.price;
    }
    let menu = base;
    let judged = true;
    for (const m of line.modifiers ?? []) {
      const add = catalog.optionPrice.get(m.modifierOptionId);
      if (add === undefined) { judged = false; break; }
      menu += add;
    }
    if (!judged) continue;
    menu = r2(menu);

    const unit = Number(line.unitPrice);
    const lineDiscount = Math.max(0, Number(line.discountAmount) || 0);
    const soldAt = r2(unit - lineDiscount / qty);

    if (unit < menu - TOLERANCE) {
      flags.push({ productName: line.productName, quantity: qty, soldAt, menuPrice: menu, why: 'BELOW_MENU' });
      continue;
    }
    if (lineDiscount <= TOLERANCE * qty) continue;

    // A promo discount: what does the promo the line names actually allow?
    const promo = line.promoId ? catalog.promos.get(line.promoId) : undefined;
    let allowed = 0;
    if (promo && promo.isActive && (promo.appliesToAll || promo.productIds.has(line.productId))) {
      if (promo.discountPercent !== null) allowed = (promo.discountPercent / 100) * unit * qty;
      else if (promo.fixedPrice !== null && promo.fixedPrice < unit) allowed = (unit - promo.fixedPrice) * qty;
    }
    if (lineDiscount > allowed + TOLERANCE * qty) {
      flags.push({
        productName: line.productName, quantity: qty, soldAt,
        menuPrice: r2(unit - allowed / qty), why: 'DISCOUNT_WITHOUT_PROMO',
      });
    }
  }
  return flags;
}

/** Loads just the catalog rows these lines need. Inactive rows count: a sale rung before a product was hidden is still judged. */
export async function loadCatalog(prisma: Pick<PrismaService, 'product' | 'productVariant' | 'modifierOption' | 'promotion'>, tenantId: string, lines: SoldLine[]): Promise<Catalog> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const variantIds = [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))];
  const optionIds  = [...new Set(lines.flatMap((l) => (l.modifiers ?? []).map((m) => m.modifierOptionId)))];
  const promoIds   = [...new Set(lines.map((l) => l.promoId).filter((p): p is string => !!p))];

  // An empty `in: []` simply returns no rows, so every query runs unconditionally.
  const [products, variants, options, promos] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds }, tenantId }, select: { id: true, price: true } }),
    prisma.productVariant.findMany({ where: { id: { in: variantIds }, product: { tenantId } }, select: { id: true, productId: true, price: true } }),
    prisma.modifierOption.findMany({ where: { id: { in: optionIds }, group: { tenantId } }, select: { id: true, priceAdjustment: true } }),
    prisma.promotion.findMany({
      where:  { id: { in: promoIds }, tenantId },
      select: { id: true, isActive: true, discountPercent: true, fixedPrice: true, appliesToAll: true, products: { select: { productId: true } } },
    }),
  ]);

  return {
    productPrice: new Map(products.map((p) => [p.id, Number(p.price)])),
    variants:     new Map(variants.map((v) => [v.id, { productId: v.productId, price: v.price === null ? null : Number(v.price) }])),
    optionPrice:  new Map(options.map((o) => [o.id, Number(o.priceAdjustment)])),
    promos:       new Map(promos.map((p) => [p.id, {
      isActive:        p.isActive,
      discountPercent: p.discountPercent === null ? null : Number(p.discountPercent),
      fixedPrice:      p.fixedPrice === null ? null : Number(p.fixedPrice),
      appliesToAll:    p.appliesToAll,
      productIds:      new Set(p.products.map((x) => x.productId)),
    }])),
  };
}
