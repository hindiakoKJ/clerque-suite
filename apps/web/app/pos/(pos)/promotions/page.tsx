'use client';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Tag,
  CheckSquare,
  Square,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Promotion {
  id: string;
  name: string;
  discountPercent: number | null;
  fixedPrice: number | null;
  appliesToAll: boolean;
  isStackable: boolean;
  startDate: string | null;
  endDate: string | null;
  activeDays: number[];
  activeHoursStart: string | null;
  activeHoursEnd: string | null;
  isActive: boolean;
  productCount?: number;
  productIds?: string[];
}

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  price: number;
}

type DiscountType = 'percent' | 'fixed';

// ─── Constants ───────────────────────────────────────────────────────────────

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

const EMPTY_FORM = {
  name: '',
  discountType: 'percent' as DiscountType,
  discountPercent: '',
  fixedPrice: '',
  appliesToAll: true,
  isStackable: false,
  startDate: '',
  endDate: '',
  activeDays: [] as number[],
  activeHoursStart: '',
  activeHoursEnd: '',
  isActive: true,
  productIds: [] as string[],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSchedule(promo: Promotion): string {
  const parts: string[] = [];

  if (promo.startDate || promo.endDate) {
    const start = promo.startDate
      ? new Date(promo.startDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Always';
    const end = promo.endDate
      ? new Date(promo.endDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'No end';
    parts.push(`${start} – ${end}`);
  }

  if (promo.activeDays.length > 0) {
    parts.push(promo.activeDays.map((d) => DAY_LABELS[d]).join(' '));
  }

  if (promo.activeHoursStart && promo.activeHoursEnd) {
    parts.push(`${promo.activeHoursStart}–${promo.activeHoursEnd}`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Always active';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalFooter({
  onCancel,
  onSave,
  saving,
  saveLabel,
}: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
}) {
  return (
    <div className="px-6 pb-5 flex gap-3">
      <button
        onClick={onCancel}
        className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        className="flex-1 hover:opacity-90 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-opacity"
        style={{ background: 'var(--accent)' }}
      >
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PromotionsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const canManage =
    user?.role === 'BUSINESS_OWNER' ||
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'MDM';

  const canDelete =
    user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';

  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'create' | 'edit' | 'delete' | null>(null);
  const [editTarget, setEditTarget] = useState<Promotion | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: promotions = [], isLoading } = useQuery<Promotion[]>({
    queryKey: ['promotions'],
    queryFn: () => api.get('/promotions').then((r) => r.data),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: allProducts = [] } = useQuery<ProductOption[]>({
    queryKey: ['products-pos'],
    queryFn: () =>
      api
        .get('/products/pos', {
          params: { branchId: user?.branchId ?? '' },
        })
        .then((r) => r.data),
    enabled: !!user && (modal === 'create' || modal === 'edit'),
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['promotions'] });

  // ─── Delete mutation ───────────────────────────────────────────────────────

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/promotions/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Promotion deactivated.');
      invalidate();
      setModal(null);
    },
    onError: (err: unknown) => {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Failed to deactivate promotion.',
      );
    },
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setProductSearch('');
    setModal('create');
  }

  function openEdit(promo: Promotion) {
    setEditTarget(promo);
    setForm({
      name: promo.name,
      discountType: promo.discountPercent !== null ? 'percent' : 'fixed',
      discountPercent: promo.discountPercent !== null ? String(promo.discountPercent) : '',
      fixedPrice: promo.fixedPrice !== null ? String(promo.fixedPrice) : '',
      appliesToAll: promo.appliesToAll,
      isStackable: promo.isStackable,
      startDate: promo.startDate ? promo.startDate.slice(0, 10) : '',
      endDate: promo.endDate ? promo.endDate.slice(0, 10) : '',
      activeDays: [...promo.activeDays],
      activeHoursStart: promo.activeHoursStart ?? '',
      activeHoursEnd: promo.activeHoursEnd ?? '',
      isActive: promo.isActive,
      productIds: promo.productIds ? [...promo.productIds] : [],
    });
    setProductSearch('');
    setModal('edit');
  }

  function openDelete(promo: Promotion) {
    setEditTarget(promo);
    setModal('delete');
  }

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      activeDays: f.activeDays.includes(day)
        ? f.activeDays.filter((d) => d !== day)
        : [...f.activeDays, day],
    }));
  }

  function toggleProduct(id: string) {
    setForm((f) => ({
      ...f,
      productIds: f.productIds.includes(id)
        ? f.productIds.filter((p) => p !== id)
        : [...f.productIds, id],
    }));
  }

  function buildPayload() {
    return {
      name: form.name.trim(),
      discountPercent:
        form.discountType === 'percent' && form.discountPercent !== ''
          ? parseFloat(form.discountPercent)
          : null,
      fixedPrice:
        form.discountType === 'fixed' && form.fixedPrice !== ''
          ? parseFloat(form.fixedPrice)
          : null,
      appliesToAll: form.appliesToAll,
      isStackable: form.isStackable,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      activeDays: form.activeDays,
      activeHoursStart: form.activeHoursStart || undefined,
      activeHoursEnd: form.activeHoursEnd || undefined,
      isActive: form.isActive,
      productIds: form.appliesToAll ? [] : form.productIds,
    };
  }

  async function handleCreate() {
    if (!form.name.trim()) {
      toast.error('Promotion name is required.');
      return;
    }
    if (form.discountType === 'percent' && !form.discountPercent) {
      toast.error('Discount percent is required.');
      return;
    }
    if (form.discountType === 'fixed' && !form.fixedPrice) {
      toast.error('Fixed price is required.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/promotions', buildPayload());
      toast.success('Promotion created.');
      invalidate();
      setModal(null);
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Failed to create promotion.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!editTarget) return;
    if (!form.name.trim()) {
      toast.error('Promotion name is required.');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/promotions/${editTarget.id}`, buildPayload());
      toast.success('Promotion updated.');
      invalidate();
      setModal(null);
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Failed to update promotion.',
      );
    } finally {
      setSaving(false);
    }
  }

  // ─── Filtered list ─────────────────────────────────────────────────────────

  const filtered = promotions.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredProducts = useMemo(
    () =>
      allProducts.filter(
        (p) =>
          p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
          p.sku.toLowerCase().includes(productSearch.toLowerCase()),
      ),
    [allProducts, productSearch],
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Promotions</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search promotions…"
              className="pl-8 pr-3 py-1.5 text-sm border border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent w-full sm:w-52 transition-shadow"
            />
          </div>
          {canManage && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 text-xs hover:opacity-90 text-white rounded-lg px-3 py-1.5 font-medium transition-opacity whitespace-nowrap"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              New Promotion
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
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Tag className="h-10 w-10 opacity-30" />
          <p className="text-sm">No promotions found.</p>
          {canManage && (
            <button
              onClick={openCreate}
              className="text-xs hover:underline mt-1"
              style={{ color: 'var(--accent)' }}
            >
              Create your first promotion
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Discount
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Applies To
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Schedule
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Status
                  </th>
                  {(canManage || canDelete) && (
                    <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((promo) => (
                  <tr
                    key={promo.id}
                    className={`hover:bg-muted/40 transition-colors ${!promo.isActive ? 'opacity-50' : ''}`}
                  >
                    <td className="px-6 py-3 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        {promo.name}
                        {promo.isStackable && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                            STACKABLE
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {promo.discountPercent !== null ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {promo.discountPercent}% off
                        </span>
                      ) : promo.fixedPrice !== null ? (
                        <span className="font-semibold text-purple-600 dark:text-purple-400">
                          {formatPeso(promo.fixedPrice)} fixed
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {promo.appliesToAll ? (
                        <span className="px-2 py-0.5 rounded-full bg-muted text-foreground font-medium">
                          All products
                        </span>
                      ) : (
                        <span>
                          {promo.productCount ?? 0} product{(promo.productCount ?? 0) !== 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px]">
                      <span className="truncate block">{formatSchedule(promo)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          promo.isActive
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-red-500/10 text-red-500'
                        }`}
                      >
                        {promo.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    {(canManage || canDelete) && (
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {canManage && (
                            <button
                              onClick={() => openEdit(promo)}
                              className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDelete && promo.isActive && (
                            <button
                              onClick={() => openDelete(promo)}
                              className="text-muted-foreground hover:text-red-500 transition-colors"
                              title="Deactivate"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit modal */}
      {(modal === 'create' || modal === 'edit') && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">
                {modal === 'create' ? 'New Promotion' : `Edit — ${editTarget?.name}`}
              </h2>
            </div>
            <div className="p-6 space-y-4">

              {/* Name */}
              <FormField label="Name *">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder="e.g. Weekend Flash Sale"
                />
              </FormField>

              {/* Discount type */}
              <FormField label="Discount Type">
                <div className="flex gap-4">
                  {(['percent', 'fixed'] as DiscountType[]).map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                      <input
                        type="radio"
                        name="discountType"
                        value={type}
                        checked={form.discountType === type}
                        onChange={() => setForm((f) => ({ ...f, discountType: type }))}
                        className="accent-[var(--accent)]"
                      />
                      {type === 'percent' ? 'Percentage' : 'Fixed Price'}
                    </label>
                  ))}
                </div>
              </FormField>

              {/* Discount value */}
              {form.discountType === 'percent' ? (
                <FormField label="Discount Percent *">
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={form.discountPercent}
                      onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))}
                      className={INPUT_CLS}
                      placeholder="e.g. 10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                </FormField>
              ) : (
                <FormField label="Fixed Price (₱) *">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₱</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.fixedPrice}
                      onChange={(e) => setForm((f) => ({ ...f, fixedPrice: e.target.value }))}
                      className={`${INPUT_CLS} pl-7`}
                      placeholder="0.00"
                    />
                  </div>
                </FormField>
              )}

              {/* Applies to */}
              <FormField label="Applies To">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                    <input
                      type="radio"
                      name="appliesToAll"
                      checked={form.appliesToAll}
                      onChange={() => setForm((f) => ({ ...f, appliesToAll: true }))}
                      className="accent-[var(--accent)]"
                    />
                    All products
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                    <input
                      type="radio"
                      name="appliesToAll"
                      checked={!form.appliesToAll}
                      onChange={() => setForm((f) => ({ ...f, appliesToAll: false }))}
                      className="accent-[var(--accent)]"
                    />
                    Specific products
                  </label>
                </div>
              </FormField>

              {/* Product multi-select */}
              {!form.appliesToAll && (
                <FormField label={`Select Products (${form.productIds.length} selected)`}>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="p-2 border-b border-border">
                      <input
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Search products…"
                        className="w-full text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y divide-border">
                      {filteredProducts.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-3 py-2">No products found.</p>
                      ) : (
                        filteredProducts.map((p) => {
                          const selected = form.productIds.includes(p.id);
                          return (
                            <button
                              key={p.id}
                              onClick={() => toggleProduct(p.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                            >
                              {selected ? (
                                <CheckSquare className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} />
                              ) : (
                                <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-foreground truncate">{p.name}</p>
                                <p className="text-[10px] text-muted-foreground">{p.sku}</p>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {formatPeso(p.price)}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </FormField>
              )}

              {/* Stackable */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Stackable</p>
                  <p className="text-xs text-muted-foreground">Can combine with other promotions</p>
                </div>
                <button
                  onClick={() => setForm((f) => ({ ...f, isStackable: !f.isStackable }))}
                  className="w-10 h-6 rounded-full transition-colors border border-border relative"
                  style={{ background: form.isStackable ? 'var(--accent)' : undefined }}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
                      form.isStackable ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Start Date">
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </FormField>
                <FormField label="End Date">
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </FormField>
              </div>

              {/* Active days */}
              <FormField label="Active Days (leave empty = every day)">
                <div className="flex gap-1.5 flex-wrap">
                  {DAY_LABELS.map((label, idx) => {
                    const active = form.activeDays.includes(idx);
                    return (
                      <button
                        key={idx}
                        onClick={() => toggleDay(idx)}
                        className={`w-9 h-9 rounded-lg text-xs font-semibold border transition-colors ${
                          active
                            ? 'text-white border-transparent'
                            : 'border-border text-muted-foreground hover:border-[var(--accent)] hover:text-foreground'
                        }`}
                        style={active ? { background: 'var(--accent)' } : undefined}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </FormField>

              {/* Active hours */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Hours From (HH:MM)">
                  <input
                    type="time"
                    value={form.activeHoursStart}
                    onChange={(e) => setForm((f) => ({ ...f, activeHoursStart: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </FormField>
                <FormField label="Hours To (HH:MM)">
                  <input
                    type="time"
                    value={form.activeHoursEnd}
                    onChange={(e) => setForm((f) => ({ ...f, activeHoursEnd: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </FormField>
              </div>

              {/* isActive toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Active</p>
                  <p className="text-xs text-muted-foreground">Inactive promotions are not applied at checkout</p>
                </div>
                <button
                  onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                  className="w-10 h-6 rounded-full transition-colors border border-border relative"
                  style={{ background: form.isActive ? 'var(--accent)' : undefined }}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
                      form.isActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <ModalFooter
              onCancel={() => setModal(null)}
              onSave={modal === 'create' ? handleCreate : handleEdit}
              saving={saving}
              saveLabel={modal === 'create' ? 'Create Promotion' : 'Save Changes'}
            />
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {modal === 'delete' && editTarget && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Deactivate Promotion</h2>
            </div>
            <div className="p-6 space-y-3">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-600 dark:text-amber-400">
                This will deactivate <strong>{editTarget.name}</strong>. It will no longer be applied at checkout.
                You can reactivate it later by editing.
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
                onClick={() => deleteMut.mutate(editTarget.id)}
                disabled={deleteMut.isPending}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-colors"
              >
                {deleteMut.isPending ? 'Deactivating…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
