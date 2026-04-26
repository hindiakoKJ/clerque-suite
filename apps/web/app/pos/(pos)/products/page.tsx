'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, ToggleLeft, ToggleRight, Package, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { ModifierGroupModal } from '@/components/pos/ModifierGroupModal';
import { useBusinessSetup } from '@/components/portal/BusinessSetupWizard';

interface Category { id: string; name: string; }
interface Uom { id: string; name: string; abbreviation: string; isActive: boolean; }
interface Product {
  id: string;
  name: string;
  sku?: string;
  barcode?: string | null;
  price: number | string;
  costPrice?: number | string | null;
  categoryId?: string;
  category?: Category | null;
  unitOfMeasureId?: string | null;
  unitOfMeasure?: Uom | null;
  isVatable: boolean;
  isActive: boolean;
  description?: string;
}

const EMPTY_FORM = {
  name: '', sku: '', barcode: '', description: '', categoryId: '',
  price: '', costPrice: '', isVatable: true, unitOfMeasureId: '',
};

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

export default function ProductsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const isOwner   = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  // MDM (Master Data Manager) and above can create/edit products; deactivation is owner-only
  const canManage = isOwner || user?.role === 'MDM';
  const isReadOnly = !canManage;

  const { data: tenantProfile } = useBusinessSetup(true);
  const isFnb = tenantProfile?.businessType === 'COFFEE_SHOP';

  const [modifierTarget, setModifierTarget] = useState<Product | null>(null);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products', showInactive],
    queryFn: () =>
      api.get(`/products?includeInactive=${showInactive}`).then((r) => r.data),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => api.get('/categories').then((r) => r.data),
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: uoms = [] } = useQuery<Uom[]>({
    queryKey: ['uoms'],
    queryFn: () => api.get('/uom').then((r) => r.data),
    enabled: !!user && !!modal,  // only load when form is open
    staleTime: 120_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['products-pos'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };

  function openCreate() { setForm({ ...EMPTY_FORM }); setEditing(null); setModal('create'); }
  function openEdit(p: Product) {
    setForm({
      name: p.name, sku: p.sku ?? '', barcode: p.barcode ?? '',
      description: p.description ?? '',
      categoryId: p.categoryId ?? '', price: String(Number(p.price)),
      costPrice: p.costPrice != null ? String(Number(p.costPrice)) : '',
      isVatable: p.isVatable,
      unitOfMeasureId: p.unitOfMeasureId ?? '',
    });
    setEditing(p);
    setModal('edit');
  }

  async function handleSave() {
    if (!form.name.trim() || !form.price) { toast.error('Name and price are required.'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || undefined,
        price: parseFloat(form.price),
        costPrice: form.costPrice ? parseFloat(form.costPrice) : undefined,
        isVatable: form.isVatable,
        unitOfMeasureId: form.unitOfMeasureId || undefined,
      };
      if (modal === 'create') {
        await api.post('/products', payload);
        toast.success('Product created.');
      } else if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
        toast.success('Product updated.');
      }
      invalidate();
      setModal(null);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save product.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(p: Product) {
    if (!isOwner) return;
    try {
      if (p.isActive) {
        await api.delete(`/products/${p.id}`);
        toast.success(`"${p.name}" deactivated.`);
      } else {
        await api.patch(`/products/${p.id}`, { isActive: true });
        toast.success(`"${p.name}" reactivated.`);
      }
      invalidate();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to update product.');
    }
  }

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.sku ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col h-full bg-muted/30 overflow-auto">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-4 bg-background border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">Products</h1>
          {isReadOnly && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
              Read-Only
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or SKU…"
              className="pl-8 pr-3 py-1.5 text-sm border border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent w-full sm:w-52 transition-shadow"
            />
          </div>
          {isOwner && (
            <button
              onClick={() => setShowInactive((v) => !v)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                showInactive
                  ? 'bg-muted border-border text-foreground'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {showInactive ? 'All (incl. inactive)' : 'Active only'}
            </button>
          )}
          {canManage && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 text-xs hover:opacity-90 text-white rounded-lg px-3 py-1.5 font-medium transition-colors whitespace-nowrap"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              New Product
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Package className="h-10 w-10 opacity-30" />
          <p className="text-sm">No products found.</p>
          {canManage && (
            <button onClick={openCreate} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>
              Add your first product
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr>
                  {['Name', 'SKU', 'Category', 'Price', 'Cost', 'UOM', 'VAT', 'Status', ...(isFnb && canManage ? ['Modifiers'] : []), 'Actions'].map((h, i, arr) => (
                    <th
                      key={h}
                      className={`py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${
                        i === 0 ? 'text-left px-6' :
                        i === arr.length - 1 ? 'text-right px-6' :
                        ['Price','Cost'].includes(h) ? 'text-right px-4' :
                        ['VAT','Status','Modifiers','UOM'].includes(h) ? 'text-center px-4' :
                        'text-left px-4'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className={`hover:bg-muted/40 transition-colors ${!p.isActive ? 'opacity-50' : ''}`}
                  >
                    <td className="px-6 py-3 font-medium text-foreground">{p.name}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{p.category?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">
                      {formatPeso(Number(p.price))}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {p.costPrice != null ? formatPeso(Number(p.costPrice)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-muted-foreground font-mono">
                      {p.unitOfMeasure?.abbreviation ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        p.isVatable ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-muted text-muted-foreground'
                      }`}>
                        {p.isVatable ? 'VAT' : 'EXEMPT'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        p.isActive
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'bg-red-500/10 text-red-500'
                      }`}>
                        {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    {/* Modifiers (F&B only) */}
                    {isFnb && canManage && (
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setModifierTarget(p)}
                          className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
                          title="Manage modifier groups"
                        >
                          <Layers className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}

                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canManage && (
                          <button
                            onClick={() => openEdit(p)}
                            className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {isOwner && (
                          <button
                            onClick={() => handleToggleActive(p)}
                            className={`transition-colors ${
                              p.isActive
                                ? 'text-green-500 hover:text-red-400'
                                : 'text-muted-foreground hover:text-green-500'
                            }`}
                            title={p.isActive ? 'Deactivate' : 'Reactivate'}
                          >
                            {p.isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modifier Group Modal */}
      {modifierTarget && (
        <ModifierGroupModal
          productId={modifierTarget.id}
          productName={modifierTarget.name}
          onClose={() => setModifierTarget(null)}
        />
      )}

      {/* Create / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">
                {modal === 'create' ? 'New Product' : 'Edit Product'}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder="e.g. Brewed Coffee"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">SKU</label>
                  <input
                    value={form.sku}
                    onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
                  <select
                    value={form.categoryId}
                    onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    <option value="">— None —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Barcode (EAN/UPC)</label>
                  <input
                    value={form.barcode}
                    onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Unit of Measure</label>
                  <select
                    value={form.unitOfMeasureId}
                    onChange={(e) => setForm((f) => ({ ...f, unitOfMeasureId: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    <option value="">— None —</option>
                    {uoms.filter((u) => u.isActive).map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Selling Price (₱) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number" min="0" step="0.01"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Cost Price (₱)</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={form.costPrice}
                    onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className={`${INPUT_CLS} resize-none`}
                  placeholder="Optional"
                />
              </div>

              {/* VAT toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">VAT-able (12%)</p>
                  <p className="text-xs text-muted-foreground">Enable if this product is subject to VAT</p>
                </div>
                <button
                  onClick={() => setForm((f) => ({ ...f, isVatable: !f.isVatable }))}
                  className="w-10 h-6 rounded-full transition-colors"
                  style={{ background: form.isVatable ? 'var(--accent)' : undefined }}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
                    form.isVatable ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>

            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setModal(null)}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 hover:opacity-90 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-opacity"
                style={{ background: 'var(--accent)' }}
              >
                {saving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
