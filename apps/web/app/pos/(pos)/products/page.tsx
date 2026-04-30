'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, ToggleLeft, ToggleRight, Package, Layers, Warehouse, ChefHat, Trash2, FlaskConical, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { ModifierGroupModal } from '@/components/pos/ModifierGroupModal';
import { useBusinessSetup } from '@/components/portal/BusinessSetupWizard';
import { isFnbType } from '@repo/shared-types';
import { ImportModal } from '@/components/ui/ImportModal';

interface Category { id: string; name: string; }
interface Uom { id: string; name: string; abbreviation: string; isActive: boolean; }
interface Branch { id: string; name: string; }
interface RawMaterial { id: string; name: string; unit: string; costPrice: number | null; }
interface BomItem { rawMaterialId: string; quantity: string; }
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
  inventoryMode?: 'UNIT_BASED' | 'RECIPE_BASED';
  bomItems?: Array<{ rawMaterialId: string; quantity: number; rawMaterial?: { id: string; name: string; unit: string } }>;
  imageUrl?: string | null;
}

const EMPTY_FORM = {
  name: '', sku: '', barcode: '', description: '', categoryId: '',
  price: '', costPrice: '', isVatable: true, unitOfMeasureId: '',
  inventoryMode: 'UNIT_BASED' as 'UNIT_BASED' | 'RECIPE_BASED',
  imageUrl: '',
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

  // Recipe (BOM) state for RECIPE_BASED products
  const [recipe, setRecipe] = useState<BomItem[]>([]);
  const [bomSaving, setBomSaving] = useState(false);

  // Inventory prompt — shown after a new product is created
  const [invPrompt, setInvPrompt] = useState<{ productId: string; productName: string } | null>(null);
  const [invBranchId, setInvBranchId] = useState('');
  const [invQty, setInvQty] = useState('');
  const [invSaving, setInvSaving] = useState(false);

  const isOwner   = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  // MDM (Master Data Manager) and above can create/edit products; deactivation is owner-only
  const canManage = isOwner || user?.role === 'MDM';
  const isReadOnly = !canManage;

  const { data: tenantProfile } = useBusinessSetup(true);
  const isFnb = isFnbType(tenantProfile?.businessType);

  const [modifierTarget, setModifierTarget] = useState<Product | null>(null);
  const [showImport, setShowImport] = useState(false);

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

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/tenant/branches').then((r) => r.data),
    enabled: !!invPrompt,  // only load when inventory prompt is shown
    staleTime: 120_000,
  });

  // Raw materials — only loaded for F&B businesses when modal is open
  const { data: rawMaterials = [] } = useQuery<RawMaterial[]>({
    queryKey: ['raw-materials'],
    queryFn: () => api.get('/inventory/raw-materials').then((r) => r.data),
    enabled: !!user && !!modal && isFnb,
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['products-pos'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setRecipe([]);
    setEditing(null);
    setModal('create');
  }
  async function openEdit(p: Product) {
    setEditing(p);
    setModal('edit');
    setForm({
      name: p.name, sku: p.sku ?? '', barcode: p.barcode ?? '',
      description: p.description ?? '',
      categoryId: p.categoryId ?? '', price: String(Number(p.price)),
      costPrice: p.costPrice != null ? String(Number(p.costPrice)) : '',
      isVatable: p.isVatable,
      unitOfMeasureId: p.unitOfMeasureId ?? '',
      inventoryMode: p.inventoryMode ?? 'UNIT_BASED',
      imageUrl: p.imageUrl ?? '',
    });
    setRecipe([]);

    // For F&B: fetch full product detail to get BOM items
    if (isFnb && p.inventoryMode === 'RECIPE_BASED') {
      try {
        const { data: detail } = await api.get<Product>(`/products/${p.id}`);
        setForm((prev) => ({ ...prev, inventoryMode: detail.inventoryMode ?? 'UNIT_BASED' }));
        setRecipe(
          (detail.bomItems ?? []).map((b) => ({
            rawMaterialId: b.rawMaterialId,
            quantity: String(b.quantity),
          })),
        );
      } catch {
        // non-fatal — recipe section will just be empty
      }
    }
  }

  function addRecipeRow() {
    setRecipe((prev) => [...prev, { rawMaterialId: '', quantity: '' }]);
  }
  function removeRecipeRow(idx: number) {
    setRecipe((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateRecipeRow(idx: number, field: keyof BomItem, value: string) {
    setRecipe((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.price) { toast.error('Name and price are required.'); return; }
    if (form.costPrice === '' || form.costPrice == null) {
      toast.error('Cost Price is required for accurate gross-profit reporting. Enter 0 if intentionally free.');
      return;
    }

    // Validate recipe rows if RECIPE_BASED
    const isRecipeBased = form.inventoryMode === 'RECIPE_BASED';
    const validRecipe = recipe.filter((r) => r.rawMaterialId && r.quantity && parseFloat(r.quantity) > 0);
    if (isRecipeBased && validRecipe.length === 0 && recipe.length > 0) {
      toast.error('Please complete all recipe rows before saving.');
      return;
    }

    setSaving(true);
    try {
      const bomItems = isRecipeBased
        ? validRecipe.map((r) => ({ rawMaterialId: r.rawMaterialId, quantity: parseFloat(r.quantity) }))
        : [];

      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || undefined,
        price: parseFloat(form.price),
        costPrice: parseFloat(form.costPrice),
        isVatable: form.isVatable,
        unitOfMeasureId: form.unitOfMeasureId || undefined,
        inventoryMode: form.inventoryMode,
        imageUrl: form.imageUrl.trim() || undefined,
        // On create: send BOM inline
        ...(modal === 'create' && bomItems.length > 0 ? { bomItems } : {}),
      };

      if (modal === 'create') {
        const { data: created } = await api.post<{ id: string; name: string }>('/products', payload);
        toast.success('Product created.');
        invalidate();
        setModal(null);
        // Offer to add to inventory immediately (only for unit-based products)
        if (!isRecipeBased) {
          setInvPrompt({ productId: created.id, productName: created.name });
          setInvBranchId('');
          setInvQty('');
        }
        return;
      } else if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
        // On edit: replace BOM via dedicated endpoint
        if (isRecipeBased || editing.inventoryMode === 'RECIPE_BASED') {
          setBomSaving(true);
          await api.put(`/products/${editing.id}/bom`, { items: bomItems });
          setBomSaving(false);
        }
        toast.success('Product updated.');
      }
      invalidate();
      setModal(null);
    } catch (err: unknown) {
      setBomSaving(false);
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

  async function handleAddToInventory() {
    if (!invPrompt) return;
    const qty = parseFloat(invQty);
    if (!invBranchId) { toast.error('Please select a branch.'); return; }
    if (!invQty || isNaN(qty) || qty <= 0) { toast.error('Please enter a valid quantity greater than 0.'); return; }
    setInvSaving(true);
    try {
      await api.post('/inventory/adjust', {
        productId: invPrompt.productId,
        branchId:  invBranchId,
        quantity:  qty,
        type:      'INITIAL',
        reason:    'Initial stock — added on product creation',
      });
      toast.success(`${qty} unit(s) added to inventory for "${invPrompt.productName}".`);
      qc.invalidateQueries({ queryKey: ['inventory'] });
      setInvPrompt(null);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message?.toString() ?? 'Failed to add inventory.');
    } finally {
      setInvSaving(false);
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
            <>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 text-xs border border-border bg-background text-foreground hover:bg-muted rounded-lg px-3 py-1.5 font-medium transition-colors whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </button>
              <button
                onClick={openCreate}
                className="flex items-center gap-1.5 text-xs hover:opacity-90 text-white rounded-lg px-3 py-1.5 font-medium transition-colors whitespace-nowrap"
                style={{ background: 'var(--accent)' }}
              >
                <Plus className="h-3.5 w-3.5" />
                New Product
              </button>
            </>
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
                  {['Name', 'SKU', 'Category', 'Price', 'Cost', 'UOM', 'VAT', 'Status', ...(isFnb ? ['Recipe'] : []), ...(isFnb && canManage ? ['Modifiers'] : []), 'Actions'].map((h, i, arr) => (
                    <th
                      key={h}
                      className={`py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${
                        i === 0 ? 'text-left px-6' :
                        i === arr.length - 1 ? 'text-right px-6' :
                        ['Price','Cost'].includes(h) ? 'text-right px-4' :
                        ['VAT','Status','Modifiers','UOM','Recipe'].includes(h) ? 'text-center px-4' :
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
                    {/* Recipe badge (F&B only) */}
                    {isFnb && (
                      <td className="px-4 py-3 text-center">
                        {p.inventoryMode === 'RECIPE_BASED' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                            <FlaskConical className="h-2.5 w-2.5" />
                            Recipe
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Unit</span>
                        )}
                      </td>
                    )}
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

      {/* Inventory Prompt — shown after new product is created */}
      {invPrompt && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-5 border-b border-border flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
                <Warehouse className="h-4 w-4 text-[var(--accent)]" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground text-sm">Add to Inventory?</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Track stock levels for <span className="font-medium text-foreground">{invPrompt.productName}</span>
                </p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                This product was created. Do you want to add it to inventory with an opening stock count?
              </p>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Branch</label>
                <select
                  value={invBranchId}
                  onChange={(e) => setInvBranchId(e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">— Select branch —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Opening Quantity</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={invQty}
                  onChange={(e) => setInvQty(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="e.g. 50"
                  autoFocus
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setInvPrompt(null)}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleAddToInventory}
                disabled={invSaving}
                className="flex-1 hover:opacity-90 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-opacity"
                style={{ background: 'var(--accent)' }}
              >
                {invSaving ? 'Adding…' : 'Add to Inventory'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import Products"
        description="Upload an .xlsx or .csv file to bulk-create or update products."
        templateUrl="/import/template/products"
        uploadUrl="/import/products"
        onSuccess={() => invalidate()}
      />

      {/* Create / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-border shrink-0">
              <h2 className="font-semibold text-foreground">
                {modal === 'create' ? 'New Product' : 'Edit Product'}
              </h2>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
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
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Cost Price (₱) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number" min="0" step="0.01"
                    value={form.costPrice}
                    onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="0.00"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                    Required — used to compute COGS &amp; gross profit on every sale.
                    For recipe items, enter the summed raw-material cost.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Product Image (URL)</label>
                <div className="flex gap-2 items-start">
                  {form.imageUrl ? (
                    <div className="w-16 h-16 rounded-lg border border-border overflow-hidden bg-muted shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={form.imageUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg border border-dashed border-border bg-muted/30 shrink-0 flex items-center justify-center text-[10px] text-muted-foreground text-center px-1">
                      No image
                    </div>
                  )}
                  <div className="flex-1">
                    <input
                      type="url"
                      value={form.imageUrl}
                      onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                      className={INPUT_CLS}
                      placeholder="https://… (paste image URL)"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                      Optional. Paste a public image URL — it appears as a tile on the cashier terminal.
                      Direct file upload coming soon (cloud storage setup pending).
                    </p>
                  </div>
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

              {/* Inventory Mode — F&B only */}
              {isFnb && (
                <>
                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
                        Recipe-based inventory
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Track ingredients instead of finished units
                      </p>
                    </div>
                    <button
                      onClick={() => setForm((f) => ({
                        ...f,
                        inventoryMode: f.inventoryMode === 'RECIPE_BASED' ? 'UNIT_BASED' : 'RECIPE_BASED',
                      }))}
                      className="w-10 h-6 rounded-full transition-colors shrink-0"
                      style={{ background: form.inventoryMode === 'RECIPE_BASED' ? 'var(--accent)' : undefined }}
                    >
                      <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
                        form.inventoryMode === 'RECIPE_BASED' ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>

                  {/* Recipe Editor */}
                  {form.inventoryMode === 'RECIPE_BASED' && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ChefHat className="h-4 w-4 text-[var(--accent)]" />
                          <span className="text-sm font-medium text-foreground">Recipe Ingredients</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                            {recipe.filter((r) => r.rawMaterialId).length} item{recipe.filter((r) => r.rawMaterialId).length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <button
                          onClick={addRecipeRow}
                          className="flex items-center gap-1 text-xs font-medium hover:opacity-80 transition-opacity"
                          style={{ color: 'var(--accent)' }}
                        >
                          <Plus className="h-3 w-3" />
                          Add ingredient
                        </button>
                      </div>

                      {recipe.length === 0 ? (
                        <div className="text-center py-4">
                          <p className="text-xs text-muted-foreground">No ingredients yet.</p>
                          <button
                            onClick={addRecipeRow}
                            className="text-xs mt-1 hover:underline"
                            style={{ color: 'var(--accent)' }}
                          >
                            Add your first ingredient
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {/* Header row */}
                          <div className="grid grid-cols-[1fr_90px_28px] gap-2 px-1">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Ingredient</span>
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Qty</span>
                            <span />
                          </div>
                          {recipe.map((row, idx) => {
                            const mat = rawMaterials.find((m) => m.id === row.rawMaterialId);
                            return (
                              <div key={idx} className="grid grid-cols-[1fr_90px_28px] gap-2 items-center">
                                <select
                                  value={row.rawMaterialId}
                                  onChange={(e) => updateRecipeRow(idx, 'rawMaterialId', e.target.value)}
                                  className={INPUT_CLS + ' text-xs py-1.5'}
                                >
                                  <option value="">— Select ingredient —</option>
                                  {rawMaterials.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                                  ))}
                                </select>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0.0001"
                                    step="0.001"
                                    value={row.quantity}
                                    onChange={(e) => updateRecipeRow(idx, 'quantity', e.target.value)}
                                    className={INPUT_CLS + ' text-xs py-1.5'}
                                    placeholder="0"
                                  />
                                  {mat && (
                                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">{mat.unit}</span>
                                  )}
                                </div>
                                <button
                                  onClick={() => removeRecipeRow(idx)}
                                  className="text-muted-foreground hover:text-red-400 transition-colors flex items-center justify-center"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {rawMaterials.length === 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                          No ingredients found. Go to <strong>Inventory → Ingredients</strong> to add your raw materials first.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-6 pb-5 flex gap-3 shrink-0">
              <button
                onClick={() => setModal(null)}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || bomSaving}
                className="flex-1 hover:opacity-90 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-opacity"
                style={{ background: 'var(--accent)' }}
              >
                {saving || bomSaving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
