/**
 * Demo scenarios for Clerque Console's "Reset Demo Data" feature.
 * Each scenario models a real Philippine MSME business type.
 * Prices are VAT-inclusive, set at market rates as of 2026.
 */

export type ScenarioKey =
  // Food-Engine
  | 'COFFEE_SHOP'
  | 'BAKERY'
  | 'RESTAURANT'
  // Retail-Engine
  | 'SARI_SARI'
  | 'BOUTIQUE'
  | 'HARDWARE'
  // Service-Engine
  | 'LAUNDRY'
  | 'AUTO_REPAIR'
  // Project-Engine
  | 'MANUFACTURING'
  | 'CONSTRUCTION'
  // Compliance-Engine
  | 'PHARMACY'
  // Logistics-Engine
  | 'TRUCKING';

export interface DemoProduct {
  name:        string;
  description: string;
  price:       number;   // VAT-inclusive PH Peso
  costPrice?:  number;
  isVatable:   boolean;
}

export interface DemoCategory {
  name:      string;
  sortOrder: number;
  products:  DemoProduct[];
}

export interface DemoRawMaterial {
  name:      string;
  unit:      string;   // 'g', 'ml', 'pc', 'kg', etc.
  costPrice: number;   // per unit cost
  stockQty:  number;   // demo starting quantity
}

export interface DemoBomItem {
  productName:      string;  // must match DemoProduct.name
  rawMaterialName:  string;  // must match DemoRawMaterial.name
  quantity:         number;  // amount consumed per 1 unit sold
}

export interface DemoScenario {
  label:        string;
  /** Must match the BusinessType enum in schema.prisma exactly. */
  businessType:
    | 'COFFEE_SHOP' | 'RESTAURANT' | 'BAKERY' | 'FOOD_STALL' | 'BAR_LOUNGE' | 'CATERING'
    | 'RETAIL' | 'SERVICE' | 'LAUNDRY' | 'MANUFACTURING'
    | 'PHARMACY' | 'TRUCKING' | 'CONSTRUCTION';
  taxStatus:    'VAT' | 'NON_VAT' | 'UNREGISTERED';
  categories:   DemoCategory[];
  rawMaterials?: DemoRawMaterial[];
  bomItems?:     DemoBomItem[];
}

