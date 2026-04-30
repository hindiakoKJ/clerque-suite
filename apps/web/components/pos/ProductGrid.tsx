'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { cn, formatPeso } from '@/lib/utils';
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
  imageUrl?: string | null;
  modifierGroups?: ProductModifierGroup[];
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
            className={`w-full pl-9 ${multiplier > 1 ? 'pr-16' : 'pr-4'} h-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-shadow`}
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
              'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
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
                'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((p) => {
              const inv = p.inventory?.[0];
              const stock = inv?.quantity != null ? Number(inv.quantity) : null;
              const threshold = inv?.lowStockAlert ?? null;
              const isLow = stock !== null && threshold !== null && stock <= threshold;
              const isOut = stock === 0;
              return (
                <button
                  key={p.id}
                  onClick={() => handleAdd(p)}
                  disabled={isOut}
                  className={cn(
                    'group relative flex flex-col items-start p-3 rounded-xl border hover:shadow-md active:scale-95 transition-all text-left',
                    isOut
                      ? 'bg-muted border-border opacity-60 cursor-not-allowed'
                      : isLow
                      ? 'bg-card border-amber-400 dark:border-amber-500 hover:border-amber-500 dark:hover:border-amber-400'
                      : 'bg-card border-border hover:border-[var(--accent)]/40',
                  )}
                >
                  {/* Image tile — falls back to category emoji when no imageUrl */}
                  <div className={cn(
                    'w-full h-12 rounded-lg flex items-center justify-center mb-2 transition-colors overflow-hidden',
                    isLow
                      ? 'bg-amber-500/10 group-hover:bg-amber-500/15'
                      : 'bg-[var(--accent-soft)] group-hover:bg-[var(--accent-soft)]/80',
                  )}>
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Hide on load failure → fallback to emoji is already
                          // behind the img; just hide the broken image.
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-2xl">
                        {p.category?.name === 'Beverages' ? '☕' :
                         p.category?.name === 'Food' ? '🍱' : '📦'}
                      </span>
                    )}
                  </div>

                  <p className="text-xs font-medium text-foreground leading-tight line-clamp-2">{p.name}</p>
                  <p className="text-sm font-bold mt-1" style={{ color: 'var(--accent)' }}>{formatPeso(Number(p.price))}</p>

                  {/* Stock badge */}
                  {stock !== null && (
                    <span className={cn(
                      'absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold',
                      isOut
                        ? 'bg-muted text-muted-foreground'
                        : isLow
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                    )}>
                      {isOut ? 'OUT' : isLow ? `LOW·${stock}` : stock}
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
