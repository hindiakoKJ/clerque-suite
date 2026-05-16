'use client';
/**
 * Retail terminal — scan-first, dense SKU table.
 * Built to match the `POSRetail` mock in apps/web/public/design-preview/screens-verticals.jsx.
 *
 * Layout:
 *   Top   — large scan field (autofocus, USB scanner indicator), Tingi toggle
 *   Mid   — dense SKU table (56px rows): SKU / name / stock / price / [+]
 *   Right — CartPanel (re-used), with amber 18+ banner and phone-lookup header
 *
 * Branches on businessType === 'RETAIL' in terminal/page.tsx.
 */
import { useEffect, useRef, useState } from 'react';
import { Search, Plus, AlertTriangle, Phone } from 'lucide-react';
import { CartPanel } from '@/components/pos/CartPanel';
import { useCartStore, type CartProduct } from '@/store/pos/cart';
import { useAuthStore } from '@/store/auth';
import { cn, formatPeso } from '@/lib/utils';
import type { JwtPayload } from '@repo/shared-types';
import type { CachedProduct, CachedCategory } from '@/lib/pos/db';

/** Loose view over CachedProduct with the optional stock fields the POS API stamps. */
type RetailProduct = CachedProduct & {
  sku?: string;
  barcode?: string;
  maxProducible?: number | null;
  inventory?: { quantity: string | number }[];
  isLowStock?: boolean;
  isOutOfStock?: boolean;
  isAgeRestricted?: boolean;
};

interface RetailTerminalProps {
  products: CachedProduct[];
  categories: CachedCategory[];
  loading?: boolean;
  onCheckout: () => void;
  onApplyPwdSc: () => void;
  onOpenParkedSales: () => void;
}

