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
  // Sprint 19 — Pharmacy. When the cashier taps an Rx-required product, we
  // pause and confirm the customer presented a prescription before adding
  // it to the cart. RxConfirmModal reads this state.
  const [rxConfirmProduct, setRxConfirmProduct] = useState<Product | null>(null);
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
    // Sprint 19 — Pharmacy: Rx-required products need a prescription
    // attached at the till. Intercept the add and show the confirm
    // dialog. The cashier confirms the customer presented an Rx;
    // proceedRxAdd then runs the normal add flow.
    if (p.isRxRequired) {
      setRxConfirmProduct(p);
      return;
    }
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

  function proceedRxAdd(p: Product) {
    setRxConfirmProduct(null);
    const activeGroups = (p.modifierGroups ?? []).filter(
      (g) => g.modifierGroup.options.some((o) => o.isActive),
    );
    if (activeGroups.length > 0) {
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
              'shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-colors',
              !activeCat
                ? 'text-white'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
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
                'shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-colors',
                activeCat === cat.id
                  ? 'text-white'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
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
              return (
                <button
                  key={p.id}
                  onClick={() => handleAdd(p)}
                  disabled={isOut}
                  className={cn(
                    'group relative flex flex-col items-start p-2.5 sm:p-3 rounded-xl border hover:shadow-md active:scale-95 transition-all text-left min-h-[160px] sm:min-h-[180px]',
                    isOut
                      ? 'bg-muted border-border opacity-60 cursor-not-allowed'
                      : isLow
                      ? 'bg-card border-amber-400 dark:border-amber-500 hover:border-amber-500 dark:hover:border-amber-400'
                      : 'bg-card border-border hover:border-[var(--accent)]/40',
                  )}
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

                  <p className="text-xs sm:text-sm font-medium text-foreground leading-tight line-clamp-2">{p.name}</p>

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

                  <p className="text-sm sm:text-base font-bold mt-auto pt-1" style={{ color: 'var(--accent)' }}>{formatPeso(Number(p.price))}</p>

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

      {rxConfirmProduct && (
        <RxConfirmModal
          product={rxConfirmProduct}
          onConfirm={() => proceedRxAdd(rxConfirmProduct)}
          onCancel={() => setRxConfirmProduct(null)}
        />
      )}
    </div>
  );
}

/**
 * Sprint 19 — Pharmacy Rx confirmation gate.
 *
 * Surfaced when the cashier taps an isRxRequired product. The Rx itself is
 * attached at checkout via a separate Rx selector (so a single Rx covers
 * multiple lines from the same patient), but this is the in-the-moment
 * "are we even allowed to ring this up" gate. Refusing here removes the
 * product from consideration; confirming adds it to the cart with no Rx
 * attached yet — the Charge button blocks until one is linked.
 */
function RxConfirmModal({
  product, onConfirm, onCancel,
}: { product: { name: string; isControlledDrug?: boolean }; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-card border border-border p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-rose-500/15 p-2.5 shrink-0">
            <span className="text-rose-600 dark:text-rose-400 font-bold">℞</span>
          </div>
          <div>
            <h2 className="font-semibold text-base">Prescription required</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground">{product.name}</span> is{' '}
              {product.isControlledDrug
                ? <>a controlled substance under <strong>RA 9165</strong>. A valid prescription <em>and</em> the dispensing pharmacist&apos;s entry in the DDB Register are required.</>
                : <>an Rx-only product under <strong>RA 6675</strong>. A valid doctor&apos;s prescription is required to dispense it.</>}
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
          Has the customer presented a written prescription from a licensed physician?
          <ul className="mt-1.5 space-y-0.5 list-disc list-inside text-[11px]">
            <li>Verify the doctor&apos;s name + PRC license + signature</li>
            <li>Issue date should be within 1 year (6 months for controlled)</li>
            <li>Patient name + age + diagnosis on the Rx</li>
            {product.isControlledDrug && <li className="text-amber-600 dark:text-amber-400 font-medium">Controlled drugs need a Yellow DDB Form</li>}
          </ul>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            Cancel — no Rx
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-[var(--accent)] text-white text-sm px-4 py-2 hover:opacity-90 inline-flex items-center gap-1.5"
          >
            <span>Yes, Rx presented</span>
          </button>
        </div>
      </div>
    </div>
  );
}
