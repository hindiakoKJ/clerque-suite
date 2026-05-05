/**
 * Master coffee-shop category catalogue used by AdminService.seedCoffeeShopCategories.
 *
 * Each entry maps a category to a preferred Station kind. When seeded, the
 * service will:
 *   1. Create the category if it doesn't already exist on the tenant.
 *   2. Find the tenant's first station whose `kind` matches `preferredKind`
 *      (BAR/KITCHEN/PASTRY_PASS/...) and link the category to it.
 *   3. Skip silently if no matching station exists (e.g., CS_1 has no Bar).
 *
 * The list is intentionally focused — these are the categories every café
 * in the Philippines actually uses. Owners can rename/reorder/add their own
 * after seeding without losing the station routing.
 */

export interface CoffeeShopCategorySeed {
  name:          string;
  description:   string;
  /** Which station kind this category routes to. BAR for drinks, KITCHEN
   *  for hot food, PASTRY_PASS for pre-made bakery, COUNTER for retail
   *  packs that need no prep. */
  preferredKind: 'BAR' | 'KITCHEN' | 'PASTRY_PASS' | 'COUNTER';
  sortOrder:     number;
}

export const COFFEE_SHOP_CATEGORIES: CoffeeShopCategorySeed[] = [
  // ── Drinks → Bar ──────────────────────────────────────────────────────────
  { name: 'Hot Coffee',    description: 'Espresso-based hot drinks: americano, latte, cappuccino, mocha',  preferredKind: 'BAR', sortOrder: 10 },
  { name: 'Cold Coffee',   description: 'Iced espresso drinks: iced americano, iced latte, cold brew',     preferredKind: 'BAR', sortOrder: 20 },
  { name: 'Specialty',     description: 'Signature drinks: spanish latte, dirty matcha, caramel macchiato', preferredKind: 'BAR', sortOrder: 30 },
  { name: 'Frappes',       description: 'Blended ice drinks: java chip, mocha frappe, matcha frappe',      preferredKind: 'BAR', sortOrder: 40 },
  { name: 'Tea',           description: 'Hot and iced tea: matcha, earl grey, chamomile, milk tea',        preferredKind: 'BAR', sortOrder: 50 },
  { name: 'Non-Coffee',    description: 'Hot chocolate, smoothies, fresh juices, bottled water',           preferredKind: 'BAR', sortOrder: 60 },

  // ── Hot food → Kitchen ────────────────────────────────────────────────────
  { name: 'Sandwiches',    description: 'Paninis, club sandwiches, wraps — made to order',                 preferredKind: 'KITCHEN', sortOrder: 100 },
  { name: 'Breakfast',     description: 'All-day breakfast: tapsilog, longsilog, eggs benedict',           preferredKind: 'KITCHEN', sortOrder: 110 },
  { name: 'Mains',         description: 'Pasta, rice bowls, hearty mains',                                 preferredKind: 'KITCHEN', sortOrder: 120 },
  { name: 'Sides',         description: 'Fries, salads, soup of the day',                                  preferredKind: 'KITCHEN', sortOrder: 130 },

  // ── Pre-made → Pastry Pass (or Counter if no pastry station) ──────────────
  { name: 'Pastries',      description: 'Croissants, muffins, danishes, donuts',                           preferredKind: 'PASTRY_PASS', sortOrder: 200 },
  { name: 'Cakes',         description: 'Slices and whole cakes from the display case',                    preferredKind: 'PASTRY_PASS', sortOrder: 210 },
  { name: 'Cookies',       description: 'Cookies, brownies, bars',                                         preferredKind: 'PASTRY_PASS', sortOrder: 220 },

  // ── Retail / take-home → Counter (no prep needed) ─────────────────────────
  { name: 'Beans & Bags',  description: 'Bagged whole bean and ground coffee for take-home',               preferredKind: 'COUNTER', sortOrder: 300 },
  { name: 'Merchandise',   description: 'Mugs, tumblers, t-shirts, gift cards',                            preferredKind: 'COUNTER', sortOrder: 310 },
];
