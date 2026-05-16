/**
 * Mock catalogs — sized to match the per-vertical design mocks in
 * design-source/screens-verticals.jsx. Will be replaced by the Cloud sync
 * payload + offline SQLite once `src/offline/*` is wired in.
 */

export interface FBModifierOption {
  id: string;
  name: string;
  priceAdjustment: number;     // ₱ cents
}

export interface FBModifierGroup {
  id: string;
  name: string;
  required: boolean;
  /** When `required` and `min === 1`, behaves like a radio. */
  min: number;
  max: number;
  options: FBModifierOption[];
}

export interface FBProduct {
  id: string;
  name: string;
  initials: string;
  category: string;
  price: number;              // ₱ cents
  stock: number;
  lowStock?: boolean;
  bestseller?: boolean;
  modifierGroups?: FBModifierGroup[];
}

export const FB_CATEGORIES = [
  'All', 'Espresso', 'Iced Coffee', 'Specialty', 'Tea', 'Pastry', 'Mains', 'Sides',
] as const;

const SIZE_GROUP: FBModifierGroup = {
  id: 'size', name: 'Size', required: true, min: 1, max: 1,
  options: [
    { id: 'size-tall',    name: 'Tall',    priceAdjustment: 0 },
    { id: 'size-grande',  name: 'Grande',  priceAdjustment: 1500 },
    { id: 'size-venti',   name: 'Venti',   priceAdjustment: 3000 },
  ],
};

const MILK_GROUP: FBModifierGroup = {
  id: 'milk', name: 'Milk', required: true, min: 1, max: 1,
  options: [
    { id: 'milk-fresh', name: 'Fresh milk',  priceAdjustment: 0 },
    { id: 'milk-oat',   name: 'Oat',         priceAdjustment: 2000 },
    { id: 'milk-soy',   name: 'Soy',         priceAdjustment: 1500 },
    { id: 'milk-almond',name: 'Almond',      priceAdjustment: 2000 },
  ],
};

const SHOTS_GROUP: FBModifierGroup = {
  id: 'shots', name: 'Add-ons', required: false, min: 0, max: 3,
  options: [
    { id: 'add-shot',   name: 'Extra shot', priceAdjustment: 3000 },
    { id: 'add-syrup',  name: 'Flavored syrup', priceAdjustment: 1500 },
    { id: 'no-sugar',   name: 'No sugar',   priceAdjustment: 0 },
  ],
};

const COFFEE_MODS = [SIZE_GROUP, MILK_GROUP, SHOTS_GROUP];

export const FB_PRODUCTS: FBProduct[] = [
  { id: 'fb-americano',   name: 'Americano',          initials: 'Am', category: 'Espresso',    price: 11000, stock: 597 },
  { id: 'fb-cappuccino',  name: 'Cappuccino',         initials: 'Cp', category: 'Espresso',    price: 14000, stock: 89,  modifierGroups: COFFEE_MODS },
  { id: 'fb-cafe-latte',  name: 'Café Latte',         initials: 'Lt', category: 'Espresso',    price: 14500, stock: 11,  lowStock: true,  modifierGroups: COFFEE_MODS },
  { id: 'fb-spanish-latte',name:'Spanish Latte',      initials: 'SL', category: 'Specialty',   price: 16000, stock: 3,   lowStock: true,  bestseller: true, modifierGroups: COFFEE_MODS },
  { id: 'fb-mocha',       name: 'Mocha',              initials: 'Mo', category: 'Specialty',   price: 16500, stock: 240, modifierGroups: COFFEE_MODS },
  { id: 'fb-caramel-mac', name: 'Caramel Macchiato',  initials: 'CM', category: 'Specialty',   price: 17000, stock: 180, bestseller: true, modifierGroups: COFFEE_MODS },
  { id: 'fb-flat-white',  name: 'Flat White',         initials: 'FW', category: 'Espresso',    price: 15000, stock: 92,  modifierGroups: COFFEE_MODS },
  { id: 'fb-cortado',     name: 'Cortado',            initials: 'Co', category: 'Espresso',    price: 14000, stock: 64,  modifierGroups: COFFEE_MODS },
  { id: 'fb-espresso-dbl',name: 'Espresso · double',  initials: 'E2', category: 'Espresso',    price: 11000, stock: 410 },
  { id: 'fb-vd',          name: 'Vietnamese Drip',    initials: 'VD', category: 'Specialty',   price: 15500, stock: 28,  modifierGroups: COFFEE_MODS },
  { id: 'fb-cubano',      name: 'Cubano',             initials: 'Cu', category: 'Specialty',   price: 13000, stock: 45,  modifierGroups: COFFEE_MODS },
  { id: 'fb-hot-choco',   name: 'Hot Choco',          initials: 'Hc', category: 'Specialty',   price: 13000, stock: 88 },
  { id: 'fb-pandesal',    name: 'Pandesal · 6 pc',    initials: 'Pn', category: 'Pastry',      price: 4800,  stock: 32 },
  { id: 'fb-ensaymada',   name: 'Cheese ensaymada',   initials: 'En', category: 'Pastry',      price: 6500,  stock: 18 },
];

