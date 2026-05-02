'use client';
import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Search, SlidersHorizontal, ChevronLeft, ChevronRight,
  Plus, Pencil, FlaskConical, Package, Upload,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { StockAdjustModal } from '@/components/pos/StockAdjustModal';
import { ImportModal } from '@/components/ui/ImportModal';
import { useDebounce } from '@/hooks/useDebounce';
import { useBusinessSetup } from '@/components/portal/BusinessSetupWizard';
import { isFnbType } from '@repo/shared-types';
import { toast } from 'sonner';

// ─── Interfaces ──────────────────────────────────────────────────────────────

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

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  costPrice:     number | null;
  lowStockAlert: number | null;
  stockQty:      number | null;  // current stock at the selected branch
  isLowStock:    boolean;
  isActive:      boolean;
}

interface Branch { id: string; name: string; }

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

const UNITS = ['g', 'kg', 'ml', 'L', 'pc', 'pcs', 'oz', 'tsp', 'tbsp', 'cup', 'sachet', 'slice', 'sheet', 'pack'];

// ─── Component ────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? '';
  const qc = useQueryClient();

  const { data: tenantProfile } = useBusinessSetup(true);
  const isFnb = isFnbType(tenantProfile?.businessType);

  // Tab state — only relevant for F&B businesses
  const [activeTab, setActiveTab] = useState<'products' | 'ingredients'>('products');

  // ── Product stock state ────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterLow, setFilterLow] = useState(false);
  const [page, setPage] = useState(1);
  const [adjustTarget, setAdjustTarget] = useState<InventoryRow | null>(null);
  const [editThreshold,    setEditThreshold]    = useState<{ id: string; value: string } | null>(null);
  const [savingThreshold,  setSavingThreshold]  = useState(false);
  const [editMatThreshold, setEditMatThreshold] = useState<{ id: string; value: string } | null>(null);
  const [savingMatThreshold, setSavingMatThreshold] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSetupPack, setShowSetupPack] = useState(false);

  // ── Ingredient state ───────────────────────────────────────────────────────
  const [matModal, setMatModal] = useState<'create' | 'edit' | 'receive' | null>(null);
  const [editingMat, setEditingMat] = useState<RawMaterial | null>(null);
  const [matForm, setMatForm] = useState({ name: '', unit: 'g', costPrice: '', lowStockAlert: '' });
  const [receiveForm, setReceiveForm] = useState({ branchId: '', quantity: '', costPrice: '', note: '' });
  const [matSaving, setMatSaving] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  const canEdit = user?.role === 'BUSINESS_OWNER' || user?.role === 'MDM'
               || user?.role === 'SUPER_ADMIN' || user?.role === 'WAREHOUSE_STAFF';

  // ── Queries ────────────────────────────────────────────────────────────────

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
    enabled: !!branchId && activeTab === 'products',
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: rawMaterials = [], isLoading: matsLoading } = useQuery<RawMaterial[]>({
    queryKey: ['raw-materials', branchId],
    queryFn: () =>
      api.get('/inventory/raw-materials', { params: { branchId } }).then((r) => r.data),
    enabled: isFnb && activeTab === 'ingredients' && !!branchId,
    staleTime: 30_000,
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/tenant/branches').then((r) => r.data),
    enabled: !!matModal && matModal === 'receive',
    staleTime: 120_000,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['inventory', branchId] });
  }, [qc, branchId]);

  function onSearchChange(val: string) { setSearch(val); setPage(1); }
  function onFilterLow(val: boolean)  { setFilterLow(val); setPage(1); }

  // ── Threshold save ─────────────────────────────────────────────────────────

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

  async function saveMatThreshold(mat: RawMaterial, rawValue: string) {
    const val = rawValue.trim() === '' ? null : parseFloat(rawValue);
    if (val !== null && (isNaN(val) || val < 0)) return;
    setSavingMatThreshold(true);
    try {
      await api.patch(`/inventory/raw-materials/${mat.id}`, { lowStockAlert: val });
      qc.invalidateQueries({ queryKey: ['raw-materials', branchId] });
    } catch {
      toast.error('Failed to save alert threshold.');
    } finally {
      setSavingMatThreshold(false);
      setEditMatThreshold(null);
    }
  }

  // ── Ingredient CRUD ────────────────────────────────────────────────────────

  function openCreateMat() {
    setMatForm({ name: '', unit: 'g', costPrice: '', lowStockAlert: '' });
    setEditingMat(null);
    setMatModal('create');
  }

  function openEditMat(m: RawMaterial) {
    setMatForm({
      name:          m.name,
      unit:          m.unit,
      costPrice:     m.costPrice     != null ? String(m.costPrice)     : '',
      lowStockAlert: m.lowStockAlert != null ? String(m.lowStockAlert) : '',
    });
    setEditingMat(m);
    setMatModal('edit');
  }

  function openReceiveMat(m: RawMaterial) {
    setEditingMat(m);
    setReceiveForm({ branchId: '', quantity: '', costPrice: String(m.costPrice ?? ''), note: '' });
    setMatModal('receive');
  }

  async function handleSaveMat() {
    if (!matForm.name.trim()) { toast.error('Name is required.'); return; }
    if (!matForm.unit.trim()) { toast.error('Unit is required.'); return; }
    setMatSaving(true);
    try {
      const payload = {
        name:          matForm.name.trim(),
        unit:          matForm.unit.trim(),
        costPrice:     matForm.costPrice     ? parseFloat(matForm.costPrice)     : undefined,
        lowStockAlert: matForm.lowStockAlert ? parseFloat(matForm.lowStockAlert) : null,
      };
      if (matModal === 'create') {
        await api.post('/inventory/raw-materials', payload);
        toast.success('Ingredient created.');
      } else if (editingMat) {
        await api.patch(`/inventory/raw-materials/${editingMat.id}`, payload);
        toast.success('Ingredient updated.');
      }
      qc.invalidateQueries({ queryKey: ['raw-materials'] });
      setMatModal(null);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save.');
    } finally {
      setMatSaving(false);
    }
  }

  async function handleReceiveMat() {
    if (!editingMat) return;
    if (!receiveForm.branchId) { toast.error('Please select a branch.'); return; }
    const qty = parseFloat(receiveForm.quantity);
    if (!receiveForm.quantity || isNaN(qty) || qty <= 0) { toast.error('Enter a valid quantity.'); return; }
    setMatSaving(true);
    try {
      await api.post(`/inventory/raw-materials/${editingMat.id}/receive`, {
        branchId: receiveForm.branchId,
        quantity: qty,
        costPrice: receiveForm.costPrice ? parseFloat(receiveForm.costPrice) : undefined,
        note: receiveForm.note.trim() || undefined,
      });
      toast.success(`${qty} ${editingMat.unit} of "${editingMat.name}" received.`);
      qc.invalidateQueries({ queryKey: ['raw-materials'] });
      qc.invalidateQueries({ queryKey: ['raw-material-stock'] });
      setMatModal(null);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to receive stock.');
    } finally {
      setMatSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Inventory</h1>
          {activeTab === 'products' && (
            <p className="text-xs text-muted-foreground mt-0.5">{total} item{total !== 1 ? 's' : ''}</p>
          )}
          {activeTab === 'ingredients' && (
            <p className="text-xs text-muted-foreground mt-0.5">{rawMaterials.length} ingredient{rawMaterials.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'products' && (
            <>
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
              {canEdit && (
                <>
                  <button
                    onClick={() => setShowSetupPack(true)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white hover:opacity-90 transition-colors"
                    style={{ background: 'var(--accent)' }}
                    title="One-shot import: products + opening stock in a single workbook"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Setup Pack
                  </button>
                  <button
                    onClick={() => setShowImport(true)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import Stock
                  </button>
                </>
              )}
            </>
          )}
          {activeTab === 'ingredients' && canEdit && (
            <button
              onClick={openCreateMat}
              className="flex items-center gap-1.5 text-xs hover:opacity-90 text-white rounded-lg px-3 py-1.5 font-medium transition-colors"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              New Ingredient
            </button>
          )}
        </div>
      </div>

      {/* Tabs — F&B only */}
      {isFnb && (
        <div className="flex gap-0 border-b border-border px-4 sm:px-6 shrink-0">
          {[
            { key: 'products', label: 'Products', icon: Package },
            { key: 'ingredients', label: 'Ingredients', icon: FlaskConical },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === key
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Products Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'products' && (
        <>
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
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            {row.isLowStock && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                            <div>
                              <p className="font-medium text-foreground">{row.product.name}</p>
                              {row.product.sku && (
                                <p className="text-xs text-muted-foreground font-mono">SKU: {row.product.sku}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-sm">{row.product.category?.name ?? '—'}</td>
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
                        <td className="px-4 py-3 text-right text-muted-foreground tabular-nums text-xs">
                          {row.totalValue != null ? formatPeso(row.totalValue) : '—'}
                        </td>
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
                              onClick={() => canEdit && setEditThreshold({ id: row.id, value: String(row.lowStockAlert ?? '') })}
                              className={`tabular-nums ${canEdit ? 'cursor-pointer hover:text-[var(--accent)]' : ''} ${row.lowStockAlert == null ? 'text-muted-foreground' : 'text-foreground'}`}
                              title={canEdit ? 'Click to edit threshold' : undefined}
                            >
                              {row.lowStockAlert ?? '—'}
                            </span>
                          )}
                        </td>
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
              <p className="text-xs text-muted-foreground">Page {page} of {pages} · {total} items</p>
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
        </>
      )}

      {/* ── Ingredients Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'ingredients' && (
        <div className="flex-1 overflow-auto">
          {matsLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              Loading ingredients…
            </div>
          ) : rawMaterials.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
              <FlaskConical className="h-10 w-10 opacity-30" />
              <p className="text-sm">No ingredients yet.</p>
              {canEdit && (
                <button onClick={openCreateMat} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>
                  Add your first ingredient
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide border-b border-border sticky top-0">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold">Ingredient</th>
                    <th className="px-4 py-3 text-center font-semibold">Unit</th>
                    <th className="px-4 py-3 text-right font-semibold">Stock</th>
                    <th className="px-4 py-3 text-right font-semibold">Alert at</th>
                    <th className="px-4 py-3 text-right font-semibold">Cost / Unit</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    {canEdit && <th className="px-4 py-3 text-right font-semibold">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rawMaterials.map((m) => (
                    <tr
                      key={m.id}
                      className={`hover:bg-muted/40 transition-colors ${!m.isActive ? 'opacity-50' : ''}`}
                    >
                      {/* Name + low-stock badge */}
                      <td className="px-6 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {m.name}
                          {m.isLowStock && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              Low
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Unit */}
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">{m.unit}</span>
                      </td>

                      {/* Current stock */}
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                        m.isLowStock ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
                      }`}>
                        {m.stockQty != null
                          ? `${m.stockQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${m.unit}`
                          : <span className="text-muted-foreground font-normal">—</span>
                        }
                      </td>

                      {/* Low-stock alert threshold (inline edit) */}
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {canEdit && editMatThreshold?.id === m.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              autoFocus
                              value={editMatThreshold.value}
                              onChange={(e) => setEditMatThreshold({ id: m.id, value: e.target.value })}
                              onBlur={() => saveMatThreshold(m, editMatThreshold.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter')  saveMatThreshold(m, editMatThreshold.value);
                                if (e.key === 'Escape') setEditMatThreshold(null);
                              }}
                              disabled={savingMatThreshold}
                              className="w-20 text-right border border-[var(--accent)] bg-background rounded px-2 py-0.5 text-xs text-foreground focus:outline-none"
                            />
                            <span className="text-xs text-muted-foreground">{m.unit}</span>
                          </div>
                        ) : (
                          <span
                            className={`cursor-pointer hover:text-foreground transition-colors ${canEdit ? 'hover:underline underline-offset-2' : ''}`}
                            title={canEdit ? 'Click to set low-stock alert' : undefined}
                            onClick={() => canEdit && setEditMatThreshold({ id: m.id, value: m.lowStockAlert != null ? String(m.lowStockAlert) : '' })}
                          >
                            {m.lowStockAlert != null
                              ? `${m.lowStockAlert} ${m.unit}`
                              : <span className="text-muted-foreground/50">—</span>
                            }
                          </span>
                        )}
                      </td>

                      {/* Cost / unit */}
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums text-sm">
                        {m.costPrice != null ? `₱${m.costPrice.toFixed(4)}/${m.unit}` : '—'}
                      </td>

                      {/* Active badge */}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          m.isActive
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'bg-red-500/10 text-red-500'
                        }`}>
                          {m.isActive ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </td>

                      {/* Actions */}
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openReceiveMat(m)}
                              className="text-xs font-medium px-2 py-1 rounded transition-colors hover:opacity-80"
                              style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}
                            >
                              Receive stock
                            </button>
                            <button
                              onClick={() => openEditMat(m)}
                              className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Ingredient Create/Edit Modal ─────────────────────────────────────── */}
      {(matModal === 'create' || matModal === 'edit') && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">
                {matModal === 'create' ? 'New Ingredient' : 'Edit Ingredient'}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Ingredient name <span className="text-red-400">*</span>
                </label>
                <input
                  value={matForm.name}
                  onChange={(e) => setMatForm((f) => ({ ...f, name: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder="e.g. Espresso Beans"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Unit <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={matForm.unit}
                    onChange={(e) => setMatForm((f) => ({ ...f, unit: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Cost / unit (₱)</label>
                  <input
                    type="number" min="0" step="0.0001"
                    value={matForm.costPrice}
                    onChange={(e) => setMatForm((f) => ({ ...f, costPrice: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="0.0000"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Low-stock alert (in {matForm.unit || 'units'})
                </label>
                <input
                  type="number" min="0" step="any"
                  value={matForm.lowStockAlert}
                  onChange={(e) => setMatForm((f) => ({ ...f, lowStockAlert: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder="e.g. 500"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  The ingredient row turns amber and shows a ⚠ badge when stock falls below this number. Leave blank to disable.
                </p>
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setMatModal(null)}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMat}
                disabled={matSaving}
                className="flex-1 hover:opacity-90 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-opacity"
                style={{ background: 'var(--accent)' }}
              >
                {matSaving ? 'Saving…' : matModal === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Receive Stock Modal ───────────────────────────────────────────────── */}
      {matModal === 'receive' && editingMat && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Receive Stock</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Adding stock for <span className="font-medium text-foreground">{editingMat.name}</span>
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Branch</label>
                <select
                  value={receiveForm.branchId}
                  onChange={(e) => setReceiveForm((f) => ({ ...f, branchId: e.target.value }))}
                  className={INPUT_CLS}
                >
                  <option value="">— Select branch —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Quantity ({editingMat.unit}) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number" min="0.001" step="0.001"
                    value={receiveForm.quantity}
                    onChange={(e) => setReceiveForm((f) => ({ ...f, quantity: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="e.g. 1000"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Cost / unit (₱)</label>
                  <input
                    type="number" min="0" step="0.0001"
                    value={receiveForm.costPrice}
                    onChange={(e) => setReceiveForm((f) => ({ ...f, costPrice: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="Updates WAC"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Note (optional)</label>
                <input
                  value={receiveForm.note}
                  onChange={(e) => setReceiveForm((f) => ({ ...f, note: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder="e.g. Supplier delivery — Jan batch"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Entering a cost per unit will update the Weighted Average Cost for COGS calculation.
              </p>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setMatModal(null)}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReceiveMat}
                disabled={matSaving}
                className="flex-1 hover:opacity-90 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-opacity"
                style={{ background: 'var(--accent)' }}
              >
                {matSaving ? 'Adding…' : 'Receive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjust Modal */}
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

      {/* Inventory Import Modal */}
      <ImportModal
        open={showImport}
        title="Import Inventory"
        description="Upload a spreadsheet to set stock quantities and low-stock alert thresholds in bulk."
        templateUrl="/api/v1/import/template/inventory"
        uploadUrl="/import/inventory"
        extraParams={branchId ? { branchId } : undefined}
        onClose={() => setShowImport(false)}
        onSuccess={() => {
          invalidate();
          setShowImport(false);
        }}
      />

      {/* Setup Pack — combined products + inventory import */}
      <ImportModal
        open={showSetupPack}
        title="Setup Pack — Products + Opening Stock"
        description="One workbook, two sheets. Stand up your full catalog and starting inventory in a single upload. Download the template, fill both sheets, then upload here. Products are created/updated first; inventory quantities are then set for the current branch."
        templateUrl="/api/v1/import/template/setup-pack"
        uploadUrl="/import/setup-pack"
        extraParams={branchId ? { branchId } : undefined}
        onClose={() => setShowSetupPack(false)}
        onSuccess={() => {
          invalidate();
          setShowSetupPack(false);
        }}
      />
    </div>
  );
}
