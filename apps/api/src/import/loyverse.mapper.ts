/**
 * Loyverse -> Clerque migration mapper.
 *
 * Shops moving off Loyverse export their catalog from the Loyverse back
 * office. Rather than ask an owner to retype hundreds of items into our
 * template, we read their export directly and translate it into the exact row
 * shape our existing importers already accept — so all the hardened parsing
 * (PH number formats, sample-row skipping, category upsert, name/barcode
 * matching) is reused untouched.
 *
 * The mapping is deliberately DYNAMIC. A Loyverse export is not one fixed
 * sheet: column order varies by account, and the price/stock columns are
 * suffixed with each store's name ("Price Main Store", "In stock Kiosk 2"),
 * which we cannot know ahead of time. So columns are resolved by matching
 * header text, and per-store columns are discovered at run time.
 */

/** A Loyverse export sheet reduced to what Clerque needs. */
export interface LoyverseParseResult {
  /** Rows shaped for importProductsFromRows(). */
  productRows: string[][];
  /** Rows shaped for importInventoryFromRows(). */
  inventoryRows: string[][];
  /** Store columns discovered in the file (for the caller's summary). */
  storesDetected: string[];
  /** Headers we could not place — surfaced so nothing is silently dropped. */
  unmappedHeaders: string[];
  /** Variant-bearing items get one Clerque product per variant. */
  variantsExpanded: number;
}

const norm = (s: unknown): string =>
  String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Header aliases, most specific first. Matched case/space-insensitively. */
const FIELD_ALIASES: Record<string, string[]> = {
  name:         ['item name', 'name', 'product name', 'item'],
  category:     ['category', 'category name'],
  sku:          ['sku'],
  barcode:      ['barcode', 'ean', 'upc'],
  description:  ['description', 'note', 'notes'],
  cost:         ['cost', 'cost price', 'purchase price'],
  price:        ['price', 'default price', 'selling price'],
  trackStock:   ['track stock', 'track inventory'],
  soldByWeight: ['sold by weight'],
  available:    ['available for sale', 'available'],
  handle:       ['handle'],
};

/** Loyverse repeats these per option slot: "Option1 Name" / "Option1 Value". */
const OPTION_NAME_RE  = /^option\s*([123])\s*name$/;
const OPTION_VALUE_RE = /^option\s*([123])\s*value$/;
/** Per-store columns, e.g. "Price Main Store" / "In stock Main Store". */
const STORE_PRICE_RE  = /^price\s+(.+)$/;
const STORE_STOCK_RE  = /^in\s?stock\s+(.+)$/;

function findHeaderRow(rows: string[][]): number {
  // The header is the first row carrying a recognisable item-name column AND
  // at least one other known field — exports sometimes have a title line
  // above the real header.
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] ?? []).map(norm);
    if (!cells.some((c) => FIELD_ALIASES.name.includes(c))) continue;
    const others = cells.filter(
      (c) =>
        c &&
        (FIELD_ALIASES.price.includes(c) ||
          FIELD_ALIASES.sku.includes(c) ||
          FIELD_ALIASES.category.includes(c) ||
          STORE_PRICE_RE.test(c)),
    );
    if (others.length > 0) return i;
  }
  return -1;
}

/**
 * True when the sheet looks like a Loyverse item export rather than one of our
 * own templates — lets the caller give a clearer error than "missing column".
 */
export function looksLikeLoyverse(rows: string[][]): boolean {
  const idx = findHeaderRow(rows);
  if (idx < 0) return false;
  const cells = (rows[idx] ?? []).map(norm);
  return (
    cells.includes('handle') ||
    cells.some((c) => STORE_PRICE_RE.test(c) || STORE_STOCK_RE.test(c)) ||
    cells.some((c) => OPTION_NAME_RE.test(c))
  );
}

