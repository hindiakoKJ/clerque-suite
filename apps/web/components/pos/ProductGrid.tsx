'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { cn, formatPeso } from '@/lib/utils';
import { resolveAssetUrl } from '@/lib/api';
import { useCartStore, type CartProduct } from '@/store/pos/cart';
import { ModifierPickerModal } from '@/components/pos/ModifierPickerModal';
import type { CartItemModifier } from '@repo/shared-types';

interface Category {
  id: string;
  name: string;
}

interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number | string;
  isDefault: boolean;
  isActive: boolean;
}

interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  minSelect: number;
  maxSelect: number | null;
  options: ModifierOption[];
}

interface ProductModifierGroup {
  modifierGroupId: string;
  sortOrder: number;
  modifierGroup: ModifierGroup;
}

interface Product {
  id: string;
  name: string;
  price: string | number;
  costPrice?: string | number | null;
  isVatable: boolean;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  inventory?: { quantity: string | number; lowStockAlert?: number | null }[];
  /** Whether this product is RECIPE_BASED (made from ingredients) or UNIT_BASED. */
  inventoryMode?: 'UNIT_BASED' | 'RECIPE_BASED';
  /**
   * Max sellable units right now — for UNIT_BASED, this is finished-goods stock.
   * For RECIPE_BASED, it's MIN(rawMaterial.stock / bom.qty) across all ingredients.
   * Updates instantly when ingredients are sold or received.
   */
  maxProducible?: number | null;
  isLowStock?: boolean;
  isOutOfStock?: boolean;
  imageUrl?: string | null;
  modifierGroups?: ProductModifierGroup[];
  /** Pharmacy: needs Rx attached at the till before sale. */
  isRxRequired?: boolean;
  /** Pharmacy: RA 9165 controlled substance — DDB Register auto-logged. */
  isControlledDrug?: boolean;
  /** Pharmacy: PH drug-classification taxonomy. DDB_S2 needs Yellow Rx. */
  drugClass?:
    | 'OTC' | 'OTC_BTC' | 'RX_ONLY'
    | 'DDB_S2' | 'DDB_S3' | 'DDB_S4' | 'DDB_S5'
    | 'VACCINE' | 'DEVICE' | 'SUPPLEMENT' | 'COSMETIC' | 'OTHER';
}

interface ProductGridProps {
  products: Product[];
  categories: Category[];
  loading?: boolean;
}

