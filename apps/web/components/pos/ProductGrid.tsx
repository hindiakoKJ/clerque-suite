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

  const filtered = products.filter((p) => {
    const matchCat = !activeCat || p.categoryId === activeCat;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  function handleAdd(p: Product) {
    const activeGroups = (p.modifierGroups ?? []).filter(
      (g) => g.modifierGroup.options.some((o) => o.isActive),
    );
    if (activeGroups.length > 0) {
      setPickerProduct(p);
      return;
    }
    commitAdd(p, []);
  }

  function commitAdd(p: Product, modifiers: CartItemModifier[]) {
    const product: CartProduct = {
      id: p.id,
      name: p.name,
      price: Number(p.price),
      costPrice: p.costPrice != null ? Number(p.costPrice) : undefined,
      isVatable: p.isVatable,
      categoryId: p.categoryId ?? undefined,
    };
    addItem(product, undefined, modifiers);
    setPickerProduct(null);
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Search + Category filters */}
      <div className="p-3 bg-white border-b border-gray-200 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 h-10 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setActiveCat(null)}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              !activeCat
                ? 'text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
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
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
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
              <div key={i} className="h-28 rounded-xl bg-gray-200 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
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
                  className={cn(
                    'group relative flex flex-col items-start p-3 rounded-xl border hover:shadow-md active:scale-95 transition-all text-left',
                    isOut
                      ? 'bg-gray-50 border-gray-200 opacity-60'
                      : isLow
                      ? 'bg-white border-amber-300 hover:border-amber-400'
                      : 'bg-white border-gray-200',
                  )}
                  style={!isOut && !isLow ? { '--tw-ring-color': 'var(--accent)' } as React.CSSProperties : undefined}
                >
                  <div className={cn(
                    'w-full h-12 rounded-lg flex items-center justify-center mb-2 transition-colors',
                    isLow ? 'bg-amber-50 group-hover:bg-amber-100' : 'bg-[color-mix(in_oklab,var(--accent)_8%,white)] group-hover:bg-[color-mix(in_oklab,var(--accent)_14%,white)]',
                  )}>
                    <span className="text-2xl">
                      {p.category?.name === 'Beverages' ? '☕' :
                       p.category?.name === 'Food' ? '🍱' : '📦'}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-gray-900 leading-tight line-clamp-2">{p.name}</p>
                  <p className="text-sm font-bold mt-1" style={{ color: 'var(--accent)' }}>{formatPeso(Number(p.price))}</p>

                  {/* Stock badge */}
                  {stock !== null && (
                    <span className={cn(
                      'absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold',
                      isOut
                        ? 'bg-gray-200 text-gray-500'
                        : isLow
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-green-100 text-green-600',
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