export function mapLoyverseItems(rows: string[][]): LoyverseParseResult {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    throw new Error(
      'Could not find a header row. Export "Item list" from Loyverse ' +
        '(Back office > Items > Export) and upload that file unchanged.',
    );
  }

  const header = (rows[headerIdx] ?? []).map(norm);
  const col = (field: string): number => {
    for (const alias of FIELD_ALIASES[field] ?? []) {
      const i = header.indexOf(alias);
      if (i >= 0) return i;
    }
    return -1;
  };

  const idx = {
    name:        col('name'),
    category:    col('category'),
    sku:         col('sku'),
    barcode:     col('barcode'),
    description: col('description'),
    cost:        col('cost'),
    price:       col('price'),
    trackStock:  col('trackStock'),
    available:   col('available'),
  };

  // Option slots -> variant naming ("Latte" + "Large" = "Latte - Large").
  const optionValueCols: number[] = [];
  const optionNameCols: number[] = [];
  header.forEach((h, i) => {
    if (OPTION_NAME_RE.test(h)) optionNameCols.push(i);
    if (OPTION_VALUE_RE.test(h)) optionValueCols.push(i);
  });

  // Per-store price / stock columns, discovered rather than assumed.
  const storePriceCols: Array<{ store: string; i: number }> = [];
  const storeStockCols: Array<{ store: string; i: number }> = [];
  // Report store names in the owner's own capitalisation ("Main Store", not
  // "main store") — this list is shown back to them after the migration.
  const rawHeader = (rows[headerIdx] ?? []).map((c) => String(c ?? '').trim());
  const storeLabel = (i: number, fallback: string): string => {
    const raw = rawHeader[i] ?? '';
    const m = raw.match(/^(?:price|in\s?stock)\s+(.+)$/i);
    return (m ? m[1] : fallback).trim();
  };
  header.forEach((h, i) => {
    const p = h.match(STORE_PRICE_RE);
    // "price" on its own is the default-price column, not a store column.
    if (p && !FIELD_ALIASES.price.includes(h)) {
      storePriceCols.push({ store: storeLabel(i, p[1]), i });
    }
    const s = h.match(STORE_STOCK_RE);
    if (s) storeStockCols.push({ store: storeLabel(i, s[1]), i });
  });

  const storesDetected = [
    ...new Set([
      ...storePriceCols.map((c) => c.store),
      ...storeStockCols.map((c) => c.store),
    ]),
  ];

  const mappedCols = new Set<number>([
    ...Object.values(idx).filter((i) => i >= 0),
    ...optionNameCols,
    ...optionValueCols,
    ...storePriceCols.map((c) => c.i),
    ...storeStockCols.map((c) => c.i),
  ]);
  const unmappedHeaders = header
    .map((h, i) => (h && !mappedCols.has(i) ? String(rows[headerIdx][i] ?? '') : ''))
    .filter(Boolean);

  // Clerque template headers — the importers locate their data by these.
  const productRows: string[][] = [
    ['Name*', 'Category', 'Price*', 'Cost Price*', 'VAT (Y/N)', 'Barcode', 'Description'],
  ];
  const inventoryRows: string[][] = [
    ['Product Name or Barcode*', 'Quantity*', 'Low Stock Alert'],
  ];

  let variantsExpanded = 0;
  const seen = new Set<string>();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const at = (i: number): string => (i >= 0 ? String(row[i] ?? '').trim() : '');

    const baseName = at(idx.name);
    if (!baseName) continue;

    // Loyverse writes one row per VARIANT, repeating the item name. Compose a
    // distinct Clerque product name from the option values so "Latte / Large"
    // and "Latte / Small" do not collapse into one product and silently
    // overwrite each other's price.
    const optionValues = optionValueCols.map((i) => at(i)).filter(Boolean);
    const name = optionValues.length
      ? `${baseName} - ${optionValues.join(' / ')}`
      : baseName;
    if (optionValues.length) variantsExpanded++;

    // Same variant twice in one file -> keep the first, skip the duplicate.
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);

    // Prefer the default price; fall back to the first store price that has a
    // value (single-store accounts often leave the default column blank).
    let price = at(idx.price);
    if (!price) {
      for (const c of storePriceCols) {
        const v = at(c.i);
        if (v) {
          price = v;
          break;
        }
      }
    }

    productRows.push([
      name,
      at(idx.category),
      price || '0',
      at(idx.cost) || '0',
      // Loyverse carries no per-item VAT flag. Default to vatable; the
      // tenant's own tax status is what actually suppresses VAT at sale.
      'Y',
      at(idx.barcode) || at(idx.sku),
      at(idx.description),
    ]);

    // Opening stock, only for items Loyverse was actually tracking. Per-store
    // columns are summed: Clerque seeds one branch on import, and an owner
    // moving from a multi-store Loyverse reconciles per branch afterwards.
    const tracks = norm(at(idx.trackStock));
    const tracked =
      idx.trackStock < 0 || ['y', 'yes', 'true', '1'].includes(tracks);
    if (tracked && storeStockCols.length) {
      let qty = 0;
      let sawAny = false;
      for (const c of storeStockCols) {
        const raw = at(c.i);
        if (!raw) continue;
        const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
        if (Number.isFinite(n)) {
          qty += n;
          sawAny = true;
        }
      }
      if (sawAny) inventoryRows.push([name, String(qty), '']);
    }
  }

  return {
    productRows,
    inventoryRows,
    storesDetected,
    unmappedHeaders,
    variantsExpanded,
  };
}
