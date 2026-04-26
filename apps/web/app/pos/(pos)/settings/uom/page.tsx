'use client';
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, Pencil, ToggleLeft, ToggleRight, Ruler, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';

interface Uom {
  id:               string;
  name:             string;
  abbreviation:     string;
  baseUnit?:        string | null;
  conversionFactor?: string | number | null;
  isActive:         boolean;
}

const EMPTY_FORM = { name: '', abbreviation: '', baseUnit: '', conversionFactor: '' };

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

export default function UomPage() {
  const user = useAuthStore((s) => s.user);
  const qc   = useQueryClient();

  const isOwner   = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  const canManage = isOwner || user?.role === 'MDM';

  const [modal,   setModal]   = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Uom | null>(null);
  const [form,    setForm]    = useState({ ...EMPTY_FORM });
  const [saving,  setSaving]  = useState(false);

  // ── Data ─────────────────────────────────────────────────────────────────────
  const { data: uoms = [], isLoading } = useQuery<Uom[]>({
    queryKey: ['uoms'],
    queryFn:  () => api.get('/uom').then((r) => r.data),
    enabled:  !!user,
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['uoms'] });

  // ── Deactivate toggle ─────────────────────────────────────────────────────────
  const toggleMut = useMutation({
    mutationFn: async (u: Uom) => {
      if (u.isActive) {
        return api.delete(`/uom/${u.id}`).then((r) => r.data);
      } else {
        return api.patch(`/uom/${u.id}`, { isActive: true }).then((r) => r.data);
      }
    },
    onSuccess: (_data, u) => {
      toast.success(`"${u.name}" ${u.isActive ? 'deactivated' : 'reactivated'}.`);
      invalidate();
    },
    onError: (err: unknown) => {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to update unit.',
      );
    },
  });

  // ── Modal helpers ─────────────────────────────────────────────────────────────
  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setEditing(null);
    setModal('create');
  }

  function openEdit(u: Uom) {
    setForm({
      name:             u.name,
      abbreviation:     u.abbreviation,
      baseUnit:         u.baseUnit         ?? '',
      conversionFactor: u.conversionFactor != null ? String(u.conversionFactor) : '',
    });
    setEditing(u);
    setModal('edit');
  }

  async function handleSave() {
    if (!form.name.trim())         { toast.error('Name is required.');         return; }
    if (!form.abbreviation.trim()) { toast.error('Abbreviation is required.');  return; }
    setSaving(true);
    try {
      const payload = {
        name:             form.name.trim(),
        abbreviation:     form.abbreviation.trim(),
        baseUnit:         form.baseUnit.trim()         || undefined,
        conversionFactor: form.conversionFactor.trim() ? Number(form.conversionFactor) : undefined,
      };
      if (modal === 'create') {
        await api.post('/uom', payload);
        toast.success(`Unit "${payload.name}" added.`);
      } else if (editing) {
        await api.patch(`/uom/${editing.id}`, payload);
        toast.success(`Unit "${payload.name}" updated.`);
      }
      invalidate();
      setModal(null);
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to save unit.',
      );
    } finally {
      setSaving(false);
    }
  }

  const active   = uoms.filter((u) => u.isActive);
  const inactive = uoms.filter((u) => !u.isActive);

  return (
    <div className="flex flex-col h-full bg-muted/30 overflow-auto">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-4 bg-background border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Units of Measure</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Assign units to products so inventory quantities are unambiguous.
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 text-xs hover:opacity-90 text-white rounded-lg px-3 py-1.5 font-medium transition-opacity whitespace-nowrap self-start sm:self-auto"
            style={{ background: 'var(--accent)' }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Unit
          </button>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : uoms.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Ruler className="h-10 w-10 opacity-30" />
          <p className="text-sm">No units found.</p>
        </div>
      ) : (
        <div className="max-w-3xl w-full mx-auto p-4 sm:p-6 space-y-6">

          {/* Active units */}
          <section>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Active ({active.length})
            </h2>
            <div className="bg-background border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Abbrev.</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Base Unit</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Factor</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {active.map((u) => (
                    <UomRow
                      key={u.id}
                      uom={u}
                      canManage={canManage}
                      isOwner={isOwner}
                      onEdit={openEdit}
                      onToggle={() => toggleMut.mutate(u)}
                      toggling={toggleMut.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Inactive units — collapsed section */}
          {inactive.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Inactive ({inactive.length})
              </h2>
              <div className="bg-background border border-border rounded-xl overflow-hidden opacity-60">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {inactive.map((u) => (
                      <UomRow
                        key={u.id}
                        uom={u}
                        canManage={canManage}
                        isOwner={isOwner}
                        onEdit={openEdit}
                        onToggle={() => toggleMut.mutate(u)}
                        toggling={toggleMut.isPending}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">

            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">
                {modal === 'create' ? 'New Unit of Measure' : `Edit: ${editing?.name}`}
              </h2>
              <button onClick={() => setModal(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="e.g. Kilogram"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Abbreviation <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={form.abbreviation}
                    onChange={(e) => setForm((f) => ({ ...f, abbreviation: e.target.value.toUpperCase() }))}
                    className={INPUT_CLS}
                    placeholder="e.g. KG"
                    maxLength={10}
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-muted/50 border border-border space-y-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Conversion (optional) — links this unit to a base unit
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Base Unit Abbrev.</label>
                    <input
                      value={form.baseUnit}
                      onChange={(e) => setForm((f) => ({ ...f, baseUnit: e.target.value.toUpperCase() }))}
                      className={INPUT_CLS}
                      placeholder="e.g. KG"
                      maxLength={10}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Factor</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.conversionFactor}
                      onChange={(e) => setForm((f) => ({ ...f, conversionFactor: e.target.value }))}
                      className={INPUT_CLS}
                      placeholder="e.g. 0.001"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Example: 1 G = 0.001 KG → base unit: KG, factor: 0.001
                </p>
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
                {saving ? 'Saving…' : modal === 'create' ? 'Add Unit' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Row sub-component ────────────────────────────────────────────────────────

function UomRow({
  uom, canManage, isOwner, onEdit, onToggle, toggling,
}: {
  uom:        Uom;
  canManage:  boolean;
  isOwner:    boolean;
  onEdit:     (u: Uom) => void;
  onToggle:   () => void;
  toggling:   boolean;
}) {
  return (
    <tr className="hover:bg-muted/40 transition-colors">
      <td className="px-4 py-2.5 font-medium text-foreground">{uom.name}</td>
      <td className="px-4 py-2.5">
        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
          {uom.abbreviation}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
        {uom.baseUnit ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-right text-muted-foreground font-mono hidden sm:table-cell">
        {uom.conversionFactor != null ? Number(uom.conversionFactor).toString() : '—'}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-3">
          {canManage && (
            <button
              onClick={() => onEdit(uom)}
              className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {isOwner && (
            <button
              onClick={onToggle}
              disabled={toggling}
              className={`transition-colors disabled:opacity-40 ${
                uom.isActive
                  ? 'text-emerald-500 hover:text-red-400'
                  : 'text-muted-foreground hover:text-emerald-500'
              }`}
              title={uom.isActive ? 'Deactivate' : 'Reactivate'}
            >
              {uom.isActive
                ? <ToggleRight className="h-4 w-4" />
                : <ToggleLeft  className="h-4 w-4" />}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
