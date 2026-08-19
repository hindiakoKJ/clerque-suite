/**
 * Placeholder magnet catalog — one PRODUCT PER SIZE, each with its own cost
 * and price, so a magnetmoments.cc shop's Clerque tenant has a real POS
 * catalog and real per-size margin from day one.
 *
 * SKUs are the magnetmoments `HARDWARE_PRESETS` ids (lib/spec/hardware.ts in
 * the Print Web App), so a sale line's `sku` routes straight to its product.
 * Cost/price are PLACEHOLDERS in the tenant's own currency (major units) —
 * the seller edits them in Products; seeding is idempotent and NEVER
 * overwrites a product that already exists (their edits win).
 *
 * Why per size matters for the books: orders.create takes the COGS snapshot
 * cost from the LINE's costPrice (copied from Product.costPrice), so a single
 * zero-cost "Magnet sale" product can never post COGS. Per-size products with
 * a real costPrice → DR 5010 COGS / CR 1050 Inventory posts on every sale.
 */
export interface MagnetCatalogItem {
  /** = magnetmoments hardware preset id (routes sale lines by sku). */
  sku:          string;
  name:         string;
  /** Selling price placeholder, major units of the tenant currency. */
  price:        number;
  /** Unit cost placeholder (blank ferrite/sheet + print + wrap), major units. */
  costPrice:    number;
  /** Plain-English size for the product description. */
  description:  string;
}

export const MAGNET_CATEGORY = { name: 'Magnets', revenueAccountCode: '4010' } as const;

/** Fallback for a line whose sku is missing/unknown — zero-priced anchor, no COGS. */
export const MAGNET_GENERIC = { sku: '__MAGNET_SALE__', name: 'Magnet sale' } as const;

export const MAGNET_CATALOG: readonly MagnetCatalogItem[] = [
  // Squares
  { sku: 'sq_2',        name: '2" × 2" Square Magnet',        price: 6,  costPrice: 2,   description: '2 × 2 in (51 × 51 mm) ferrite photo magnet' },
  { sku: 'sq_2_5',      name: '2.5" × 2.5" Square Magnet',    price: 8,  costPrice: 2.5, description: '2.5 × 2.5 in (64 × 64 mm) ferrite photo magnet' },
  { sku: 'sq_3',        name: '3" × 3" Square Magnet',        price: 10, costPrice: 3,   description: '3 × 3 in (76 × 76 mm) ferrite photo magnet' },
  // Rectangles
  { sku: 'rect_2x3',    name: '2" × 3" Rectangle Magnet',     price: 8,  costPrice: 2.5, description: '2 × 3 in (51 × 76 mm) ferrite photo magnet' },
  { sku: 'rect_wallet', name: '2.5" × 3.5" Wallet Magnet',    price: 9,  costPrice: 3,   description: '2.5 × 3.5 in wallet-size ferrite photo magnet' },
  { sku: 'rect_65x90',  name: '65 × 90 mm Rectangle Magnet',  price: 9,  costPrice: 3,   description: '65 × 90 mm ferrite photo magnet' },
  // Sticker sheet
  { sku: 'sheet_atm',   name: 'ATM Card Magnet',              price: 5,  costPrice: 1.5, description: '85.6 × 54 mm photo sticker on flexible magnetic sheet' },
  // Rounds
  { sku: 'round_25',    name: '25 mm Round Magnet',           price: 3,  costPrice: 1,   description: '25 mm round badge magnet' },
  { sku: 'round_32',    name: '32 mm Round Magnet',           price: 4,  costPrice: 1.2, description: '32 mm round badge magnet' },
  { sku: 'round_44',    name: '44 mm Round Magnet',           price: 5,  costPrice: 1.5, description: '44 mm round badge magnet' },
  { sku: 'round_58',    name: '58 mm Round Badge Magnet',     price: 6,  costPrice: 2,   description: '58 mm round badge magnet' },
  { sku: 'round_75',    name: '75 mm Round Magnet',           price: 8,  costPrice: 2.5, description: '75 mm round badge magnet' },
];

export const MAGNET_CATALOG_BY_SKU: ReadonlyMap<string, MagnetCatalogItem> =
  new Map(MAGNET_CATALOG.map((i) => [i.sku, i]));
