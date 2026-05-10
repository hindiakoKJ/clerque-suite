'use client';
/**
 * Sprint 19 — Stamp Card Templates editor.
 *
 * Owners / managers define their stamp card programs here ("Coffee Lovers
 * Card · 9 stamps · Free drink"). Once a template is active, every order
 * tagged with a Customer auto-accrues stamps via the OrdersService hook.
 *
 * Soft-delete only — once stamps have been issued under a template,
 * deleting the row would orphan customer cards. Deactivating hides it from
 * the cashier UI but preserves history.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Pencil, Power, PowerOff, Stamp, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

type AccrualBasis = 'PER_ORDER' | 'PER_AMOUNT';

interface Template {
  id: string;
  name: string;
  rewardLabel: string;
  requiredStamps: number;
  accrualBasis: AccrualBasis;
  accrualThreshold: number | null;
  minOrderTotal: number | null;
  expiryDays: number | null;
  isActive: boolean;
  createdAt: string;
  _count?: { cards: number };
}

interface FormState {
  name: string;
  rewardLabel: string;
  requiredStamps: number;
  accrualBasis: AccrualBasis;
  accrualThreshold: string; // string in form, number on submit
  minOrderTotal: string;
  expiryDays: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  rewardLabel: '',
  requiredStamps: 9,
  accrualBasis: 'PER_ORDER',
  accrualThreshold: '',
  minOrderTotal: '',
  expiryDays: '',
};

export default function LoyaltySettingsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  // Sprint 19 — Owner-only (BRANCH_MANAGER also OK — they run promotions
  // day-to-day). Cashiers + employees don't configure stamp programs.
  const canManage = user?.role === 'BUSINESS_OWNER'
    || user?.role === 'SUPER_ADMIN'
    || user?.role === 'BRANCH_MANAGER';
  useEffect(() => {
    if (user && !canManage) router.replace('/settings');
  }, [user, canManage, router]);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ['loyalty-templates'],
    queryFn: () => api.get('/loyalty/templates').then((r) => r.data),
    enabled: !!user && canManage,
  });

  if (!canManage) return null;

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Template | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }
  function openEdit(t: Template) {
    setEditTarget(t);
    setForm({
      name: t.name,
      rewardLabel: t.rewardLabel,
      requiredStamps: t.requiredStamps,
      accrualBasis: t.accrualBasis,
      accrualThreshold: t.accrualThreshold == null ? '' : String(t.accrualThreshold),
      minOrderTotal: t.minOrderTotal == null ? '' : String(t.minOrderTotal),
      expiryDays: t.expiryDays == null ? '' : String(t.expiryDays),
    });
    setModalOpen(true);
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['loyalty-templates'] });

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        name:           form.name.trim(),
        rewardLabel:    form.rewardLabel.trim(),
        requiredStamps: Number(form.requiredStamps),
        accrualBasis:   form.accrualBasis,
        accrualThreshold:
          form.accrualBasis === 'PER_AMOUNT' && form.accrualThreshold !== ''
            ? Number(form.accrualThreshold)
            : null,
        minOrderTotal: form.minOrderTotal !== '' ? Number(form.minOrderTotal) : null,
        expiryDays:    form.expiryDays !== '' ? Number(form.expiryDays) : null,
      };
      if (!body.name) throw new Error('Name is required.');
      if (!body.rewardLabel) throw new Error('Reward label is required.');
      if (body.requiredStamps < 1 || body.requiredStamps > 50) {
        throw new Error('Required stamps must be between 1 and 50.');
      }
      if (body.accrualBasis === 'PER_AMOUNT' && (!body.accrualThreshold || body.accrualThreshold <= 0)) {
        throw new Error('Per-amount accrual needs a positive threshold (e.g. ₱100).');
      }
      if (editTarget) {
        return api.patch(`/loyalty/templates/${editTarget.id}`, body).then((r) => r.data);
      }
      return api.post('/loyalty/templates', body).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success(editTarget ? 'Template updated.' : 'Template created.');
      invalidate();
      setModalOpen(false);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Failed to save.';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    },
  });

  const toggleActiveMut = useMutation({
    mutationFn: (t: Template) =>
      api.patch(`/loyalty/templates/${t.id}`, { isActive: !t.isActive }).then((r) => r.data),
    onSuccess: () => { invalidate(); toast.success('Template updated.'); },
    onError:   (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to update.'),
  });

  const inputCls = 'w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) router.back();
          else router.push('/settings');
        }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Stamp className="h-6 w-6 text-[var(--accent)]" />
            Stamp Card Programs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customers earn stamps automatically on qualifying sales. The same card
            backs the printed receipt-card and the digital pull-up at <code>/stamps/&lt;token&gt;</code>.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2 hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New program
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Stamp className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No stamp programs yet. Create your first one — e.g. <em>"Coffee Lovers · 9 stamps · Free drink"</em>.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="text-left px-4 py-2">Program</th>
                <th className="text-left px-4 py-2">Reward</th>
                <th className="text-left px-4 py-2">Stamps</th>
                <th className="text-left px-4 py-2">Accrual</th>
                <th className="text-left px-4 py-2">Active cards</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.rewardLabel}</td>
                  <td className="px-4 py-3">{t.requiredStamps}</td>
                  <td className="px-4 py-3 text-xs">
                    {t.accrualBasis === 'PER_ORDER'
                      ? `1 stamp per order${t.minOrderTotal ? ` ≥ ₱${t.minOrderTotal}` : ''}`
                      : `1 stamp per ₱${t.accrualThreshold ?? '?'}`}
                  </td>
                  <td className="px-4 py-3">{t._count?.cards ?? 0}</td>
                  <td className="px-4 py-3">
                    {t.isActive
                      ? <span className="rounded px-2 py-0.5 text-xs bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">ACTIVE</span>
                      : <span className="rounded px-2 py-0.5 text-xs bg-muted text-muted-foreground">PAUSED</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        title="Edit"
                        onClick={() => openEdit(t)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        title={t.isActive ? 'Pause' : 'Resume'}
                        onClick={() => toggleActiveMut.mutate(t)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        {t.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-card border border-border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editTarget ? `Edit ${editTarget.name}` : 'New stamp card program'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs uppercase text-muted-foreground tracking-wider">Program name</span>
                <input
                  className={inputCls}
                  placeholder="Coffee Lovers Card"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase text-muted-foreground tracking-wider">Reward</span>
                <input
                  className={inputCls}
                  placeholder="1 free drink"
                  value={form.rewardLabel}
                  onChange={(e) => setForm((f) => ({ ...f, rewardLabel: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase text-muted-foreground tracking-wider">Stamps required</span>
                <input
                  type="number" min={1} max={50}
                  className={inputCls}
                  value={form.requiredStamps}
                  onChange={(e) => setForm((f) => ({ ...f, requiredStamps: Number(e.target.value || 0) }))}
                />
              </label>

              <fieldset className="rounded-lg border border-border p-3 space-y-2">
                <legend className="text-xs uppercase text-muted-foreground tracking-wider px-1">How stamps are earned</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={form.accrualBasis === 'PER_ORDER'}
                    onChange={() => setForm((f) => ({ ...f, accrualBasis: 'PER_ORDER' }))}
                  />
                  <span>1 stamp per order</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={form.accrualBasis === 'PER_AMOUNT'}
                    onChange={() => setForm((f) => ({ ...f, accrualBasis: 'PER_AMOUNT' }))}
                  />
                  <span>1 stamp per ₱ spent</span>
                </label>
                {form.accrualBasis === 'PER_AMOUNT' && (
                  <input
                    type="number" min={1}
                    className={inputCls}
                    placeholder="Threshold (₱). e.g. 100 means 1 stamp per ₱100 spent"
                    value={form.accrualThreshold}
                    onChange={(e) => setForm((f) => ({ ...f, accrualThreshold: e.target.value }))}
                  />
                )}
                {form.accrualBasis === 'PER_ORDER' && (
                  <input
                    type="number" min={0}
                    className={inputCls}
                    placeholder="Minimum order total to qualify (optional, ₱)"
                    value={form.minOrderTotal}
                    onChange={(e) => setForm((f) => ({ ...f, minOrderTotal: e.target.value }))}
                  />
                )}
              </fieldset>

              <label className="block">
                <span className="text-xs uppercase text-muted-foreground tracking-wider">Card expires after (days)</span>
                <input
                  type="number" min={0}
                  className={inputCls}
                  placeholder="Leave blank = never expires"
                  value={form.expiryDays}
                  onChange={(e) => setForm((f) => ({ ...f, expiryDays: e.target.value }))}
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
                disabled={saveMut.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="rounded-lg bg-[var(--accent)] text-white text-sm px-3 py-2 hover:opacity-90 disabled:opacity-50"
              >
                {saveMut.isPending ? 'Saving…' : (editTarget ? 'Save changes' : 'Create program')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