export function RetailTerminal({
  products,
  categories,
  loading,
  onCheckout,
  onApplyPwdSc,
  onOpenParkedSales,
}: RetailTerminalProps) {
  const [scan, setScan] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [tingiMode, setTingiMode] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  const addItem = useCartStore((s) => s.addItem);
  const lines = useCartStore((s) => s.lines);

  // Plan-gated phone-lookup affordance (Sprint 25 Phase 2A).
  const planFeatures = useAuthStore((s) => (s.user as JwtPayload | null)?.planFeatures);
  const phoneLookupEnabled = Boolean(planFeatures?.customerPhoneLookup);

  // Autofocus the scan field on mount and whenever the field loses focus on
  // an otherwise-empty page — typical USB scanner workflow.
  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  // Any line with an age-restricted product trips the RA 9211 banner.
  const hasAgeRestricted = lines.some((l) => l.product.isAgeRestricted);

  // Treat products from the cache as the loose RetailProduct shape — the API
  // stamps optional stock + age fields that the base CachedProduct type doesn't
  // formally declare.
  const productsR = products as RetailProduct[];

  // Filter SKUs by category + free-text scan/search.
  const term = scan.trim().toLowerCase();
  const filtered = productsR.filter((p) => {
    const matchCat = !activeCat || p.categoryId === activeCat;
    if (!term) return matchCat;
    const sku = p.sku?.toLowerCase() ?? '';
    const barcode = p.barcode?.toLowerCase() ?? '';
    return matchCat && (
      p.name.toLowerCase().includes(term) || sku.includes(term) || barcode.includes(term)
    );
  });

  function handleAdd(p: RetailProduct) {
    const cartProduct: CartProduct = {
      id: p.id,
      name: p.name,
      price: Number(p.price),
      costPrice: p.costPrice != null ? Number(p.costPrice) : undefined,
      isVatable: p.isVatable,
      categoryId: p.categoryId ?? undefined,
      isAgeRestricted: p.isAgeRestricted,
    };
    addItem(cartProduct);
    setScan('');
    scanRef.current?.focus();
  }

  // Recent scans = the last 8 added lines, dedup'd by product.
  const recentScans: RetailProduct[] = [];
  const seen = new Set<string>();
  for (let i = lines.length - 1; i >= 0 && recentScans.length < 8; i--) {
    const pid = lines[i].product.id;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const match = productsR.find((p) => p.id === pid);
    if (match) recentScans.push(match);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Hero scan + tingi */}
      <div className="px-6 py-4 bg-secondary border-b border-border shrink-0">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label
            className={cn(
              'flex items-center gap-4 bg-card border-2 rounded-2xl px-5 py-3 transition-shadow',
              'border-[var(--accent)] shadow-[0_0_0_5px_rgba(59,130,246,0.15)]',
            )}
          >
            <Search className="h-6 w-6 shrink-0" style={{ color: 'var(--accent)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
                Scan or search
              </div>
              <input
                ref={scanRef}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered.length > 0) {
                    handleAdd(filtered[0]);
                  }
                }}
                placeholder="SKU, barcode, or name"
                className="w-full bg-transparent border-0 outline-none font-mono-counter text-xl font-semibold text-foreground mt-0.5 placeholder:text-muted-foreground/50"
                aria-label="Scan or search"
              />
            </div>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-md"
              style={{
                background: 'var(--counter-success-soft, #D7F4E7)',
                color: 'var(--counter-success-deep, #065F46)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--counter-success, #10B981)' }}
              />
              Scanner ready
            </span>
          </label>
          <button
            onClick={() => setTingiMode((v) => !v)}
            className={cn(
              'min-h-[64px] px-6 rounded-2xl font-semibold text-sm border transition-colors',
              tingiMode
                ? 'text-white shadow-sm border-transparent'
                : 'bg-card text-foreground border-border hover:bg-secondary',
            )}
            style={tingiMode ? { background: 'var(--accent)' } : undefined}
            title="Toggle loose-pack (tingi) selling mode"
          >
            Tingi · loose pack
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: catalog */}
        <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5 space-y-5">
          {/* Recent scans */}
          {recentScans.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between mb-2.5">
                <h3 className="font-display font-bold text-base">Recent scans</h3>
                <span className="text-xs text-muted-foreground">Last 1 hour · auto-clears at shift end</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {recentScans.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleAdd(p)}
                    className="text-left bg-card border border-border rounded-xl px-3 py-2.5 hover:border-[var(--accent)]/40 hover:shadow-sm transition-all"
                  >
                    <div className="font-mono-counter text-[10px] text-muted-foreground">
                      {p.sku ?? p.barcode ?? p.id.slice(0, 6)}
                    </div>
                    <div className="text-[13px] font-semibold mt-1 mb-1 leading-tight line-clamp-2 min-h-[2.6em]">
                      {p.name}
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="font-display font-extrabold text-sm tnum" style={{ color: 'var(--accent)' }}>
                        {formatPeso(Number(p.price))}
                      </span>
                      <StockChip product={p} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Catalog table */}
          <div>
            <div className="flex items-baseline justify-between mb-2.5 gap-3 flex-wrap">
              <h3 className="font-display font-bold text-base">
                Browse catalog · <span className="tnum">{products.length.toLocaleString()}</span> SKUs
              </h3>
              <div className="flex gap-1.5 flex-wrap text-xs">
                <CatPill active={activeCat === null} onClick={() => setActiveCat(null)}>All</CatPill>
                {categories.map((c) => (
                  <CatPill key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>
                    {c.name}
                  </CatPill>
                ))}
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {/* Header row */}
              <div
                className="grid items-center px-4 py-2.5 bg-secondary border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                style={{ gridTemplateColumns: '110px 1fr 90px 100px 80px' }}
              >
                <span>SKU</span>
                <span>Product</span>
                <span className="text-right">Stock</span>
                <span className="text-right">Price</span>
                <span />
              </div>
              {loading ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">No products match</div>
              ) : (
                filtered.map((p, i) => {
                  const stock = p.maxProducible ?? (p.inventory?.[0]?.quantity != null ? Number(p.inventory[0].quantity) : null);
                  const isLow = p.isLowStock ?? false;
                  const isOut = p.isOutOfStock ?? stock === 0;
                  const ageRestricted = p.isAgeRestricted;
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'grid items-center px-4 gap-3 border-b border-border last:border-b-0 text-sm transition-colors',
                        isOut ? 'opacity-60' : 'hover:bg-secondary/40',
                      )}
                      style={{ gridTemplateColumns: '110px 1fr 90px 100px 80px', minHeight: 56 }}
                    >
                      <span className="font-mono-counter text-[11px] text-muted-foreground truncate">
                        {p.sku ?? p.barcode ?? '—'}
                      </span>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold truncate">{p.name}</span>
                        {ageRestricted && (
                          <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider"
                            style={{
                              background: 'var(--counter-error-soft, #FBD9D9)',
                              color: 'var(--counter-error-deep, #991B1B)',
                            }}
                          >
                            18+
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          'text-right tnum text-xs font-semibold',
                          isLow ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                        )}
                      >
                        {stock !== null ? (isLow ? `Low · ${stock}` : `${stock}`) : '—'}
                      </span>
                      <span className="text-right font-display font-bold tnum" style={{ color: 'var(--accent)' }}>
                        {formatPeso(Number(p.price))}
                      </span>
                      <span className="flex justify-end">
                        <button
                          onClick={() => handleAdd(p)}
                          disabled={isOut}
                          aria-label={`Add ${p.name}`}
                          className="h-9 w-12 rounded-lg text-white flex items-center justify-center font-bold transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: 'var(--accent)' }}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </span>
                      {i < 0 && null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right: cart rail */}
        <div className="hidden lg:flex w-[420px] shrink-0 flex-col bg-secondary border-l border-border">
          {phoneLookupEnabled && (
            <div className="px-5 py-3 bg-card border-b border-border">
              <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Phone className="h-3.5 w-3.5" />
                Customer phone
              </label>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="09XX XXX XXXX"
                inputMode="tel"
                className="w-full mt-1 font-mono-counter text-sm bg-transparent border-0 outline-none placeholder:text-muted-foreground/50"
              />
            </div>
          )}

          {hasAgeRestricted && (
            <div
              className="px-4 py-3 flex items-center gap-2.5 border-b"
              style={{
                background: 'var(--counter-warning-soft, #FCEBC9)',
                borderColor: 'var(--counter-warning, #F59E0B)',
              }}
            >
              <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: 'var(--counter-warning-deep, #92400E)' }} />
              <p className="text-xs font-medium leading-snug" style={{ color: 'var(--counter-warning-deep, #92400E)' }}>
                <b>18+ ID required at handoff (RA 9211).</b> Verify customer age before releasing tobacco / alcohol items.
              </p>
            </div>
          )}

          <div className="flex-1 min-h-0">
            <CartPanel
              onCheckout={onCheckout}
              onApplyPwdSc={onApplyPwdSc}
              onOpenParkedSales={onOpenParkedSales}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function CatPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1 rounded-md font-semibold border transition-colors',
        active
          ? 'text-[var(--accent)] border-transparent'
          : 'bg-secondary text-muted-foreground border-border hover:text-foreground',
      )}
      style={active ? { background: 'var(--counter-primary-container, #DBE8FE)' } : undefined}
    >
      {children}
    </button>
  );
}

function StockChip({ product: p }: { product: RetailProduct }) {
  const stock = p.maxProducible ?? (p.inventory?.[0]?.quantity != null ? Number(p.inventory[0].quantity) : null);
  const isLow = p.isLowStock ?? false;
  const isOut = p.isOutOfStock ?? stock === 0;
  if (stock === null) return null;
  return (
    <span
      className={cn(
        'text-[10px] font-semibold',
        isOut ? 'text-muted-foreground' : isLow ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
      )}
    >
      {isOut ? 'OUT' : isLow ? `Low · ${stock}` : `${stock} left`}
    </span>
  );
}
