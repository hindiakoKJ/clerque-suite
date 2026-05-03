'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Plus, Pencil, FlaskConical,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useBusinessSetup } from '@/components/portal/BusinessSetupWizard';
import { isFnbType } from '@repo/shared-types';
import { toast } from 'sonner';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  costPrice:     number | null;
  lowStockAlert: number | null;
  stockQty:      number | null;
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

  // Filter for low stock only
  const [filterLow, setFilterLow] = useState(false);

  // Modal state
  const [matModal,   setMatModal]   = useState<'create' | 'edit' | 'receive' | null>(null);
  const [editingMat, setEditingMat] = useState<RawMaterial | null>(null);
  const [matForm,    setMatForm]    = useState({ name: '', unit: 'g', costPrice: '', lowStockAlert: '' });
  const [receiveForm,setReceiveForm]= useState({ branchId: '', quantity: '', costPrice: '', note: '' });
  const [matSaving,  setMatSaving]  = useState(false);

  // Inline edit threshold state
  const [editMatThreshold,    setEditMatThreshold]    = useState<{ id: string; value: string } | null>(null);
  const [savingMatThreshold,  setSavingMatThreshold]  = useState(false);

  const canEdit = user?.role === 'BUSINESS_OWNER' || user?.role === 'MDM'
               || user?.role === 'SUPER_ADMIN' || user?.role === 'WAREHOUSE_STAFF';

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: rawMaterials = [], isLoading: matsLoading } = useQuery<RawMaterial[]>({
    queryKey: ['raw-materials', branchId],
    queryFn: () =>
      api.get('/inventory/raw-materials', { params: { branchId } }).then((r) => r.data),
    enabled: !!branchId,
    staleTime: 30_000,
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/tenant/branches').then((r) => r.data),
    enabled: !!matModal && matModal === 'receive',
    staleTime: 120_000,
  });

  // Filter the displayed list when "Low only" is on
  const displayed = filterLow ? rawMaterials.filter((m) => m.isLowStock) : rawMaterials;

  // ── Threshold inline save ─────────────────────────────────────────────────

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
      qc.invalidateQueries({ queryKey: ['raw-materials', branchId] });
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
      qc.invalidateQueries({ queryKey: ['raw-materials', branchId] });
      setMatModal(null);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to receive stock.');
    } finally {
      setMatSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  // For non-F&B businesses, ingredients aren't relevant — show a friendly hint.
  if (!isFnb) {
    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground">Ingredients & Supplies</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <FlaskConical className="h-12 w-12 mx-auto opacity-30 text-muted-foreground mb-3" />
            <h2 className="text-base font-semibold text-foreground mb-2">Not used for your business type</h2>
            <p className="text-sm text-muted-foreground">
              Ingredients tracking is for food &amp; beverage businesses (cafés, restaurants, bakeries) where
              finished products are made from raw materials. For retail and service businesses, manage stock
              directly under <span className="font-medium text-foreground">Products</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Ingredients &amp; Supplies</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {rawMaterials.length} ingredient{rawMaterials.length !== 1 ? 's' : ''}
            {filterLow && rawMaterials.filter((m) => m.isLowStock).length > 0 && ` · ${rawMaterials.filter((m) => m.isLowStock).length} low`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterLow(!filterLow)}
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

      {/* Helper note */}
      <div className="px-4 sm:px-6 py-2.5 bg-muted/30 border-b border-border text-xs text-muted-foreground shrink-0">
        Track raw materials, supplies and ingredients here. Finished menu items are managed under{' '}
        <span className="font-medium text-foreground">Products</span>.
      </div>

      {/* Ingredients table */}
      <div className="flex-1 overflow-auto">
        {matsLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Loading ingredients…
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
            <FlaskConical className="h-10 w-10 opacity-30" />
            <p className="text-sm">{filterLow ? 'No ingredients are low on stock.' : 'No ingredients yet.'}</p>
            {canEdit && !filterLow && (
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
                {displayed.map((m) => (
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
                  The ingredient row turns amber when stock falls below this number. Leave blank to disable.
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
    </div>
  );
}