export const DEMO_SCENARIOS: Record<ScenarioKey, DemoScenario> = {

  COFFEE_SHOP: {
    label: 'Coffee Shop (Brew & Co.)',
    businessType: 'COFFEE_SHOP',
    taxStatus: 'VAT',
    categories: [
      {
        name: 'Hot Drinks', sortOrder: 1,
        products: [
          { name: 'Americano',         description: 'Double shot espresso with hot water', price: 120, costPrice: 35, isVatable: true },
          { name: 'Latte',             description: 'Espresso with steamed milk and light foam', price: 155, costPrice: 45, isVatable: true },
          { name: 'Cappuccino',        description: 'Espresso, steamed milk, thick foam', price: 150, costPrice: 43, isVatable: true },
          { name: 'Mocha',             description: 'Espresso, chocolate syrup, steamed milk', price: 165, costPrice: 50, isVatable: true },
          { name: 'Flat White',        description: 'Double ristretto with velvety microfoam', price: 160, costPrice: 48, isVatable: true },
          { name: 'Hot Chocolate',     description: 'Belgian dark chocolate blend', price: 140, costPrice: 42, isVatable: true },
          { name: 'Matcha Latte',      description: 'Ceremonial grade matcha with steamed milk', price: 175, costPrice: 55, isVatable: true },
        ],
      },
      {
        name: 'Cold Drinks', sortOrder: 2,
        products: [
          { name: 'Iced Americano',    description: 'Double espresso over ice', price: 135, costPrice: 38, isVatable: true },
          { name: 'Iced Latte',        description: 'Espresso, cold milk, ice', price: 165, costPrice: 48, isVatable: true },
          { name: 'Caramel Frappe',    description: 'Blended coffee, caramel, whipped cream', price: 195, costPrice: 60, isVatable: true },
          { name: 'Matcha Frappe',     description: 'Blended matcha, milk, whipped cream', price: 195, costPrice: 62, isVatable: true },
          { name: 'Mango Smoothie',    description: 'Fresh mango blended with milk', price: 185, costPrice: 55, isVatable: true },
          { name: 'Strawberry Lemonade', description: 'Fresh strawberries with lemon juice', price: 175, costPrice: 50, isVatable: true },
        ],
      },
      {
        name: 'Pastries', sortOrder: 3,
        products: [
          { name: 'Butter Croissant',  description: 'Flaky, buttery pastry baked fresh daily', price: 95, costPrice: 35, isVatable: true },
          { name: 'Blueberry Muffin',  description: 'Moist muffin loaded with blueberries', price: 85, costPrice: 28, isVatable: true },
          { name: 'Ensaymada',         description: 'Soft Filipino brioche with butter and cheese', price: 75, costPrice: 25, isVatable: true },
          { name: 'NY Cheesecake',     description: 'Classic baked cheesecake, graham crust', price: 165, costPrice: 55, isVatable: true },
          { name: 'Cinnamon Roll',     description: 'Warm roll with cream cheese glaze', price: 120, costPrice: 40, isVatable: true },
          { name: 'Banana Bread',      description: 'Home-style loaf with walnuts', price: 90, costPrice: 30, isVatable: true },
        ],
      },
      {
        name: 'Food', sortOrder: 4,
        products: [
          { name: 'Club Sandwich',     description: 'Triple-decker with ham, turkey, and veggies', price: 225, costPrice: 80, isVatable: true },
          { name: 'Chicken Pesto Pasta', description: 'Al dente pasta with basil pesto and chicken', price: 235, costPrice: 85, isVatable: true },
          { name: 'Garden Salad',      description: 'Mixed greens, cherry tomatoes, balsamic', price: 185, costPrice: 60, isVatable: true },
          { name: 'French Fries',      description: 'Crispy shoestring fries with aioli', price: 135, costPrice: 40, isVatable: true },
        ],
      },
    ],

    rawMaterials: [
      { name: 'Espresso Beans',      unit: 'g',   costPrice: 2.50, stockQty: 5000  },
      { name: 'Fresh Milk',          unit: 'ml',  costPrice: 0.12, stockQty: 20000 },
      { name: 'Oat Milk',            unit: 'ml',  costPrice: 0.35, stockQty: 10000 },
      { name: 'Matcha Powder',       unit: 'g',   costPrice: 3.50, stockQty: 1000  },
      { name: 'Chocolate Syrup',     unit: 'ml',  costPrice: 0.25, stockQty: 5000  },
      { name: 'Caramel Syrup',       unit: 'ml',  costPrice: 0.22, stockQty: 5000  },
      { name: 'Cup 12oz (hot)',       unit: 'pc',  costPrice: 4.00, stockQty: 500   },
      { name: 'Cup 16oz (cold)',      unit: 'pc',  costPrice: 5.50, stockQty: 500   },
    ],

    bomItems: [
      // ─── Hot Drinks ────────────────────────────────────────────────────────
      { productName: 'Americano',     rawMaterialName: 'Espresso Beans',  quantity: 18  },
      { productName: 'Americano',     rawMaterialName: 'Cup 12oz (hot)',   quantity: 1   },
      { productName: 'Latte',         rawMaterialName: 'Espresso Beans',  quantity: 18  },
      { productName: 'Latte',         rawMaterialName: 'Fresh Milk',      quantity: 150 },
      { productName: 'Latte',         rawMaterialName: 'Cup 12oz (hot)',   quantity: 1   },
      { productName: 'Cappuccino',    rawMaterialName: 'Espresso Beans',  quantity: 18  },
      { productName: 'Cappuccino',    rawMaterialName: 'Fresh Milk',      quantity: 100 },
      { productName: 'Cappuccino',    rawMaterialName: 'Cup 12oz (hot)',   quantity: 1   },
      { productName: 'Mocha',         rawMaterialName: 'Espresso Beans',  quantity: 18  },
      { productName: 'Mocha',         rawMaterialName: 'Fresh Milk',      quantity: 120 },
      { productName: 'Mocha',         rawMaterialName: 'Chocolate Syrup', quantity: 20  },
      { productName: 'Mocha',         rawMaterialName: 'Cup 12oz (hot)',   quantity: 1   },
      { productName: 'Flat White',    rawMaterialName: 'Espresso Beans',  quantity: 18  },
      { productName: 'Flat White',    rawMaterialName: 'Fresh Milk',      quantity: 130 },
      { productName: 'Flat White',    rawMaterialName: 'Cup 12oz (hot)',   quantity: 1   },
      { productName: 'Hot Chocolate', rawMaterialName: 'Chocolate Syrup', quantity: 30  },
      { productName: 'Hot Chocolate', rawMaterialName: 'Fresh Milk',      quantity: 180 },
      { productName: 'Hot Chocolate', rawMaterialName: 'Cup 12oz (hot)',   quantity: 1   },
      { productName: 'Matcha Latte',  rawMaterialName: 'Matcha Powder',   quantity: 5   },
      { productName: 'Matcha Latte',  rawMaterialName: 'Fresh Milk',      quantity: 150 },
      { productName: 'Matcha Latte',  rawMaterialName: 'Cup 12oz (hot)',   quantity: 1   },
      // ─── Cold Drinks ───────────────────────────────────────────────────────
      { productName: 'Iced Americano',     rawMaterialName: 'Espresso Beans',  quantity: 18  },
      { productName: 'Iced Americano',     rawMaterialName: 'Cup 16oz (cold)',  quantity: 1   },
      { productName: 'Iced Latte',         rawMaterialName: 'Espresso Beans',  quantity: 18  },
      { productName: 'Iced Latte',         rawMaterialName: 'Fresh Milk',      quantity: 150 },
      { productName: 'Iced Latte',         rawMaterialName: 'Cup 16oz (cold)',  quantity: 1   },
      { productName: 'Caramel Frappe',     rawMaterialName: 'Espresso Beans',  quantity: 18  },
      { productName: 'Caramel Frappe',     rawMaterialName: 'Fresh Milk',      quantity: 200 },
      { productName: 'Caramel Frappe',     rawMaterialName: 'Caramel Syrup',   quantity: 20  },
      { productName: 'Caramel Frappe',     rawMaterialName: 'Cup 16oz (cold)',  quantity: 1   },
      { productName: 'Matcha Frappe',      rawMaterialName: 'Matcha Powder',   quantity: 5   },
      { productName: 'Matcha Frappe',      rawMaterialName: 'Oat Milk',        quantity: 200 },
      { productName: 'Matcha Frappe',      rawMaterialName: 'Cup 16oz (cold)',  quantity: 1   },
      { productName: 'Mango Smoothie',     rawMaterialName: 'Fresh Milk',      quantity: 150 },
      { productName: 'Mango Smoothie',     rawMaterialName: 'Cup 16oz (cold)',  quantity: 1   },
      { productName: 'Strawberry Lemonade',rawMaterialName: 'Cup 16oz (cold)',  quantity: 1   },
    ],
  },

  BAKERY: {
    label: 'Bakery (La Panaderia)',
    businessType: 'BAKERY',
    taxStatus: 'NON_VAT',
    categories: [
      {
        name: 'Breads', sortOrder: 1,
        products: [
          { name: 'Pandesal (6 pcs)',   description: 'Freshly baked Filipino bread rolls', price: 30, costPrice: 12, isVatable: false },
          { name: 'Spanish Bread (4 pcs)', description: 'Soft rolls filled with sugared butter', price: 40, costPrice: 15, isVatable: false },
          { name: 'Monay',             description: 'Dense, lightly sweet bread', price: 28, costPrice: 10, isVatable: false },
          { name: 'Pandesul',          description: 'Filipino-style soft loaf', price: 65, costPrice: 25, isVatable: false },
          { name: 'Tasty Loaf',        description: 'Family-size sliced white bread', price: 85, costPrice: 35, isVatable: false },
          { name: 'Whole Wheat Loaf',  description: 'Nutritious multigrain loaf', price: 110, costPrice: 45, isVatable: false },
        ],
      },
      {
        name: 'Cakes & Slices', sortOrder: 2,
        products: [
          { name: 'Chocolate Cake (slice)', description: 'Rich chocolate ganache cake', price: 195, costPrice: 70, isVatable: false },
          { name: 'Buko Pandan (cup)',  description: 'Pandan jelly, young coconut, cream', price: 125, costPrice: 40, isVatable: false },
          { name: 'Leche Flan',        description: 'Classic caramel custard, family size', price: 185, costPrice: 60, isVatable: false },
          { name: 'Ube Chiffon (slice)', description: 'Purple yam chiffon cake', price: 175, costPrice: 58, isVatable: false },
          { name: 'Sans Rival',        description: 'Dacquoise layers with French buttercream', price: 215, costPrice: 75, isVatable: false },
        ],
      },
      {
        name: 'Pastries & Cookies', sortOrder: 3,
        products: [
          { name: 'Ensaymada (classic)', description: 'Soft coiled roll with grated cheese', price: 65, costPrice: 22, isVatable: false },
          { name: 'Crinkles (6 pcs)',   description: 'Fudgy chocolate crinkle cookies', price: 55, costPrice: 18, isVatable: false },
          { name: 'Polvoron (box of 10)', description: 'Filipino shortbread candy', price: 75, costPrice: 25, isVatable: false },
          { name: 'Empanada',          description: 'Flaky pastry filled with chicken and potato', price: 55, costPrice: 20, isVatable: false },
          { name: 'Pianono Roll',      description: 'Rolled sponge cake with cream filling', price: 95, costPrice: 32, isVatable: false },
        ],
      },
      {
        name: 'Savory Items', sortOrder: 4,
        products: [
          { name: 'Arroz Caldo',       description: 'Chicken rice congee with ginger', price: 95, costPrice: 35, isVatable: false },
          { name: 'Pansit Bihon (solo)', description: 'Rice noodles stir-fried with vegetables', price: 120, costPrice: 45, isVatable: false },
          { name: 'Goto',              description: 'Ox tripe congee with garnishes', price: 110, costPrice: 40, isVatable: false },
        ],
      },
      {
        name: 'Hot Drinks', sortOrder: 5,
        products: [
          { name: 'Brewed Coffee',     description: 'Freshly brewed Batangas barako', price: 65, costPrice: 18, isVatable: false },
          { name: 'Hot Chocolate',     description: 'Rich tablea hot chocolate', price: 85, costPrice: 25, isVatable: false },
          { name: 'Salabat',           description: 'Ginger tea with honey', price: 55, costPrice: 15, isVatable: false },
        ],
      },
    ],
  },

  SARI_SARI: {
    label: 'Sari-Sari Store (Corner Mart)',
    businessType: 'RETAIL',  // RETAIL is a valid BusinessType enum value
    taxStatus: 'UNREGISTERED',
    categories: [
      {
        name: 'Beverages', sortOrder: 1,
        products: [
          { name: 'Coke 1.5L',         description: 'Coca-Cola 1.5 liter pet bottle', price: 78, costPrice: 62, isVatable: false },
          { name: 'Royal 1L',          description: 'Royal True Orange 1 liter', price: 56, costPrice: 44, isVatable: false },
          { name: 'Bottled Water 500ml', description: 'Absolute / Summit / Nature Spring', price: 20, costPrice: 14, isVatable: false },
          { name: 'C2 Green Tea 500ml', description: 'Ready-to-drink green tea', price: 32, costPrice: 24, isVatable: false },
          { name: 'Milo 3-in-1 (box of 10)', description: 'Milo sachet box', price: 85, costPrice: 68, isVatable: false },
          { name: 'Nescafe 3-in-1 (12 sachets)', description: 'Nescafe Original twin-pack', price: 72, costPrice: 58, isVatable: false },
        ],
      },
      {
        name: 'Snacks & Chips', sortOrder: 2,
        products: [
          { name: 'Lay\'s Cheese 60g',  description: 'Lay\'s Classic cheese flavored chips', price: 58, costPrice: 46, isVatable: false },
          { name: 'Piattos 85g',        description: 'Piattos potato crisps', price: 42, costPrice: 33, isVatable: false },
          { name: 'Chippy Barbecue',    description: 'Chippy corn chips barbecue', price: 28, costPrice: 22, isVatable: false },
          { name: 'Skyflakes Crackers', description: 'Skyflakes multipacks', price: 35, costPrice: 27, isVatable: false },
          { name: 'Mr. Chips 55g',      description: 'Assorted flavored tortilla chips', price: 32, costPrice: 25, isVatable: false },
        ],
      },
      {
        name: 'Canned Goods', sortOrder: 3,
        products: [
          { name: 'Ligo Sardines 155g', description: 'Sardines in tomato sauce', price: 42, costPrice: 33, isVatable: false },
          { name: 'Century Tuna 180g',  description: 'Hot and spicy flakes in oil', price: 52, costPrice: 41, isVatable: false },
          { name: 'Argentina Corned Beef 260g', description: 'Corned beef', price: 88, costPrice: 70, isVatable: false },
          { name: 'Palm Corned Beef 175g', description: 'Palm corned beef', price: 55, costPrice: 43, isVatable: false },
          { name: 'Del Monte Pineapple Juice 240ml', description: 'Pineapple juice can', price: 38, costPrice: 30, isVatable: false },
        ],
      },
      {
        name: 'Personal Care', sortOrder: 4,
        products: [
          { name: 'Safeguard Soap 90g', description: 'Antibacterial bath soap', price: 48, costPrice: 38, isVatable: false },
          { name: 'Shampoo Sachet',     description: 'Pantene / Sunsilk sachet', price: 12, costPrice: 9, isVatable: false },
          { name: 'Colgate Toothpaste 40ml', description: 'Colgate travel size', price: 38, costPrice: 30, isVatable: false },
          { name: 'Whisper Pad (pack)', description: 'Feminine hygiene pad', price: 58, costPrice: 46, isVatable: false },
          { name: 'Safeguard 3-in-1 Shampoo sachet', description: 'Safeguard hair & body wash sachet', price: 10, costPrice: 7, isVatable: false },
        ],
      },
      {
        name: 'Household & Condiments', sortOrder: 5,
        products: [
          { name: 'Silver Swan Soy Sauce 220ml', description: 'Toyo all-purpose', price: 35, costPrice: 27, isVatable: false },
          { name: 'Datu Puti Vinegar 250ml', description: 'Sukang maasim', price: 28, costPrice: 21, isVatable: false },
          { name: 'UFC Banana Ketchup 320g', description: 'Sweet banana ketchup', price: 55, costPrice: 43, isVatable: false },
          { name: 'Ariel Powder Sachet', description: '66g laundry powder', price: 18, costPrice: 14, isVatable: false },
          { name: 'Scotch Tape Small',   description: 'Clear adhesive tape', price: 22, costPrice: 16, isVatable: false },
        ],
      },
    ],
  },

  RESTAURANT: {
    label: 'Filipino Restaurant (Casa de Manila)',
    businessType: 'RESTAURANT',
    taxStatus: 'VAT',
    categories: [
      {
        name: 'Appetizers', sortOrder: 1,
        products: [
          { name: 'Lumpiang Shanghai (6 pcs)', description: 'Crispy fried spring rolls with sweet chili', price: 195, costPrice: 65, isVatable: true },
          { name: 'Kuhol sa Gata',       description: 'Escargot in coconut milk and chilies', price: 225, costPrice: 80, isVatable: true },
          { name: 'Tokwa\'t Baboy',      description: 'Fried tofu and pork belly with vinegar dip', price: 175, costPrice: 60, isVatable: true },
          { name: 'Pako Salad',          description: 'Fiddlehead fern with tomato and salted egg', price: 185, costPrice: 55, isVatable: true },
        ],
      },
      {
        name: 'Soups', sortOrder: 2,
        products: [
          { name: 'Sinigang na Baboy',   description: 'Pork ribs in tamarind broth (good for 2)', price: 385, costPrice: 145, isVatable: true },
          { name: 'Bulalo',              description: 'Beef shank bone marrow soup', price: 495, costPrice: 190, isVatable: true },
          { name: 'Nilaga',              description: 'Clear beef and vegetable soup', price: 345, costPrice: 125, isVatable: true },
          { name: 'Tinolang Manok',      description: 'Chicken soup with papaya and malunggay', price: 295, costPrice: 105, isVatable: true },
        ],
      },
      {
        name: 'Main Dishes', sortOrder: 3,
        products: [
          { name: 'Crispy Pata',         description: 'Deep-fried pork knuckle, crispy skin', price: 595, costPrice: 220, isVatable: true },
          { name: 'Kare-Kare',           description: 'Oxtail peanut stew with bagoong', price: 445, costPrice: 165, isVatable: true },
          { name: 'Sisig (sizzling)',     description: 'Chopped pork face on hot cast iron plate', price: 285, costPrice: 100, isVatable: true },
          { name: 'Pinakbet',            description: 'Mixed vegetables with shrimp paste', price: 225, costPrice: 75, isVatable: true },
          { name: 'Adobong Pusit',       description: 'Squid in soy-vinegar adobo sauce', price: 295, costPrice: 110, isVatable: true },
          { name: 'Lechon Kawali',       description: 'Deep-fried crispy pork belly', price: 345, costPrice: 125, isVatable: true },
          { name: 'Bistek Tagalog',      description: 'Beef strips in soy-citrus sauce with onions', price: 325, costPrice: 120, isVatable: true },
        ],
      },
      {
        name: 'Rice & Sides', sortOrder: 4,
        products: [
          { name: 'Steamed Rice',        description: 'Plain steamed white rice', price: 45, costPrice: 15, isVatable: true },
          { name: 'Garlic Fried Rice',   description: 'Sinangag with lots of garlic', price: 65, costPrice: 20, isVatable: true },
          { name: 'Pancit Canton',       description: 'Stir-fried egg noodles with vegetables', price: 195, costPrice: 65, isVatable: true },
        ],
      },
      {
        name: 'Desserts', sortOrder: 5,
        products: [
          { name: 'Halo-Halo',           description: 'Shaved ice with beans, jelly, leche flan and ube', price: 165, costPrice: 55, isVatable: true },
          { name: 'Leche Flan',          description: 'Steamed caramel custard', price: 125, costPrice: 40, isVatable: true },
          { name: 'Buko Pandan',         description: 'Young coconut with pandan jelly in cream', price: 135, costPrice: 45, isVatable: true },
          { name: 'Mais con Yelo',       description: 'Sweet corn kernels over shaved ice', price: 95, costPrice: 28, isVatable: true },
        ],
      },
      {
        name: 'Drinks', sortOrder: 6,
        products: [
          { name: 'Coke (glass)',        description: 'Coca-Cola over ice', price: 75, costPrice: 22, isVatable: true },
          { name: 'Iced Tea (pitcher)',  description: 'Bottomless iced tea', price: 165, costPrice: 30, isVatable: true },
          { name: 'Buko Juice',          description: 'Fresh young coconut water with strips', price: 95, costPrice: 35, isVatable: true },
          { name: 'San Mig Beer (bottle)', description: '330ml San Miguel Pale Pilsen', price: 95, costPrice: 60, isVatable: true },
          { name: 'Red Horse Beer',      description: '500ml Red Horse Extra Strong', price: 85, costPrice: 52, isVatable: true },
        ],
      },
    ],
  },

  BOUTIQUE: {
    label: 'Fashion Boutique (Luxe MNL)',
    businessType: 'RETAIL',  // RETAIL is a valid BusinessType enum value
    taxStatus: 'VAT',
    categories: [
      {
        name: 'Women\'s Tops', sortOrder: 1,
        products: [
          { name: 'Floral Crop Top',     description: 'Printed floral crop, adjustable straps', price: 449, costPrice: 150, isVatable: true },
          { name: 'Off-Shoulder Blouse', description: 'Ruffle hem, available in 4 colors', price: 495, costPrice: 165, isVatable: true },
          { name: 'Linen Polo',          description: 'Relaxed fit breathable linen', price: 525, costPrice: 175, isVatable: true },
          { name: 'Knit Tank Top',       description: 'Ribbed knit, cropped silhouette', price: 395, costPrice: 130, isVatable: true },
          { name: 'Graphic Tee Oversized', description: 'Cotton oversized, minimalist print', price: 425, costPrice: 140, isVatable: true },
        ],
      },
      {
        name: 'Women\'s Bottoms', sortOrder: 2,
        products: [
          { name: 'High-Rise Mom Jeans', description: 'Vintage wash, high waist', price: 995, costPrice: 340, isVatable: true },
          { name: 'Linen Wide-Leg Pants', description: 'Flowy, elastic waistband', price: 745, costPrice: 250, isVatable: true },
          { name: 'Floral Maxi Skirt',   description: 'Flowy wrap maxi with slit', price: 695, costPrice: 230, isVatable: true },
          { name: 'Mini Skirt (pleated)', description: 'Pleated school-girl style', price: 595, costPrice: 195, isVatable: true },
        ],
      },
      {
        name: 'Dresses', sortOrder: 3,
        products: [
          { name: 'Sundress (midi)',      description: 'Floral print, adjustable straps, midi length', price: 795, costPrice: 265, isVatable: true },
          { name: 'Wrap Dress',          description: 'V-neck wrap silhouette, satin finish', price: 895, costPrice: 295, isVatable: true },
          { name: 'Bodycon (black)',      description: 'Figure-hugging evening dress', price: 1195, costPrice: 395, isVatable: true },
          { name: 'Coord Set (2-pc)',     description: 'Matching crop top and wide-leg pants', price: 1095, costPrice: 365, isVatable: true },
        ],
      },
      {
        name: 'Men\'s Wear', sortOrder: 4,
        products: [
          { name: 'Linen Barong Casual', description: 'Modern barong, tailored fit', price: 895, costPrice: 300, isVatable: true },
          { name: 'Polo Shirt (classic)', description: 'Pique cotton polo, branded collar', price: 595, costPrice: 195, isVatable: true },
          { name: 'Chino Pants',         description: 'Slim-fit stretch chino', price: 895, costPrice: 295, isVatable: true },
          { name: 'Graphic Hoodie',      description: 'Fleece hoodie, screen-printed design', price: 995, costPrice: 330, isVatable: true },
        ],
      },
      {
        name: 'Accessories', sortOrder: 5,
        products: [
          { name: 'Beaded Earrings',     description: 'Handmade beaded drop earrings', price: 195, costPrice: 55, isVatable: true },
          { name: 'Shell Necklace',      description: 'Cowrie shell on waxed cord', price: 275, costPrice: 75, isVatable: true },
          { name: 'Canvas Tote Bag',     description: 'Heavy-duty printed canvas tote', price: 395, costPrice: 110, isVatable: true },
          { name: 'Hair Claw Clip (set)', description: 'Set of 3 assorted resin claw clips', price: 145, costPrice: 40, isVatable: true },
          { name: 'Scrunchie (pack of 5)', description: 'Velvet and satin scrunchie pack', price: 125, costPrice: 35, isVatable: true },
        ],
      },
    ],
  },
  // ────────────────────────────────────────────────────────────────────────
  // LAUNDRY — wash & fold + retail (detergent, hangers, fabric softener)
  // ────────────────────────────────────────────────────────────────────────
  // Note: laundry SERVICES (wash / dry / dry-clean rates) are seeded as
  // LaundryServicePrice rows in admin.service.ts → seedLaundryDefaults()
  // (called when scenarioKey === 'LAUNDRY'). The catalog below is the
  // RETAIL side only — items the customer can buy at the counter alongside
  // a claim ticket.
  LAUNDRY: {
    label: 'Laundromat (SudsUp)',
    businessType: 'LAUNDRY',
    taxStatus: 'NON_VAT',
    categories: [
      {
        name: 'Detergents', sortOrder: 1,
        products: [
          { name: 'Tide Powder Sachet (60g)',  description: 'Single-load detergent sachet',         price: 18,  costPrice: 9,   isVatable: false },
          { name: 'Surf Powder 700g',          description: 'Family-size laundry detergent',        price: 95,  costPrice: 60,  isVatable: false },
          { name: 'Ariel Liquid 800ml',        description: 'Concentrated liquid detergent',        price: 175, costPrice: 110, isVatable: false },
          { name: 'Joy Dishwashing Liquid',    description: '250ml — for whites/delicates pre-wash', price: 65,  costPrice: 40,  isVatable: false },
        ],
      },
      {
        name: 'Fabric Care', sortOrder: 2,
        products: [
          { name: 'Downy Antibac (1.5L)',      description: 'Antibacterial fabric conditioner',     price: 245, costPrice: 160, isVatable: false },
          { name: 'Bear Brand Fabric Softener',description: '900ml refill pack',                    price: 95,  costPrice: 60,  isVatable: false },
          { name: 'Lemon Bleach (500ml)',      description: 'Color-safe oxygen bleach',             price: 65,  costPrice: 40,  isVatable: false },
          { name: 'Stain Remover Spray',       description: 'Pre-wash stain treatment',             price: 145, costPrice: 90,  isVatable: false },
        ],
      },
      {
        name: 'Accessories', sortOrder: 3,
        products: [
          { name: 'Plastic Hanger (per pc)',   description: 'Heavy-duty plastic clothes hanger',    price: 8,   costPrice: 3,   isVatable: false },
          { name: 'Garment Bag (medium)',      description: 'Mesh wash bag for delicates',          price: 65,  costPrice: 30,  isVatable: false },
          { name: 'Garment Bag (large)',       description: 'Large mesh wash bag',                  price: 95,  costPrice: 50,  isVatable: false },
          { name: 'Lint Roller',               description: 'Adhesive lint roller, 60 sheets',      price: 85,  costPrice: 45,  isVatable: false },
        ],
      },
      {
        name: 'Add-on Services (retail SKU)', sortOrder: 4,
        products: [
          { name: 'Express Same-day Surcharge', description: 'Add-on fee for same-day completion',  price: 100, costPrice: 0, isVatable: false },
          { name: 'Pickup Fee (within 3km)',    description: 'Door pickup within 3 km radius',       price: 50,  costPrice: 0, isVatable: false },
          { name: 'Delivery Fee (within 3km)',  description: 'Door delivery within 3 km radius',     price: 50,  costPrice: 0, isVatable: false },
        ],
      },
    ],
    // Laundry doesn't use the BOM system — services consume detergent in bulk
    // tracked via inventoryAdjust, not per-claim recipe deduction.
    rawMaterials: [],
    bomItems: [],
  },

  // ────────────────────────────────────────────────────────────────────────
  // HARDWARE — Retail-Engine. Common PH neighborhood hardware store.
  // Hand tools, fasteners, paint, electricals, plumbing. Key UX: per-item
  // UoM (piece / box / pack) with conversion at checkout.
  // ────────────────────────────────────────────────────────────────────────
  HARDWARE: {
    label: 'Hardware Store (Manila Hardware)',
    businessType: 'RETAIL',
    taxStatus: 'VAT',
    categories: [
      {
        name: 'Hand Tools', sortOrder: 1,
        products: [
          { name: 'Hammer (claw, 16oz)',     description: 'Steel-handle claw hammer',        price:  350, costPrice: 180, isVatable: true },
          { name: 'Pliers (combination 8")', description: 'Insulated combination pliers',     price:  295, costPrice: 145, isVatable: true },
          { name: 'Phillips Screwdriver (#2)', description: 'Magnetic-tip Phillips driver',   price:  165, costPrice:  75, isVatable: true },
          { name: 'Tape Measure (5m)',       description: '5-meter retractable steel tape',   price:  185, costPrice:  85, isVatable: true },
          { name: 'Adjustable Wrench (10")', description: '10-inch adjustable wrench',        price:  395, costPrice: 195, isVatable: true },
        ],
      },
      {
        name: 'Fasteners', sortOrder: 2,
        products: [
          { name: 'Wood Screw 2" (per pc)',  description: 'Phillips-head wood screw',         price:    3, costPrice:  1.2, isVatable: true },
          { name: 'Wood Screw 2" (box of 100)', description: 'Box of 100 wood screws',         price:  245, costPrice: 120,  isVatable: true },
          { name: 'Concrete Nail 3" (per pc)', description: 'Hardened concrete nail',         price:    5, costPrice:  2,   isVatable: true },
          { name: 'Self-tapping Screw (pack of 50)', description: 'Steel self-tap, ½"',       price:  165, costPrice:  80,  isVatable: true },
        ],
      },
      {
        name: 'Paint', sortOrder: 3,
        products: [
          { name: 'Latex Paint White (1 gal)',   description: 'Boysen latex, gallon',         price:  595, costPrice: 410, isVatable: true },
          { name: 'Enamel Paint Black (1 qt)',   description: 'Davies enamel, quart',         price:  295, costPrice: 195, isVatable: true },
          { name: 'Custom Tint (made-to-order)', description: 'Base + tint — assembled at counter', price: 850, costPrice: 510, isVatable: true },
          { name: 'Paint Roller (9")',           description: 'Foam paint roller',            price:  185, costPrice:  85, isVatable: true },
          { name: 'Paint Brush 2"',              description: 'Natural-bristle paint brush',  price:   95, costPrice:  40, isVatable: true },
        ],
      },
      {
        name: 'Electricals', sortOrder: 4,
        products: [
          { name: 'PVC Flex Cord (per meter)',   description: 'Twin-core household cord',     price:   85, costPrice:  45, isVatable: true },
          { name: 'Outlet (2-gang)',             description: 'Universal 2-gang outlet',      price:  175, costPrice:  85, isVatable: true },
          { name: 'LED Bulb 9W',                 description: 'Daylight LED, E27 base',       price:  165, costPrice:  85, isVatable: true },
          { name: 'Extension Cord (2m)',         description: '4-outlet extension cord',      price:  395, costPrice: 220, isVatable: true },
        ],
      },
    ],
    rawMaterials: [],
    bomItems: [],
  },

  // ────────────────────────────────────────────────────────────────────────
  // AUTO_REPAIR — Service-Engine. Small auto-repair shop (vulcanizing,
  // brake service, oil change). Sells parts retail + labor as services.
  // ────────────────────────────────────────────────────────────────────────
  AUTO_REPAIR: {
    label: 'Auto Repair Shop (Quick Auto)',
    businessType: 'SERVICE',
    taxStatus: 'NON_VAT',
    categories: [
      {
        name: 'Labor (services)', sortOrder: 1,
        products: [
          { name: 'Oil Change Service',          description: 'Drain, replace filter, refill', price:  500, costPrice: 0, isVatable: false },
          { name: 'Brake Pad Replacement',       description: 'Front pads, both wheels',        price: 1200, costPrice: 0, isVatable: false },
          { name: 'Tire Vulcanizing',            description: 'Per tire, patch + balance',      price:  150, costPrice: 0, isVatable: false },
          { name: 'Wheel Alignment',             description: 'Computerized 4-wheel alignment', price: 1500, costPrice: 0, isVatable: false },
          { name: 'Diagnostic Scan',             description: 'OBD-II error code read',         price:  500, costPrice: 0, isVatable: false },
        ],
      },
      {
        name: 'Parts (retail)', sortOrder: 2,
        products: [
          { name: 'Engine Oil 4L (10W-40)',      description: 'Mineral 10W-40, 4-liter',       price:  995, costPrice: 595, isVatable: false },
          { name: 'Oil Filter (Toyota/Mazda)',   description: 'Universal oil filter',          price:  395, costPrice: 195, isVatable: false },
          { name: 'Brake Pads (Front, generic)', description: 'Universal front brake pads',    price:  995, costPrice: 595, isVatable: false },
          { name: 'Air Filter',                  description: 'Universal air filter',          price:  495, costPrice: 295, isVatable: false },
          { name: 'Battery (45Ah, lead-acid)',   description: 'Standard car battery',          price: 3995, costPrice: 2895, isVatable: false },
        ],
      },
    ],
    rawMaterials: [],
    bomItems: [],
  },

  // ────────────────────────────────────────────────────────────────────────
  // MANUFACTURING — Project-Engine. Small fabricator: custom metal works,
  // gates, grills, tables. Recipes (BOM) drive material consumption.
  // ────────────────────────────────────────────────────────────────────────
  MANUFACTURING: {
    label: 'Metal Fabricator (Iron Works MNL)',
    businessType: 'MANUFACTURING',
    taxStatus: 'VAT',
    categories: [
      {
        name: 'Finished Goods', sortOrder: 1,
        products: [
          { name: 'Metal Gate (Standard 2m)',    description: 'Single-leaf swing gate, powder-coated', price: 18500, costPrice: 9500, isVatable: true },
          { name: 'Window Grill (Standard sqm)', description: 'Decorative window grill, per sqm',      price:  3500, costPrice: 1700, isVatable: true },
          { name: 'Steel Stair (Custom)',        description: 'Made-to-order steel stair, per riser',  price:  4500, costPrice: 2200, isVatable: true },
          { name: 'Coffee Table Frame',          description: 'Powder-coated steel table frame',       price:  6500, costPrice: 3100, isVatable: true },
        ],
      },
      {
        name: 'Raw Materials (sold separately)', sortOrder: 2,
        products: [
          { name: 'Square Tubing 1x1" (per ft)', description: 'Mild-steel square tube',         price:   95, costPrice:  55, isVatable: true },
          { name: 'Welding Rod (per kg)',        description: 'E6013 welding rod',              price:  295, costPrice: 165, isVatable: true },
        ],
      },
    ],
    rawMaterials: [
      { name: 'Square Tube 1x1" 6m',  unit: 'pc',  costPrice:  330, stockQty: 200 },
      { name: 'Flat Bar 1/4" x 1"',    unit: 'pc',  costPrice:  185, stockQty: 200 },
      { name: 'Welding Rod E6013',     unit: 'kg',  costPrice:  165, stockQty: 100 },
      { name: 'Powder Coat Paint',     unit: 'kg',  costPrice:  450, stockQty:  50 },
    ],
    bomItems: [],
  },

  // ────────────────────────────────────────────────────────────────────────
  // CONSTRUCTION — Project-Engine. General contractor. Long-running projects
  // with materials issuance, progress billing, and retention release.
  // Demo focuses on the catalog of materials + service line items.
  // ────────────────────────────────────────────────────────────────────────
  CONSTRUCTION: {
    label: 'General Contractor (BuildRight)',
    businessType: 'CONSTRUCTION',
    taxStatus: 'VAT',
    categories: [
      {
        name: 'Civil Works (services)', sortOrder: 1,
        products: [
          { name: 'Concrete Pouring (per cu.m)', description: 'Labor + tools for slab pour',   price: 4500, costPrice: 1900, isVatable: true },
          { name: 'Tile Installation (per sqm)', description: 'Tile + cement + labor',          price: 1200, costPrice:  600, isVatable: true },
          { name: 'Plumbing Rough-in',           description: 'Standard residential rough-in',  price: 35000, costPrice: 18000, isVatable: true },
          { name: 'Electrical Wiring (per outlet)', description: 'Wire + outlet + labor',       price:  995, costPrice:  395, isVatable: true },
        ],
      },
      {
        name: 'Materials', sortOrder: 2,
        products: [
          { name: 'Cement (40kg bag)',           description: 'Holcim Type I',                  price:  295, costPrice: 215, isVatable: true },
          { name: 'Rebar 10mm (6m length)',      description: 'Deformed reinforcing bar',       price:  225, costPrice: 165, isVatable: true },
          { name: 'Plywood 4x8 (1/4")',          description: 'Marine plywood',                 price:  895, costPrice: 595, isVatable: true },
          { name: 'Concrete Block (4")',         description: 'Hollow block, 4-inch',           price:   18, costPrice:  12, isVatable: true },
          { name: 'Sand (cu.m)',                 description: 'Washed river sand',              price: 1800, costPrice: 1200, isVatable: true },
          { name: 'Gravel (cu.m)',               description: '3/4" crushed gravel',            price: 1900, costPrice: 1300, isVatable: true },
        ],
      },
      {
        name: 'Tools (rental items)', sortOrder: 3,
        products: [
          { name: 'Concrete Mixer Rental (day)', description: 'Per-day rental, includes fuel', price: 1500, costPrice:  500, isVatable: true },
          { name: 'Scaffold Set (week)',         description: 'Per-week scaffold rental',       price: 4500, costPrice: 1800, isVatable: true },
        ],
      },
    ],
    rawMaterials: [],
    bomItems: [],
  },

  // ────────────────────────────────────────────────────────────────────────
  // PHARMACY — Compliance-Engine. Common PH community drugstore. The full
  // schema (Prescription, ProductLot, ControlledSubstanceLog) ships when
  // first paying pharmacy onboards. The catalog below is a representative
  // mix of OTC + prescription drugs (the Rx-required flag will surface in
  // the future Compliance-Engine UI).
  // ────────────────────────────────────────────────────────────────────────
  PHARMACY: {
    label: 'Drugstore (Botika ng Bayan)',
    businessType: 'PHARMACY',
    taxStatus: 'VAT',
    categories: [
      {
        name: 'OTC — Pain & Fever', sortOrder: 1,
        products: [
          { name: 'Paracetamol 500mg (Biogesic, per tab)', description: 'Generic name: Paracetamol',  price:   3, costPrice: 1.4, isVatable: true },
          { name: 'Mefenamic Acid 500mg (Dolfenal, per tab)', description: 'Generic: Mefenamic Acid', price:  12, costPrice:  6, isVatable: true },
          { name: 'Ibuprofen 200mg (Advil, per tab)',     description: 'Generic: Ibuprofen',           price:  10, costPrice:  5, isVatable: true },
          { name: 'Aspirin 80mg (Aspilet, per tab)',      description: 'Generic: Acetylsalicylic Acid',price:   2, costPrice:  1, isVatable: true },
        ],
      },
      {
        name: 'OTC — Cough & Cold', sortOrder: 2,
        products: [
          { name: 'Salbutamol Syrup 60ml (Ventolin)',     description: 'Generic: Salbutamol — Rx-recommended', price: 195, costPrice: 110, isVatable: true },
          { name: 'Loratadine 10mg (Claritin, per tab)',  description: 'Generic: Loratadine — antihistamine',  price:  18, costPrice:   9, isVatable: true },
          { name: 'Carbocisteine 500mg (Solmux, per cap)', description: 'Generic: Carbocisteine — mucolytic',  price:  12, costPrice:   6, isVatable: true },
        ],
      },
      {
        name: 'Rx — Antibiotics', sortOrder: 3,
        products: [
          { name: 'Amoxicillin 500mg (Amoxil, per cap)',  description: 'Generic: Amoxicillin — Rx required',   price:  18, costPrice: 10, isVatable: true },
          { name: 'Cefalexin 500mg (Keflex, per cap)',    description: 'Generic: Cefalexin — Rx required',     price:  35, costPrice: 18, isVatable: true },
          { name: 'Co-Amoxiclav 625mg (Augmentin, per tab)', description: 'Generic: Amoxicillin+Clavulanate', price:  85, costPrice: 50, isVatable: true },
        ],
      },
      {
        name: 'Vitamins & Supplements', sortOrder: 4,
        products: [
          { name: 'Vitamin C 500mg (Cecon, per tab)',      description: 'Ascorbic Acid',                  price:   5, costPrice:  2.5, isVatable: true },
          { name: 'Multivitamins (Centrum, per tab)',      description: 'Adult multivitamin + minerals',  price:  18, costPrice:  9,   isVatable: true },
          { name: 'Iron + Folic Acid (Iberet Folic, per tab)', description: 'Iron + folic supplement',    price:  25, costPrice: 14,   isVatable: true },
        ],
      },
      {
        name: 'Personal Care & Pharmacy Compounds', sortOrder: 5,
        products: [
          { name: 'Alcohol 70% (500ml)',                   description: 'Isopropyl alcohol',              price:  95, costPrice: 50, isVatable: true },
          { name: 'Hydrocortisone Cream 1% (15g)',         description: 'Topical anti-itch — OTC',        price: 195, costPrice: 110, isVatable: true },
          { name: 'Compounded Cream (Custom)',             description: 'Made-to-order pharmacy compound', price: 850, costPrice: 350, isVatable: true },
        ],
      },
    ],
    rawMaterials: [],
    bomItems: [],
  },

  // ────────────────────────────────────────────────────────────────────────
  // TRUCKING — Logistics-Engine. Small hauling/delivery operation. The full
  // workflow (TripTicket, Liquidation, Fleet, PM Schedule, TireSerial)
  // ships when first paying trucking tenant onboards. The catalog below is
  // service-line items the dispatcher can attach to a trip + retail parts.
  // ────────────────────────────────────────────────────────────────────────
  TRUCKING: {
    label: 'Trucking & Hauling (Reliable Cargo)',
    businessType: 'TRUCKING',
    taxStatus: 'VAT',
    categories: [
      {
        name: 'Trip Routes (services)', sortOrder: 1,
        products: [
          { name: 'Manila → Cebu (10-wheeler)',  description: 'Roll-on roll-off, full truckload',      price: 45000, costPrice: 28000, isVatable: true },
          { name: 'Manila → Davao (10-wheeler)', description: 'RoRo + land, full truckload',           price: 65000, costPrice: 42000, isVatable: true },
          { name: 'Manila → Baguio (6-wheeler)', description: 'Land freight, full truckload',          price: 18000, costPrice:  9500, isVatable: true },
          { name: 'Local Delivery (Metro Manila)', description: 'Same-day delivery, per drop',          price:  1500, costPrice:   650, isVatable: true },
          { name: 'Express Surcharge',           description: 'Weekend / next-day add-on',              price:  3000, costPrice:     0, isVatable: true },
        ],
      },
      {
        name: 'Trip Costs (passed-through)', sortOrder: 2,
        products: [
          { name: 'Fuel Allowance (per trip)',   description: 'Diesel allocation per route',            price:  6500, costPrice: 6500, isVatable: false },
          { name: 'Toll Fee (per trip)',         description: 'NLEX/SLEX/STAR toll',                    price:  1500, costPrice: 1500, isVatable: false },
          { name: 'Driver Allowance (per trip)', description: 'Per-trip driver per-diem',               price:  1200, costPrice: 1200, isVatable: false },
        ],
      },
      {
        name: 'Parts (retail counter)', sortOrder: 3,
        products: [
          { name: 'Engine Oil 16L (15W-40)',     description: 'Heavy-duty diesel oil',                 price: 4500, costPrice: 2800, isVatable: true },
          { name: 'Hydraulic Oil 18L',           description: 'AW46 hydraulic',                        price: 3995, costPrice: 2400, isVatable: true },
          { name: 'Tire 11R22.5 (truck)',        description: 'New radial truck tire',                 price: 18500, costPrice: 11500, isVatable: true },
          { name: 'Tire Retread 11R22.5',        description: 'Retreaded truck tire',                  price: 8500, costPrice: 5200,  isVatable: true },
        ],
      },
    ],
    rawMaterials: [],
    bomItems: [],
  },
};

/** Return all products flat from a scenario */
export function allProducts(scenario: DemoScenario): DemoProduct[] {
  return scenario.categories.flatMap((c) => c.products);
}
