'use client';
import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Search, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { StockAdjustModal } from '@/components/pos/StockAdjustModal';
import { useDebounce } from '@/hooks/useDebounce';

interface InventoryRow {
  id: string;
  productId: string;
  branchId: string;
  quantity: number;
  totalValue: number | null;
  lowStockAlert: number | null;
  isLowStock: boolean;
  product: {
    id: string;
    name: string;
    sku: string | null;
    costPrice: string | null;
    isActive: boolean;
    category: { id: string; name: string } | null;
  };
}

interface PagedResponse {
  data: InventoryRow[];
  total: number;
  page: number;
  pages: number;
}

export default function InventoryPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? '';
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [filterLow, setFilterLow] = useState(false);
  const [page, setPage] = useState(1);
  const [adjustTarget, setAdjustTarget] = useState<InventoryRow | null>(null);
  const [editThreshold, setEditThreshold] = useState<{ id: string; value: string } | null>(null);
  const [savingThreshold, setSavingThreshold] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery<PagedResponse>({
    queryKey: ['inventory', branchId, page, debouncedSearch, filterLow],
    queryFn: () => {
      const params = new URLSearchParams({
        branchId,
        page: String(page),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(filterLow ? { lowStockOnly: 'true' } : {}),
      });
      return api.get(`/inventory?${params}`).then((r) => r.data);
    },
    enabled: !!branchId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  // MDM (Master Data Manager) can adjust stock and edit thresholds; pure STAFF is read-only
  const canEdit = user?.role === 'BUSINESS_OWNER' || user?.role === 'MDM' || user?.role === 'SUPER_ADMIN';

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['inventory', branchId] });
  }, [qc, branchId]);

  function onSearchChange(val: string) {
    setSearch(val);
    setPage(1);
  }

  function onFilterLow(val: boolean) {
    setFilterLow(val);
    setPage(1);
  }

  async function saveThreshold(row: InventoryRow, rawValue: string) {
    const val = rawValue.trim() === '' ? null : parseInt(rawValue);
    if (val !== null && (isNaN(val) || val < 0)) return;
    setSavingThreshold(true);
    try {
      await api.patch('/inventory/threshold', {
        productId: row.productId,
        branchId: row.branchId,
        lowStockAlert: val,
      });
      invalidate();
    } finally {
      setSavingThreshold(false);
      setEditThreshold(null);
    }
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Inventory</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{total} item{total !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => onFilterLow(!filterLow)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
            filterLow
              ? 'bg-amber-500 text-white'
              : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Low stock only
        </button>
      </div>

      {/* Search bar */}
      <div className="px-4 sm:px-6 py-3 border-b border-border shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name or SKU…"
            className="w-full h-9 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Loading inventory…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-1">
            <SlidersHorizontal className="h-6 w-6" />
            <span>{filterLow ? 'No low-stock items.' : 'No inventory records found.'}</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border sticky top-0">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold">Product</th>
                  <th className="px-4 py-3 text-left font-semibold">Category</th>
                  <th className="px-4 py-3 text-right font-semibold">Stock</th>
                  <th className="px-4 py-3 text-right font-semibold">Value</th>
                  <th className="px-4 py-3 text-right font-semibold">Alert at</th>
                  {canEdit && <th className="px-4 py-3 text-right font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`hover:bg-muted/40 transition-colors ${row.isLowStock ? 'bg-amber-500/5' : ''}`}
                  >
                    {/* Product */}
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        {row.isLowStock && (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        )}
                        <div>
                          <p className="font-medium text-foreground">{row.product.name}</p>
                          {row.product.sku && (
                            <p className="text-xs text-muted-foreground font-mono">SKU: {row.product.sku}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-muted-foreground text-sm">
                      {row.product.category?.name ?? '—'}
                    </td>

                    {/* Stock qty */}
                    <td className="px-4 py-3 text-right">
                      <span className={`font-bold tabular-nums ${row.isLowStock ? 'text-amber-600' : 'text-foreground'}`}>
                        {row.quantity}
                      </span>
                      {row.isLowStock && (
                        <span className="ml-1.5 inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                          LOW
                        </span>
                      )}
                    </td>

                    {/* Inventory value */}
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums text-xs">
                      {row.totalValue != null ? formatPeso(row.totalValue) : '—'}
                    </td>

                    {/* Low-stock threshold */}
                    <td className="px-4 py-3 text-right">
                      {canEdit && editThreshold?.id === row.id ? (
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          value={editThreshold.value}
                          onChange={(e) => setEditThreshold({ id: row.id, value: e.target.value })}
                          onBlur={() => saveThreshold(row, editThreshold.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveThreshold(row, editThreshold.value);
                            if (e.key === 'Escape') setEditThreshold(null);
                          }}
                          disabled={savingThreshold}
                          className="w-20 h-7 rounded border border-[var(--accent)] px-2 text-sm text-right bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                        />
                      ) : (
                        <span
                          onClick={() =>
                            canEdit && setEditThreshold({ id: row.id, value: String(row.lowStockAlert ?? '') })
                          }
                          className={`tabular-nums ${
                            canEdit ? 'cursor-pointer hover:text-[var(--accent)]' : ''
                          } ${row.lowStockAlert == null ? 'text-muted-foreground' : 'text-foreground'}`}
                          title={canEdit ? 'Click to edit threshold' : undefined}
                        >
                          {row.lowStockAlert ?? '—'}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setAdjustTarget(row)}
                          className="text-xs font-medium px-2 py-1 rounded transition-colors hover:opacity-80"
                          style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}
                        >
                          Adjust
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-border shrink-0 bg-background">
          <p className="text-xs text-muted-foreground">
            Page {page} of {pages} · {total} items
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {adjustTarget && (
        <StockAdjustModal
          open={!!adjustTarget}
          productId={adjustTarget.productId}
          productName={adjustTarget.product.name}
          currentQty={adjustTarget.quantity}
          branchId={adjustTarget.branchId}
          onClose={() => setAdjustTarget(null)}
          onSuccess={invalidate}
        />
      )}
    </div>
  );
}
