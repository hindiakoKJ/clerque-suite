import { Prisma } from '@prisma/client';

/**
 * Which stocked items belong on which station's daily sheet.
 *
 * Stock is per branch, not per station: a station only decides which rows
 * appear. An item is on a station when a product routed there uses it -- in
 * its recipe, a size's recipe, or an add-on -- directly or through any depth
 * of pre-made items (the syrup in the latte, the sugar in the syrup). Supplies
 * go by their own side of the shop. An item both stations use shows the same
 * numbers on both, marked "Also on ...".
 *
 * Inactive products, sizes, add-ons and items are left out.
 */

/** A product whose category routes to no (active) station. */
export const UNROUTED = 'UNROUTED';

/** Which station kinds each supply category belongs to (the kitchen/bar split the personas use). */
const SUPPLY_KINDS: Record<string, readonly string[]> = {
  KITCHEN_SUPPLY: ['KITCHEN', 'PASTRY_PASS'],
  BAR_SUPPLY:     ['COUNTER', 'BAR', 'HOT_BAR', 'COLD_BAR'],
  OFFICE_SUPPLY:  [],
};

export interface StationItem {
  name: string;
  unit: string;
  category: string;
  /** Made in-house from its own recipe. */
  isPrep: boolean;
  /** Station ids whose products use it, or UNROUTED. */
  on: Set<string>;
}

export interface StationItems {
  stations: Array<{ id: string; name: string; kind: string }>;
  items: Map<string, StationItem>;
}

type Db = Pick<
  Prisma.TransactionClient,
  'product' | 'bomItem' | 'variantBomItem' | 'modifierOptionIngredient' | 'subRecipeItem' | 'rawMaterial' | 'station'
>;

export async function stationItems(db: Db, tenantId: string): Promise<StationItems> {
  const [products, bom, sizes, addOns, preps, rawMaterials, stations] = await Promise.all([
    db.product.findMany({
      where:  { tenantId, isActive: true },
      select: { id: true, categoryId: true, category: { select: { stationId: true } } },
    }),
    db.bomItem.findMany({
      where:  { product: { tenantId, isActive: true } },
      select: { productId: true, rawMaterialId: true },
    }),
    db.variantBomItem.findMany({
      where:  { variant: { isActive: true, product: { tenantId, isActive: true } } },
      select: { rawMaterialId: true, variant: { select: { productId: true } } },
    }),
    db.modifierOptionIngredient.findMany({
      where:  { quantity: { gt: 0 }, option: { isActive: true, group: { isActive: true, tenantId } } },
      select: {
        rawMaterialId: true,
        option: { select: { group: { select: { categoryId: true, products: { select: { productId: true } } } } } },
      },
    }),
    db.subRecipeItem.findMany({
      where:  { parent: { tenantId } },
      select: { parentRawMaterialId: true, rawMaterialId: true },
    }),
    db.rawMaterial.findMany({
      where:  { tenantId, isActive: true },
      select: { id: true, name: true, unit: true, category: true, subRecipeItems: { select: { id: true }, take: 1 } },
    }),
    db.station.findMany({
      where:   { tenantId },
      select:  { id: true, name: true, kind: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);

  const activeStations = stations.filter((s) => s.isActive);
  const stationIds = new Set(activeStations.map((s) => s.id));

  // Where each active product's tickets go. A category routed to a station that was switched off goes nowhere.
  const keyOf = new Map<string, string>();
  const productsByCategory = new Map<string, string[]>();
  for (const p of products) {
    const stationId = p.category?.stationId;
    keyOf.set(p.id, stationId && stationIds.has(stationId) ? stationId : UNROUTED);
    if (p.categoryId) productsByCategory.set(p.categoryId, [...(productsByCategory.get(p.categoryId) ?? []), p.id]);
  }

  const direct = new Map<string, Set<string>>();
  const use = (productId: string, rawMaterialId: string) => {
    const key = keyOf.get(productId);
    if (!key) return;   // an inactive product
    const set = direct.get(key) ?? new Set<string>();
    set.add(rawMaterialId);
    direct.set(key, set);
  };
  for (const b of bom) use(b.productId, b.rawMaterialId);
  for (const v of sizes) use(v.variant.productId, v.rawMaterialId);
  for (const a of addOns) {
    // An add-on group reaches the products it is attached to, and every product in the category it is bound to.
    const group = a.option.group;
    const reached = new Set([...group.products.map((g) => g.productId), ...(group.categoryId ? productsByCategory.get(group.categoryId) ?? [] : [])]);
    for (const productId of reached) use(productId, a.rawMaterialId);
  }

  const componentsOf = new Map<string, string[]>();
  for (const s of preps) componentsOf.set(s.parentRawMaterialId, [...(componentsOf.get(s.parentRawMaterialId) ?? []), s.rawMaterialId]);

  const items = new Map<string, StationItem>();
  for (const rm of rawMaterials) {
    items.set(rm.id, { name: rm.name, unit: rm.unit, category: String(rm.category), isPrep: rm.subRecipeItems.length > 0, on: new Set() });
  }

  // Down through the pre-made items, to any depth. The visited set makes a recipe loop harmless.
  for (const [key, start] of direct) {
    const visited = new Set<string>();
    const queue = [...start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      items.get(id)?.on.add(key);
      for (const c of componentsOf.get(id) ?? []) if (!visited.has(c)) queue.push(c);
    }
  }

  // Supplies are never in a recipe: they go by their side of the shop.
  for (const item of items.values()) {
    const kinds = SUPPLY_KINDS[item.category];
    if (!kinds) continue;
    for (const s of activeStations) if (kinds.includes(String(s.kind))) item.on.add(s.id);
  }

  return {
    stations: activeStations.map((s) => ({ id: s.id, name: s.name, kind: String(s.kind) })),
    items,
  };
}