// =====================================================================
// Retail / sari-sari
// =====================================================================
export interface RetailProduct {
  id: string;
  sku: string;
  name: string;
  initials: string;
  price: number;              // ₱ cents
  stock: number;
  lowStock?: boolean;
  ageRestricted?: boolean;
  category: string;
  /** Parent SKU for tingi (loose-pack) splits. */
  parentSku?: string;
  unit?: string;
}

export const RETAIL_CATEGORIES = [
  'All', 'Beverages', 'Canned', 'Snacks', 'Smokes · 18+',
] as const;

export const RETAIL_PRODUCTS: RetailProduct[] = [
  { id: 'r-pancit-orig', sku: '480001', name: 'Lucky Me Pancit Canton Original',  initials: 'LM', price: 1400, stock: 248, category: 'Snacks' },
  { id: 'r-pancit-chil', sku: '480002', name: 'Lucky Me Pancit Canton Chilimansi',initials: 'LM', price: 1400, stock: 198, category: 'Snacks' },
  { id: 'r-coke-1500',   sku: '330905', name: 'Coca-Cola 1.5L',                   initials: 'CC', price: 7500, stock: 32,  category: 'Beverages' },
  { id: 'r-coke-500',    sku: '330906', name: 'Coca-Cola 500ml',                  initials: 'CC', price: 2500, stock: 124, category: 'Beverages' },
  { id: 'r-sprite-1500', sku: '330907', name: 'Sprite 1.5L',                      initials: 'Sp', price: 7500, stock: 28,  category: 'Beverages' },
  { id: 'r-surf-1400',   sku: '120001', name: 'Surf Powder Detergent 1.4kg',      initials: 'Sf', price: 17500, stock: 18, lowStock: true, category: 'Snacks' },
  { id: 'r-tide-380',    sku: '120014', name: 'Tide Bar 380g',                    initials: 'Td', price: 2800, stock: 86, category: 'Snacks' },
  { id: 'r-pandesal',    sku: '201108', name: 'Pandesal · 6 pc',                  initials: 'Pn', price: 4800, stock: 32, category: 'Snacks' },
  { id: 'r-spanish-br',  sku: '201112', name: 'Spanish Bread · each',             initials: 'SB', price: 800, stock: 124, category: 'Snacks' },
  { id: 'r-bearbrand',   sku: '440012', name: 'Bear Brand Powdered 320g',         initials: 'BB', price: 19500, stock: 22, category: 'Canned' },
  { id: 'r-alaska',      sku: '440018', name: 'Alaska Evap 370mL',                initials: 'Al', price: 3850, stock: 64, category: 'Canned' },
  { id: 'r-magicsarap',  sku: '550008', name: 'Magic Sarap 8g sachet',            initials: 'MS', price: 600, stock: 480, category: 'Canned' },
  { id: 'r-ajinomoto',   sku: '550009', name: 'Ajinomoto 11g sachet',             initials: 'Aj', price: 550, stock: 320, category: 'Canned' },
  { id: 'r-marlboro-red',sku: '660001', name: 'Marlboro Red',                     initials: 'Mb', price: 14500, stock: 18, lowStock: true, ageRestricted: true, category: 'Smokes · 18+' },
  { id: 'r-marlboro-lt', sku: '660002', name: 'Marlboro Lights',                  initials: 'Mb', price: 14500, stock: 12, lowStock: true, ageRestricted: true, category: 'Smokes · 18+' },
  { id: 'r-redhorse-500',sku: '770003', name: 'Red Horse 500ml',                  initials: 'RH', price: 6500, stock: 48, ageRestricted: true, category: 'Beverages' },
];