export function ProductGrid({ products, categories, loading }: ProductGridProps) {
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const addItem = useCartStore((s) => s.addItem);

  // Quantity multiplier: leading "3x ", "3* ", or "3 " is parsed off the search
  // term so the cashier can ring up "3x latte" → next tap adds 3 of that line.
  // Multiplier is reset back to 1 after each successful add.
  const qtyMatch  = search.match(/^(\d+)\s*[x*]?\s+(.*)$/i);
  const multiplier = qtyMatch ? Math.min(99, Math.max(1, parseInt(qtyMatch[1], 10))) : 1;
  const searchTerm = qtyMatch ? qtyMatch[2] : search;

  const filtered = products.filter((p) => {
    const matchCat = !activeCat || p.categoryId === activeCat;
    if (!searchTerm) return matchCat;
    const q = searchTerm.toLowerCase();
    // Match against name OR sku OR barcode — manual SKU entry just works in the
    // same search box, no separate field needed.
    const matchName    = p.name.toLowerCase().includes(q);
    const matchSku     = (p as { sku?: string }).sku?.toLowerCase().includes(q) ?? false;
    const matchBarcode = (p as { barcode?: string }).barcode?.toLowerCase().includes(q) ?? false;
    return matchCat && (matchName || matchSku || matchBarcode);
  });

  function handleAdd(p: Product) {
    // Sprint 19 — Pharmacy: Rx-required products are added to cart freely;
    // PIN-attest happens later from the cart panel right before Charge. The
    // old "Has the customer presented Rx?" confirmation that lived here was
    // friction the assistant didn't need — they've already eyeballed the
    // paper Rx in their hand by the time they're tapping the till.
    const activeGroups = (p.modifierGroups ?? []).filter(
      (g) => g.modifierGroup.options.some((o) => o.isActive),
    );
    if (activeGroups.length > 0) {
      // Modifier picker handles a single item at a time — multiplier doesn't apply.
      setPickerProduct(p);
      return;
    }
    commitAdd(p, [], multiplier);
  }

  function commitAdd(p: Product, modifiers: CartItemModifier[], qty = 1) {
    const product: CartProduct = {
      id: p.id,
      name: p.name,
      price: Number(p.price),
      costPrice: p.costPrice != null ? Number(p.costPrice) : undefined,
      isVatable: p.isVatable,
      categoryId: p.categoryId ?? undefined,
      isRxRequired:     p.isRxRequired,
      isControlledDrug: p.isControlledDrug,
      drugClass:        p.drugClass,
    };
    for (let i = 0; i < qty; i++) {
      addItem(product, undefined, modifiers);
    }
    setPickerProduct(null);
    // Clear search after a successful add so the multiplier resets and the
    // cashier sees the full grid for the next item.
    if (qty > 1 || search) setSearch('');
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Search + Category filters */}
      <div className="p-3 bg-card border-b border-border space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, SKU, or barcode  (try: 3x latte)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full pl-10 ${multiplier > 1 ? 'pr-16' : 'pr-4'} h-11 sm:h-12 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-shadow`}
          />
          {multiplier > 1 && (
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md text-xs font-bold text-white"
              style={{ background: 'var(--accent)' }}
              title={`Next tap will add ${multiplier} of the selected product`}
            >
              ×{multiplier}
            </span>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setActiveCat(null)}
            className={cn(
              'shrink-0 px-4 sm:px-5 min-h-[36px] sm:min-h-[40px] rounded-full text-sm font-semibold border transition-colors',
              !activeCat
                ? 'text-white border-transparent shadow-sm'
                : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80',
            )}
            style={!activeCat ? { background: 'var(--accent)' } : undefined}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={cn(
                'shrink-0 px-4 sm:px-5 min-h-[36px] sm:min-h-[40px] rounded-full text-sm font-semibold border transition-colors',
                activeCat === cat.id
                  ? 'text-white border-transparent shadow-sm'
                  : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80',
              )}
              style={activeCat === cat.id ? { background: 'var(--accent)' } : undefined}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            No products found
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {filtered.map((p) => {
              // Prefer the server-computed maxProducible (handles both unit-based
              // products and recipe-based dishes uniformly). Fall back to the
              // legacy inventory array for any older payload during transition.
              const stock =
                p.maxProducible !== undefined && p.maxProducible !== null
                  ? p.maxProducible
                  : p.inventory?.[0]?.quantity != null
                    ? Number(p.inventory[0].quantity)
                    : null;
              const isLow = p.isLowStock ?? false;
              const isOut = p.isOutOfStock ?? stock === 0;
              // Subtle per-category gradient so cards don't all look flat-cream.
              // No external images required — purely CSS tint by category name.
              const catName = p.category?.name?.toLowerCase() ?? '';
              const gradient =
                catName.includes('beverage') || catName.includes('coffee') || catName.includes('drink')
                  ? 'linear-gradient(135deg, #FFF8EF 0%, #FFFFFF 100%)' // warm coffee tint
                  : catName.includes('food') || catName.includes('breakfast') || catName.includes('meal')
                  ? 'linear-gradient(135deg, #FFF4E0 0%, #FFFFFF 100%)' // amber food tint
                  : catName.includes('pastry') || catName.includes('dessert') || catName.includes('bread')
                  ? 'linear-gradient(135deg, #FBF1FF 0%, #FFFFFF 100%)' // pink dessert tint
                  : catName.includes('snack')
                  ? 'linear-gradient(135deg, #F3FBE9 0%, #FFFFFF 100%)' // soft green snack
                  : 'linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--card)) 100%)';
              return (
                <button
                  key={p.id}
                  onClick={() => handleAdd(p)}
                  disabled={isOut}
                  className={cn(
                    'group relative flex flex-col items-start p-3 rounded-xl border hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all text-left min-h-[200px] sm:min-h-[220px] shadow-sm',
                    isOut
                      ? 'bg-muted border-border opacity-60 cursor-not-allowed'
                      : isLow
                      ? 'border-amber-400 dark:border-amber-500 hover:border-amber-500 dark:hover:border-amber-400 hover:ring-2 hover:ring-amber-400/30'
                      : 'border-border hover:border-[var(--accent)] hover:ring-2 hover:ring-[var(--accent)]/20',
                  )}
                  style={!isOut ? { background: gradient } : undefined}
                >
                  {/* Image tile — prominent for tablet/touch, falls back to category emoji */}
                  <div className={cn(
                    'w-full aspect-square rounded-lg flex items-center justify-center mb-2 transition-colors overflow-hidden',
                    isLow
                      ? 'bg-amber-500/10 group-hover:bg-amber-500/15'
                      : 'bg-[var(--accent-soft)] group-hover:bg-[var(--accent-soft)]/80',
                  )}>
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveAssetUrl(p.imageUrl)}
                        alt={p.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-3xl sm:text-4xl">
                        {p.category?.name === 'Beverages' ? '☕' :
                         p.category?.name === 'Food' ? '🍱' : '📦'}
                      </span>
                    )}
                  </div>

                  <p className="text-sm sm:text-base font-semibold text-foreground leading-tight line-clamp-2 font-display">{p.name}</p>

                  {/* Pharmacy badges — Rx and DDB controlled. Sit just above
                      the price so the cashier sees them before tapping. */}
                  {(p.isRxRequired || p.isControlledDrug) && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.isRxRequired && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400">
                          ℞ Rx required
                        </span>
                      )}
                      {p.isControlledDrug && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          DDB
                        </span>
                      )}
                    </div>
                  )}

                  <p className="text-base sm:text-lg font-extrabold mt-auto pt-1 tnum font-display tracking-tight" style={{ color: 'var(--accent)' }}>{formatPeso(Number(p.price))}</p>

                  {/* Stock badge — shows "X left" so cashier knows max sellable units.
                      For recipe-based products, this is computed from ingredients
                      and updates instantly when ingredients are consumed. */}
                  {stock !== null && (
                    <span className={cn(
                      'absolute top-2 right-2 text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full font-semibold',
                      isOut
                        ? 'bg-muted text-muted-foreground'
                        : isLow
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                    )}>
                      {isOut ? 'OUT' : isLow ? `LOW · ${stock}` : `${stock} left`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {pickerProduct && (
        <ModifierPickerModal
          productName={pickerProduct.name}
          basePrice={Number(pickerProduct.price)}
          modifierGroups={pickerProduct.modifierGroups ?? []}
          onConfirm={(mods) => commitAdd(pickerProduct, mods)}
          onClose={() => setPickerProduct(null)}
        />
      )}

    </div>
  );
}
