/**
 * Master coffee-shop ingredient catalogue — used by the Console
 * "Seed Coffee Shop Ingredients" action.
 *
 * Quantities are sized for a typical small/medium café (~100-200 drinks/day):
 *   - Heavy-use items (espresso beans, fresh milk, ice) get 1-2 weeks of supply.
 *   - Specialty items (lavender syrup, hojicha, etc.) get a slimmer buffer.
 *   - Low-stock alert is set to roughly 20-30% of starting quantity so the
 *     barista gets a heads-up before running out.
 *
 * Costs are PH market estimates as of 2026 — owner can adjust under
 * Inventory → Ingredients after seeding. The seed never overwrites
 * existing ingredients (idempotent insert by name).
 */

export interface IngredientSeed {
  name:           string;
  unit:           string;
  costPrice:      number;       // ₱ per unit
  startingQty:    number;       // initial inventory at the demo branch
  lowStockAlert?: number;       // threshold; ~20-30% of starting
  category:       string;       // for UI grouping when we render the seed result
}

export const COFFEE_SHOP_INGREDIENTS: IngredientSeed[] = [
  // ── ☕ Coffee ─────────────────────────────────────────────────────────────
  { category: 'Coffee', name: 'Espresso Beans',         unit: 'g',  costPrice: 2.5,  startingQty: 5000,  lowStockAlert: 1000 },
  { category: 'Coffee', name: 'Decaf Espresso Beans',   unit: 'g',  costPrice: 3.0,  startingQty: 1000,  lowStockAlert:  250 },
  { category: 'Coffee', name: 'Filter Coffee Beans',    unit: 'g',  costPrice: 2.2,  startingQty: 2000,  lowStockAlert:  500 },
  { category: 'Coffee', name: 'Cold Brew Concentrate',  unit: 'ml', costPrice: 0.4,  startingQty: 2000,  lowStockAlert:  500 },
  { category: 'Coffee', name: 'Instant Coffee',         unit: 'g',  costPrice: 1.5,  startingQty:  500,  lowStockAlert:  100 },

  // ── 🥛 Milk & Dairy ─────────────────────────────────────────────────────
  { category: 'Milk & Dairy', name: 'Fresh Milk (whole)',  unit: 'ml', costPrice: 0.12, startingQty: 20000, lowStockAlert: 4000 },
  { category: 'Milk & Dairy', name: 'Skim Milk',            unit: 'ml', costPrice: 0.13, startingQty:  5000, lowStockAlert: 1000 },
  { category: 'Milk & Dairy', name: 'Oat Milk',             unit: 'ml', costPrice: 0.35, startingQty: 10000, lowStockAlert: 2000 },
  { category: 'Milk & Dairy', name: 'Almond Milk',          unit: 'ml', costPrice: 0.30, startingQty:  5000, lowStockAlert: 1000 },
  { category: 'Milk & Dairy', name: 'Soy Milk',             unit: 'ml', costPrice: 0.20, startingQty:  3000, lowStockAlert:  600 },
  { category: 'Milk & Dairy', name: 'Coconut Milk',         unit: 'ml', costPrice: 0.18, startingQty:  2000, lowStockAlert:  500 },
  { category: 'Milk & Dairy', name: 'Heavy Cream',          unit: 'ml', costPrice: 0.40, startingQty:  2000, lowStockAlert:  500 },
  { category: 'Milk & Dairy', name: 'Half-and-Half',        unit: 'ml', costPrice: 0.25, startingQty:  1000, lowStockAlert:  250 },
  { category: 'Milk & Dairy', name: 'Condensed Milk',       unit: 'ml', costPrice: 0.18, startingQty:  1500, lowStockAlert:  300 },
  { category: 'Milk & Dairy', name: 'Evaporated Milk',      unit: 'ml', costPrice: 0.10, startingQty:  2000, lowStockAlert:  400 },

  // ── 🍯 Syrups (flavored) ────────────────────────────────────────────────
  { category: 'Syrups', name: 'Vanilla Syrup',         unit: 'ml', costPrice: 0.50, startingQty: 1500, lowStockAlert: 300 },
  { category: 'Syrups', name: 'Caramel Syrup',         unit: 'ml', costPrice: 0.50, startingQty: 1500, lowStockAlert: 300 },
  { category: 'Syrups', name: 'Hazelnut Syrup',        unit: 'ml', costPrice: 0.50, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Syrups', name: 'Salted Caramel Syrup',  unit: 'ml', costPrice: 0.55, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Syrups', name: 'Chocolate Syrup',       unit: 'ml', costPrice: 0.45, startingQty: 1500, lowStockAlert: 300 },
  { category: 'Syrups', name: 'White Chocolate Syrup', unit: 'ml', costPrice: 0.55, startingQty:  750, lowStockAlert: 150 },
  { category: 'Syrups', name: 'Cinnamon Syrup',        unit: 'ml', costPrice: 0.55, startingQty:  750, lowStockAlert: 150 },
  { category: 'Syrups', name: 'Pumpkin Spice Syrup',   unit: 'ml', costPrice: 0.60, startingQty:  500, lowStockAlert: 100 },
  { category: 'Syrups', name: 'Lavender Syrup',        unit: 'ml', costPrice: 0.65, startingQty:  500, lowStockAlert: 100 },
  { category: 'Syrups', name: 'Brown Sugar Syrup',     unit: 'ml', costPrice: 0.30, startingQty: 1500, lowStockAlert: 300 },

  // ── 🍫 Chocolate & Cocoa ────────────────────────────────────────────────
  { category: 'Chocolate & Cocoa', name: 'Dark Cocoa Powder',     unit: 'g',  costPrice: 1.50, startingQty: 2000, lowStockAlert: 400 },
  { category: 'Chocolate & Cocoa', name: 'Milk Chocolate Powder', unit: 'g',  costPrice: 1.20, startingQty: 1500, lowStockAlert: 300 },
  { category: 'Chocolate & Cocoa', name: 'White Chocolate Powder',unit: 'g',  costPrice: 2.00, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Chocolate & Cocoa', name: 'Chocolate Sauce',       unit: 'ml', costPrice: 0.35, startingQty: 1500, lowStockAlert: 300 },
  { category: 'Chocolate & Cocoa', name: 'Nutella',                unit: 'g',  costPrice: 1.80, startingQty: 1000, lowStockAlert: 200 },

  // ── 🍵 Tea & Matcha ─────────────────────────────────────────────────────
  { category: 'Tea & Matcha', name: 'Matcha Powder (ceremonial)', unit: 'g',  costPrice: 8.00, startingQty:  200, lowStockAlert:  50 },
  { category: 'Tea & Matcha', name: 'Matcha Powder (culinary)',   unit: 'g',  costPrice: 4.00, startingQty:  500, lowStockAlert: 100 },
  { category: 'Tea & Matcha', name: 'Black Tea Bag',              unit: 'pc', costPrice: 5.00, startingQty:  100, lowStockAlert:  20 },
  { category: 'Tea & Matcha', name: 'Green Tea Bag',              unit: 'pc', costPrice: 5.00, startingQty:  100, lowStockAlert:  20 },
  { category: 'Tea & Matcha', name: 'Chamomile Tea Bag',          unit: 'pc', costPrice: 6.00, startingQty:   50, lowStockAlert:  10 },
  { category: 'Tea & Matcha', name: 'Hibiscus Tea',               unit: 'g',  costPrice: 2.00, startingQty:  250, lowStockAlert:  50 },
  { category: 'Tea & Matcha', name: 'Chai Concentrate',           unit: 'ml', costPrice: 0.40, startingQty: 2000, lowStockAlert: 400 },
  { category: 'Tea & Matcha', name: 'Hojicha Powder',             unit: 'g',  costPrice: 6.00, startingQty:  250, lowStockAlert:  50 },

  // ── 🌿 Spices & Extracts ────────────────────────────────────────────────
  { category: 'Spices & Extracts', name: 'Cinnamon Powder',       unit: 'g',  costPrice: 2.00, startingQty: 250, lowStockAlert: 50 },
  { category: 'Spices & Extracts', name: 'Ground Cinnamon Sticks',unit: 'g',  costPrice: 3.00, startingQty: 100, lowStockAlert: 25 },
  { category: 'Spices & Extracts', name: 'Cardamom Powder',       unit: 'g',  costPrice: 4.00, startingQty: 100, lowStockAlert: 25 },
  { category: 'Spices & Extracts', name: 'Nutmeg',                unit: 'g',  costPrice: 5.00, startingQty:  50, lowStockAlert: 15 },
  { category: 'Spices & Extracts', name: 'Ginger Powder',         unit: 'g',  costPrice: 2.50, startingQty: 100, lowStockAlert: 25 },
  { category: 'Spices & Extracts', name: 'Star Anise',            unit: 'pc', costPrice: 8.00, startingQty:  50, lowStockAlert: 10 },
  { category: 'Spices & Extracts', name: 'Vanilla Extract',       unit: 'ml', costPrice: 1.20, startingQty: 500, lowStockAlert: 100 },
  { category: 'Spices & Extracts', name: 'Mint Extract',          unit: 'ml', costPrice: 0.80, startingQty: 250, lowStockAlert: 50 },

  // ── 🍓 Fruit Purees & Cold-drink Syrups ─────────────────────────────────
  { category: 'Fruit Purees', name: 'Strawberry Puree',   unit: 'ml', costPrice: 0.50, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Fruit Purees', name: 'Mango Puree',        unit: 'ml', costPrice: 0.45, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Fruit Purees', name: 'Blueberry Puree',    unit: 'ml', costPrice: 0.55, startingQty:  500, lowStockAlert: 100 },
  { category: 'Fruit Purees', name: 'Passion Fruit Puree',unit: 'ml', costPrice: 0.60, startingQty:  500, lowStockAlert: 100 },
  { category: 'Fruit Purees', name: 'Lemon Juice (fresh)',unit: 'ml', costPrice: 0.35, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Fruit Purees', name: 'Calamansi Juice',    unit: 'ml', costPrice: 0.40, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Fruit Purees', name: 'Strawberry Syrup',   unit: 'ml', costPrice: 0.45, startingQty:  750, lowStockAlert: 150 },
  { category: 'Fruit Purees', name: 'Raspberry Syrup',    unit: 'ml', costPrice: 0.50, startingQty:  500, lowStockAlert: 100 },

  // ── 🧂 Sweeteners ──────────────────────────────────────────────────────
  { category: 'Sweeteners', name: 'White Sugar',     unit: 'g',  costPrice: 0.08, startingQty: 10000, lowStockAlert: 2000 },
  { category: 'Sweeteners', name: 'Brown Sugar',     unit: 'g',  costPrice: 0.10, startingQty:  5000, lowStockAlert: 1000 },
  { category: 'Sweeteners', name: 'Honey',           unit: 'ml', costPrice: 0.50, startingQty:  1500, lowStockAlert:  300 },
  { category: 'Sweeteners', name: 'Stevia Packet',   unit: 'pc', costPrice: 1.50, startingQty:   200, lowStockAlert:   40 },
  { category: 'Sweeteners', name: 'Splenda Packet',  unit: 'pc', costPrice: 1.50, startingQty:   100, lowStockAlert:   25 },
  { category: 'Sweeteners', name: 'Simple Syrup',    unit: 'ml', costPrice: 0.10, startingQty:  2000, lowStockAlert:  400 },

  // ── 🍦 Frappe Bases ────────────────────────────────────────────────────
  { category: 'Frappe Bases', name: 'Frappe Base Powder', unit: 'g',  costPrice: 1.50, startingQty: 2000, lowStockAlert: 400 },
  { category: 'Frappe Bases', name: 'Vanilla Powder',     unit: 'g',  costPrice: 1.20, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Frappe Bases', name: 'Mocha Powder Mix',   unit: 'g',  costPrice: 1.80, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Frappe Bases', name: 'Caramel Sauce',      unit: 'ml', costPrice: 0.40, startingQty: 1500, lowStockAlert: 300 },

  // ── 🍨 Toppings & Garnishes ─────────────────────────────────────────────
  { category: 'Toppings', name: 'Whipped Cream',     unit: 'ml', costPrice: 0.30, startingQty: 3000, lowStockAlert: 600 },
  { category: 'Toppings', name: 'Cocoa Dust',        unit: 'g',  costPrice: 1.50, startingQty:  250, lowStockAlert:  50 },
  { category: 'Toppings', name: 'Cinnamon Dust',     unit: 'g',  costPrice: 2.00, startingQty:  250, lowStockAlert:  50 },
  { category: 'Toppings', name: 'Caramel Drizzle',   unit: 'ml', costPrice: 0.40, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Toppings', name: 'Chocolate Drizzle', unit: 'ml', costPrice: 0.35, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Toppings', name: 'Sea Salt Flakes',   unit: 'g',  costPrice: 3.00, startingQty:  100, lowStockAlert:  25 },
  { category: 'Toppings', name: 'Mint Leaves',       unit: 'pc', costPrice: 2.00, startingQty:   50, lowStockAlert:  15 },
  { category: 'Toppings', name: 'Lemon Slices',      unit: 'pc', costPrice: 3.00, startingQty:   50, lowStockAlert:  15 },
  { category: 'Toppings', name: 'Tapioca Pearls',    unit: 'g',  costPrice: 0.50, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Toppings', name: 'Sago',              unit: 'g',  costPrice: 0.30, startingQty:  500, lowStockAlert: 100 },
  { category: 'Toppings', name: 'Aiyu Jelly',        unit: 'g',  costPrice: 0.50, startingQty:  500, lowStockAlert: 100 },

  // ── 💧 Water & Ice ──────────────────────────────────────────────────────
  { category: 'Water & Ice', name: 'Filtered Water',   unit: 'ml', costPrice: 0.005, startingQty: 50000, lowStockAlert: 10000 },
  { category: 'Water & Ice', name: 'Ice (cubed)',       unit: 'g',  costPrice: 0.020, startingQty: 20000, lowStockAlert:  4000 },
  { category: 'Water & Ice', name: 'Sparkling Water',  unit: 'ml', costPrice: 0.10,  startingQty:  5000, lowStockAlert:  1000 },
  { category: 'Water & Ice', name: 'Tonic Water',      unit: 'ml', costPrice: 0.30,  startingQty:  2000, lowStockAlert:   400 },

  // ── 🥤 Disposables ─────────────────────────────────────────────────────
  { category: 'Disposables', name: 'Cup 8oz Hot (paper)',     unit: 'pc', costPrice: 3.00, startingQty:  200, lowStockAlert:  50 },
  { category: 'Disposables', name: 'Cup 12oz Hot (paper)',    unit: 'pc', costPrice: 4.00, startingQty:  500, lowStockAlert: 100 },
  { category: 'Disposables', name: 'Cup 16oz Hot (paper)',    unit: 'pc', costPrice: 5.00, startingQty:  300, lowStockAlert:  60 },
  { category: 'Disposables', name: 'Cup 12oz Cold (PET)',     unit: 'pc', costPrice: 4.50, startingQty:  500, lowStockAlert: 100 },
  { category: 'Disposables', name: 'Cup 16oz Cold (PET)',     unit: 'pc', costPrice: 5.50, startingQty:  500, lowStockAlert: 100 },
  { category: 'Disposables', name: 'Cup 22oz Cold (PET)',     unit: 'pc', costPrice: 7.00, startingQty:  200, lowStockAlert:  50 },
  { category: 'Disposables', name: 'Lid 8oz (hot)',            unit: 'pc', costPrice: 1.50, startingQty:  200, lowStockAlert:  50 },
  { category: 'Disposables', name: 'Lid 12-16oz (hot, sippy)', unit: 'pc', costPrice: 1.80, startingQty:  800, lowStockAlert: 160 },
  { category: 'Disposables', name: 'Lid 12oz Cold (flat)',     unit: 'pc', costPrice: 1.50, startingQty:  500, lowStockAlert: 100 },
  { category: 'Disposables', name: 'Lid 16oz Cold (dome)',     unit: 'pc', costPrice: 2.00, startingQty:  500, lowStockAlert: 100 },
  { category: 'Disposables', name: 'Lid 22oz Cold',            unit: 'pc', costPrice: 2.20, startingQty:  200, lowStockAlert:  50 },
  { category: 'Disposables', name: 'Straw (regular plastic)',  unit: 'pc', costPrice: 0.50, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Disposables', name: 'Straw (paper, bio)',        unit: 'pc', costPrice: 1.20, startingQty:  500, lowStockAlert: 100 },
  { category: 'Disposables', name: 'Straw (boba, fat)',         unit: 'pc', costPrice: 1.00, startingQty:  300, lowStockAlert:  60 },
  { category: 'Disposables', name: 'Stopper / Coffee Plug',     unit: 'pc', costPrice: 0.30, startingQty: 1500, lowStockAlert: 300 },
  { category: 'Disposables', name: 'Stir Stick (wood)',         unit: 'pc', costPrice: 0.20, startingQty: 1000, lowStockAlert: 200 },
  { category: 'Disposables', name: 'Heat Sleeve',               unit: 'pc', costPrice: 1.50, startingQty:  500, lowStockAlert: 100 },
  { category: 'Disposables', name: 'Carrier (2-cup)',           unit: 'pc', costPrice: 4.00, startingQty:  100, lowStockAlert:  25 },
  { category: 'Disposables', name: 'Carrier (4-cup)',           unit: 'pc', costPrice: 6.00, startingQty:   50, lowStockAlert:  15 },
  { category: 'Disposables', name: 'Napkin',                    unit: 'pc', costPrice: 0.30, startingQty: 2000, lowStockAlert: 400 },
  { category: 'Disposables', name: 'Tissue Pack',               unit: 'pc', costPrice: 1.00, startingQty:  100, lowStockAlert:  25 },

  // ── 🥪 Light Food (optional — for cafés serving sandwiches/pastries) ──
  { category: 'Light Food', name: 'Bread Slice (wheat/white)',         unit: 'pc', costPrice: 5.00,  startingQty:   50, lowStockAlert: 15 },
  { category: 'Light Food', name: 'Croissant (raw, frozen)',            unit: 'pc', costPrice: 25.00, startingQty:   30, lowStockAlert: 10 },
  { category: 'Light Food', name: 'Bagel (raw, frozen)',                unit: 'pc', costPrice: 18.00, startingQty:   20, lowStockAlert:  6 },
  { category: 'Light Food', name: 'Butter',                              unit: 'g',  costPrice: 0.40,  startingQty: 1000, lowStockAlert: 200 },
  { category: 'Light Food', name: 'Strawberry Jam',                      unit: 'g',  costPrice: 0.30,  startingQty: 1000, lowStockAlert: 200 },
  { category: 'Light Food', name: 'Cream Cheese',                        unit: 'g',  costPrice: 0.50,  startingQty: 1000, lowStockAlert: 200 },
  { category: 'Light Food', name: 'Sliced Cheese (cheddar/mozzarella)',  unit: 'pc', costPrice: 8.00,  startingQty:   50, lowStockAlert: 15 },
  { category: 'Light Food', name: 'Bacon Strip',                         unit: 'pc', costPrice: 10.00, startingQty:   50, lowStockAlert: 15 },
  { category: 'Light Food', name: 'Ham Slice',                           unit: 'pc', costPrice: 8.00,  startingQty:   50, lowStockAlert: 15 },
  { category: 'Light Food', name: 'Egg',                                 unit: 'pc', costPrice: 9.00,  startingQty:   60, lowStockAlert: 15 },
  { category: 'Light Food', name: 'Lettuce',                             unit: 'g',  costPrice: 0.20,  startingQty: 1000, lowStockAlert: 200 },
  { category: 'Light Food', name: 'Tomato',                              unit: 'g',  costPrice: 0.15,  startingQty: 1000, lowStockAlert: 200 },
  { category: 'Light Food', name: 'Mayonnaise',                          unit: 'ml', costPrice: 0.20,  startingQty: 1000, lowStockAlert: 200 },
];

/** Returns total ingredient count — used by the Console UI to show progress. */
export const COFFEE_SHOP_INGREDIENT_COUNT = COFFEE_SHOP_INGREDIENTS.length;
