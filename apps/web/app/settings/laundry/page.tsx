'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, WashingMachine, Wind, Tag, ToggleRight, ToggleLeft, Sparkles, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { isLaundryType } from '@repo/shared-types';

type ServiceCode = 'WASH' | 'DRY' | 'WASH_DRY_COMBO' | 'DRY_CLEAN' | 'IRON' | 'FOLD' | 'EXTRA_RINSE' | 'FABRIC_SOFTENER';
type ServiceMode = 'SELF_SERVICE' | 'FULL_SERVICE';
type PromoKind   = 'PACKAGE_DEAL' | 'PERCENT_OFF' | 'FLAT_OFF' | 'FREE_NTH';
type MachineKind = 'WASHER' | 'DRYER' | 'COMBO';

interface ServicePrice { id: string; serviceCode: ServiceCode; mode: ServiceMode; unitPrice: string; isActive: boolean }
interface Promo {
  id: string; code: string; name: string; kind: PromoKind;
  conditions: any; priority: number; isActive: boolean;
  validFrom: string | null; validTo: string | null;
}
interface Machine {
  id: string; code: string; kind: MachineKind; capacityKg: string;
  status: 'IDLE' | 'RUNNING' | 'OUT_OF_ORDER';
  branch: { id: string; name: string };
}
interface Branch { id: string; name: string }

function fmtPeso(s: string | number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(s));
}

const SERVICE_LABEL: Record<ServiceCode, string> = {
  WASH: 'Wash', DRY: 'Dry', WASH_DRY_COMBO: 'Wash + Dry combo',
  DRY_CLEAN: 'Dry-clean', IRON: 'Iron', FOLD: 'Fold',
  EXTRA_RINSE: 'Extra rinse', FABRIC_SOFTENER: 'Fabric softener',
};

export default function LaundrySettingsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  if (user && !isLaundryType((user as any).businessType ?? null)) {
    // Don't hard-block; this page is harmless on non-LAUNDRY tenants but
    // shows nothing useful. We'll just display a friendly note.
  }

  const [tab, setTab] = useState<'prices' | 'addons' | 'promos' | 'machines' | 'cycles'>('prices');

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
        <ArrowLeft className="h-4 w-4" /> Back to Settings
      </button>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Laundry</h1>
        <p className="text-sm text-muted-foreground">Service prices, promos, and machine fleet.</p>
      </header>

      <div className="flex gap-1 border-b border-border">
        {(['prices', 'addons', 'promos', 'machines', 'cycles'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-[var(--accent)] text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'prices'   ? 'Service Prices'
            : t === 'addons'   ? 'Add-ons'
            : t === 'promos'   ? 'Promos'
            : t === 'cycles'   ? 'Cycles'
            : 'Machines'}
          </button>
        ))}
      </div>

      {tab === 'prices'   && <PricesTab />}
      {tab === 'addons'   && <AddOnsTab />}
      {tab === 'promos'   && <PromosTab />}
      {tab === 'machines' && <MachinesTab />}
      {tab === 'cycles'   && <CyclesTab />}
    </div>
  );
}

// ── Add-ons tab ─────────────────────────────────────────────────────────────
interface AddOn {
  id: string; code: string; name: string;
  kind: 'SURCHARGE' | 'FLAT_FEE';
  amount: string; priority: number;
  defaultOn: boolean; isActive: boolean;
}

function AddOnsTab() {
  const qc = useQueryClient();
  const { data: addons = [] } = useQuery<AddOn[]>({
    queryKey: ['laundry-addons-all'],
    queryFn:  () => api.get('/laundry/addons?includeInactive=true').then((r) => r.data),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<{ name: string; amount: number; priority: number; defaultOn: boolean; isActive: boolean }> }) =>
      api.patch(`/laundry/addons/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['laundry-addons-all'] }),
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.patch(`/laundry/addons/${id}/delete`).then((r) => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['laundry-addons-all'] });
      toast.success(data?.softDeleted ? 'Soft-deactivated (used in past orders).' : 'Deleted.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const [showNew, setShowNew] = useState(false);
  const [code, setCode]       = useState('');
  const [name, setName]       = useState('');
  const [amount, setAmount]   = useState('');
  const [kind, setKind]       = useState<'SURCHARGE' | 'FLAT_FEE'>('SURCHARGE');

  const create = useMutation({
    mutationFn: () => api.post('/laundry/addons', {
      code, name, kind, amount: Number(amount),
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-addons-all'] });
      toast.success('Add-on created.');
      setShowNew(false); setCode(''); setName(''); setAmount(''); setKind('SURCHARGE');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Service Add-ons</h2>
          <p className="text-xs text-muted-foreground">Modifiers per service line — surcharges or discounts. Negative amount = discount.</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add modifier
        </button>
      </header>
      {addons.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">No add-ons. Add common modifiers like "BYO detergent" or "No fold".</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Code</th>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Kind</th>
              <th className="text-right px-4 py-2 font-medium">Amount ₱</th>
              <th className="text-center px-4 py-2 font-medium">Active</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {addons.map((a) => {
              const amt = Number(a.amount);
              return (
                <tr key={a.id} className="border-t border-border/40">
                  <td className="px-4 py-2.5 font-mono text-xs">{a.code}</td>
                  <td className="px-4 py-2.5">{a.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {a.kind === 'SURCHARGE' ? 'per set' : 'flat fee'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      type="number" step="0.01"
                      defaultValue={amt}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (val !== amt) update.mutate({ id: a.id, body: { amount: val } });
                      }}
                      className={`w-24 rounded-lg border border-border bg-background px-2 py-1 text-right tabular-nums ${
                        amt < 0 ? 'text-emerald-600' : amt > 0 ? 'text-amber-700 dark:text-amber-400' : ''
                      }`}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => update.mutate({ id: a.id, body: { isActive: !a.isActive } })}
                      className={`p-1.5 rounded ${a.isActive ? 'text-emerald-600 hover:bg-emerald-500/10' : 'text-muted-foreground hover:bg-muted'}`}
                    >
                      {a.isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <button
                      onClick={() => { if (confirm(`Delete ${a.code}?`)) remove.mutate(a.id); }}
                      className="p-1.5 rounded text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
        Negative ₱ = discount on the line. Per-set is multiplied by the number of sets; flat fee charges once.
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
            <h2 className="font-semibold">New Add-on</h2>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE (e.g. NO_FOLD)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Without folding)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="SURCHARGE">Per set (charged once per set)</option>
              <option value="FLAT_FEE">Flat fee (charged once per line)</option>
            </select>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₱ (negative = discount)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
              <button
                onClick={() => create.mutate()}
                disabled={!code || !name || !amount || create.isPending}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50"
              >
                {create.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Prices tab ──────────────────────────────────────────────────────────────
function PricesTab() {
  const qc = useQueryClient();
  const { data: prices = [] } = useQuery<ServicePrice[]>({
    queryKey: ['laundry-service-prices'],
    queryFn:  () => api.get('/laundry/service-prices').then((r) => r.data),
  });

  const setPrice = useMutation({
    mutationFn: (body: { serviceCode: ServiceCode; mode: ServiceMode; unitPrice: number; isActive?: boolean }) =>
      api.post('/laundry/service-prices', body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['laundry-service-prices'] }); toast.success('Saved.'); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const services: ServiceCode[] = ['WASH', 'DRY', 'WASH_DRY_COMBO', 'DRY_CLEAN', 'IRON', 'FOLD'];

  // Services that physically CAN'T be self-service. Dry-clean uses solvents
  // and a dedicated machine that customers don't operate; ironing and folding
  // are inherently human-labor tasks. Hide the SELF_SERVICE input for these
  // and let the backend reject any attempt to price them as self-service.
  const SELF_SERVICE_INELIGIBLE: ServiceCode[] = ['DRY_CLEAN', 'IRON', 'FOLD'];

  // First-run state — no service has a non-zero price yet.
  const isFirstRun = prices.every((p) => Number(p.unitPrice) === 0);

  // Sensible PH market defaults (Manila averages, 2026). One-click apply
  // for owners who don't want to enter prices line by line.
  const PH_DEFAULTS: Array<{ serviceCode: ServiceCode; mode: ServiceMode; unitPrice: number }> = [
    { serviceCode: 'WASH',           mode: 'SELF_SERVICE', unitPrice:  60 },
    { serviceCode: 'WASH',           mode: 'FULL_SERVICE', unitPrice: 120 },
    { serviceCode: 'DRY',            mode: 'SELF_SERVICE', unitPrice:  60 },
    { serviceCode: 'DRY',            mode: 'FULL_SERVICE', unitPrice: 100 },
    { serviceCode: 'WASH_DRY_COMBO', mode: 'SELF_SERVICE', unitPrice: 110 },
    { serviceCode: 'WASH_DRY_COMBO', mode: 'FULL_SERVICE', unitPrice: 220 },
    { serviceCode: 'DRY_CLEAN',      mode: 'FULL_SERVICE', unitPrice: 250 },
    { serviceCode: 'IRON',           mode: 'FULL_SERVICE', unitPrice:  35 },
    { serviceCode: 'FOLD',           mode: 'FULL_SERVICE', unitPrice:  20 },
  ];
  const applyDefaults = useMutation({
    mutationFn: async () => {
      // Sequential POSTs — laundry/service-prices is small and ordering keeps
      // toasts predictable. ~9 round trips finishes well under a second.
      for (const p of PH_DEFAULTS) {
        await api.post('/laundry/service-prices', { ...p, isActive: true });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-service-prices'] });
      qc.invalidateQueries({ queryKey: ['laundry-active-orders'] });
      toast.success('Applied PH market default prices. Tweak any row as needed.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to apply defaults.'),
  });

  return (
    <>
      {isFirstRun && (
        <section className="rounded-xl border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-700 p-4 mb-3 flex items-start gap-3">
          <Tag className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm flex-1">
            <p className="font-semibold text-amber-900 dark:text-amber-200">No prices set yet.</p>
            <p className="text-amber-800 dark:text-amber-300/90 mt-0.5">
              Until you set rates, every line on a new ticket will price at ₱0.00. Apply
              typical Manila rates as a starting point, then tweak each row as you like.
            </p>
            <button
              type="button"
              onClick={() => applyDefaults.mutate()}
              disabled={applyDefaults.isPending}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50"
            >
              {applyDefaults.isPending ? 'Applying…' : 'Apply PH market default prices'}
            </button>
          </div>
        </section>
      )}
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Service</th>
            <th className="text-right px-4 py-2 font-medium">Self-service ₱</th>
            <th className="text-right px-4 py-2 font-medium">Full-service ₱</th>
          </tr>
        </thead>
        <tbody>
          {services.map((code) => {
            const self = prices.find((p) => p.serviceCode === code && p.mode === 'SELF_SERVICE');
            const full = prices.find((p) => p.serviceCode === code && p.mode === 'FULL_SERVICE');
            const selfIneligible = SELF_SERVICE_INELIGIBLE.includes(code);
            return (
              <tr key={code} className="border-t border-border/40">
                <td className="px-4 py-2.5 font-medium">{SERVICE_LABEL[code]}</td>
                <td className="px-4 py-2.5 text-right">
                  {selfIneligible ? (
                    <span
                      className="inline-block w-28 rounded-lg border border-dashed border-border/60 bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground italic"
                      title="This service requires staff — not available as self-service."
                    >
                      Staff only
                    </span>
                  ) : (
                    <input
                      type="number" step="0.01"
                      defaultValue={self ? Number(self.unitPrice) : 0}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (val !== Number(self?.unitPrice ?? -1)) {
                          setPrice.mutate({ serviceCode: code, mode: 'SELF_SERVICE', unitPrice: val, isActive: val > 0 });
                        }
                      }}
                      className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-right tabular-nums"
                    />
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <input
                    type="number" step="0.01"
                    defaultValue={full ? Number(full.unitPrice) : 0}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (val !== Number(full?.unitPrice ?? -1)) {
                        setPrice.mutate({ serviceCode: code, mode: 'FULL_SERVICE', unitPrice: val, isActive: val > 0 });
                      }
                    }}
                    className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-right tabular-nums"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
        Set price to 0 to deactivate that service+mode combination.
      </div>
    </section>
    </>
  );
}

// ── Promos tab ──────────────────────────────────────────────────────────────
function PromosTab() {
  const qc = useQueryClient();
  const { data: promos = [] } = useQuery<Promo[]>({
    queryKey: ['laundry-promos'],
    queryFn:  () => api.get('/laundry/promos').then((r) => r.data),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/laundry/promos/${id}/toggle`, { isActive }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['laundry-promos'] }),
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.patch(`/laundry/promos/${id}/delete`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['laundry-promos'] }); toast.success('Deleted.'); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Tag className="h-4 w-4" /> Promos</h2>
        <span className="text-xs text-muted-foreground">{promos.filter((p) => p.isActive).length} active</span>
      </header>
      {promos.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">No promos. Bootstrap the laundry demo to seed examples.</div>
      ) : (
        <ul className="divide-y divide-border/60">
          {promos.map((p) => (
            <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{p.code}</span>
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.kind.replace('_', ' ').toLowerCase()}</span>
                </div>
                <pre className="text-[11px] text-muted-foreground mt-1 overflow-x-auto">{JSON.stringify(p.conditions)}</pre>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggle.mutate({ id: p.id, isActive: !p.isActive })}
                  className={`p-1.5 rounded ${p.isActive ? 'text-emerald-600 hover:bg-emerald-500/10' : 'text-muted-foreground hover:bg-muted'}`}
                  title={p.isActive ? 'Active' : 'Inactive'}
                >
                  {p.isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => { if (confirm(`Delete promo ${p.code}?`)) remove.mutate(p.id); }}
                  className="p-1.5 rounded text-red-500 hover:bg-red-500/10"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Machines tab ────────────────────────────────────────────────────────────
function MachinesTab() {
  const qc = useQueryClient();
  const { data: machines = [] } = useQuery<Machine[]>({
    queryKey: ['laundry-machines'],
    queryFn:  () => api.get('/laundry/machines').then((r) => r.data),
  });
  // /tenant/branches returns Branch[] directly (not { data: [...] }).
  // Filter to active branches so a freshly-deactivated location can't be
  // assigned a new machine.
  const { data: allBranches = [] } = useQuery<Array<Branch & { isActive?: boolean }>>({
    queryKey: ['tenant-branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) =>
      Array.isArray(r.data) ? r.data : (r.data?.data ?? []),
    ),
  });
  const branches = allBranches.filter((b) => b.isActive !== false);

  const [showNew, setShowNew] = useState(false);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<MachineKind>('WASHER');
  const [capacity, setCapacity] = useState('8');
  const [branchId, setBranchId] = useState('');

  // Sprint 19 — edit modal state
  const [editing, setEditing] = useState<Machine | null>(null);

  const create = useMutation({
    mutationFn: () => api.post('/laundry/machines', {
      branchId, code, kind, capacityKg: Number(capacity),
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-machines'] });
      toast.success('Machine added.');
      setShowNew(false);
      setCode('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const updateMut = useMutation({
    mutationFn: (body: { id: string; code: string; kind: MachineKind; capacityKg: number; branchId: string }) =>
      api.patch(`/laundry/machines/${body.id}`, {
        code: body.code, kind: body.kind, capacityKg: body.capacityKg, branchId: body.branchId,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-machines'] });
      toast.success('Machine updated.');
      setEditing(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/laundry/machines/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-machines'] });
      toast.success('Machine deleted.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold">Machines</h2>
        <button
          onClick={() => { setShowNew(true); setBranchId(branches[0]?.id ?? ''); }}
          className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add machine
        </button>
      </header>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Code</th>
            <th className="text-left px-4 py-2 font-medium">Kind</th>
            <th className="text-left px-4 py-2 font-medium">Branch</th>
            <th className="text-right px-4 py-2 font-medium">Capacity</th>
            <th className="text-center px-4 py-2 font-medium">Status</th>
            <th className="text-right px-4 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => {
            const Icon = m.kind === 'WASHER' ? WashingMachine : Wind;
            return (
              <tr key={m.id} className="border-t border-border/40">
                <td className="px-4 py-2.5 font-mono text-xs">{m.code}</td>
                <td className="px-4 py-2.5"><Icon className="inline h-3.5 w-3.5 mr-1 text-muted-foreground" />{m.kind.toLowerCase()}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{m.branch.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{Number(m.capacityKg).toFixed(0)}kg</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${
                    m.status === 'IDLE' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' :
                    m.status === 'RUNNING' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' :
                    'bg-red-500/15 text-red-600'
                  }`}>
                    {m.status.toLowerCase().replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => setEditing(m)}
                      disabled={m.status === 'RUNNING' || updateMut.isPending}
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                      title={m.status === 'RUNNING' ? 'Wait for cycle to finish' : 'Edit machine'}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete machine ${m.code}? This cannot be undone.`)) {
                          deleteMut.mutate(m.id);
                        }
                      }}
                      disabled={m.status === 'RUNNING' || deleteMut.isPending}
                      className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10 disabled:opacity-30"
                      title={m.status === 'RUNNING' ? 'Wait for cycle to finish' : 'Delete machine'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── Edit machine modal (Sprint 19) ─────────────────────────────── */}
      {editing && (
        <EditMachineModal
          machine={editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onSave={(body) => updateMut.mutate({ id: editing.id, ...body })}
          saving={updateMut.isPending}
        />
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
            <h2 className="font-semibold">Add Machine</h2>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="">— branch —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code (e.g. W6, D6)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <select value={kind} onChange={(e) => setKind(e.target.value as MachineKind)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="WASHER">Washer</option>
              <option value="DRYER">Dryer</option>
              <option value="COMBO">Combo (washer+dryer)</option>
            </select>
            <input type="number" step="0.5" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Capacity (kg)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
              <button
                onClick={() => create.mutate()}
                disabled={!branchId || !code || create.isPending}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50"
              >
                {create.isPending ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Cycles tab (Sprint 19) ──────────────────────────────────────────────────
//
// Wash/dry packages — the "buttons on the machine". Operator defines
// {name, kind, durationMinutes, autoComplete} and the queue page uses
// these as the cycle picker at start time.
function CyclesTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: '', kind: 'WASHER' as 'WASHER' | 'DRYER' | 'COMBO',
    durationMinutes: '30', autoComplete: false, surcharge: '',
  });

  interface Cycle {
    id: string; name: string; kind: 'WASHER' | 'DRYER' | 'COMBO';
    durationMinutes: number; autoComplete: boolean; surcharge: string | null;
    isActive: boolean; sortOrder: number;
  }

  const { data: cycles = [] } = useQuery<Cycle[]>({
    queryKey: ['laundry-cycles'],
    queryFn:  () => api.get('/laundry/cycles').then((r) => r.data),
  });

  const createMut = useMutation({
    mutationFn: () => api.post('/laundry/cycles', {
      name:            form.name.trim(),
      kind:            form.kind,
      durationMinutes: Number(form.durationMinutes),
      autoComplete:    form.autoComplete,
      surcharge:       form.surcharge ? Number(form.surcharge) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laundry-cycles'] });
      toast.success('Cycle added.');
      setShowAdd(false);
      setForm({ name: '', kind: 'WASHER', durationMinutes: '30', autoComplete: false, surcharge: '' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const toggleActive = useMutation({
    mutationFn: (c: Cycle) =>
      api.patch(`/laundry/cycles/${c.id}`, { isActive: !c.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['laundry-cycles'] }),
  });

  const toggleAuto = useMutation({
    mutationFn: (c: Cycle) =>
      api.patch(`/laundry/cycles/${c.id}`, { autoComplete: !c.autoComplete }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['laundry-cycles'] }),
  });

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" /> Wash & Dry Cycles
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            The packages your machines run — Regular Wash, Premium Wash, Heavy Duty Dry, etc.
            Each carries a duration; turn on Auto-complete to have the system mark cycles
            DONE and free the machine when the timer elapses (instead of manual confirmation).
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Add Cycle
        </button>
      </div>

      {cycles.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No cycles yet. Add one to enable the cycle picker on the queue page.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Kind</th>
              <th className="text-right px-4 py-2 font-medium">Duration</th>
              <th className="text-right px-4 py-2 font-medium">Surcharge</th>
              <th className="text-center px-4 py-2 font-medium">Auto-complete</th>
              <th className="text-center px-4 py-2 font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => (
              <tr key={c.id} className={`border-t border-border/40 ${!c.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="px-4 py-2.5">
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted">{c.kind}</span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{c.durationMinutes} min</td>
                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                  {c.surcharge ? `+₱${Number(c.surcharge).toFixed(2)}` : '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    onClick={() => toggleAuto.mutate(c)}
                    className={`text-xs px-2 py-0.5 rounded ${
                      c.autoComplete
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground'
                    }`}
                    title="Toggle auto-complete"
                  >
                    {c.autoComplete ? 'ON' : 'off'}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    onClick={() => toggleActive.mutate(c)}
                    className={`text-xs px-2 py-0.5 rounded ${
                      c.isActive
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground'
                    }`}
                    title="Toggle active"
                  >
                    {c.isActive ? 'active' : 'archived'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
            <h3 className="font-semibold">Add Cycle</h3>
            <label className="text-sm block">
              <span className="text-xs text-muted-foreground">Name *</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Premium Wash"
                className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm block">
                <span className="text-xs text-muted-foreground">Kind *</span>
                <select
                  value={form.kind}
                  onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as typeof f.kind }))}
                  className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
                >
                  <option value="WASHER">WASHER</option>
                  <option value="DRYER">DRYER</option>
                  <option value="COMBO">COMBO</option>
                </select>
              </label>
              <label className="text-sm block">
                <span className="text-xs text-muted-foreground">Duration (min) *</span>
                <input
                  type="number" min="1" max="1440"
                  value={form.durationMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm font-mono"
                />
              </label>
            </div>
            <label className="text-sm block">
              <span className="text-xs text-muted-foreground">Surcharge (₱) — optional</span>
              <input
                type="number" step="0.01" min="0"
                value={form.surcharge}
                onChange={(e) => setForm((f) => ({ ...f, surcharge: e.target.value }))}
                placeholder="e.g. 20.00"
                className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm font-mono"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.autoComplete}
                onChange={(e) => setForm((f) => ({ ...f, autoComplete: e.target.checked }))}
              />
              <span>Auto-complete when timer elapses</span>
            </label>
            <p className="text-[11px] text-muted-foreground -mt-1.5">
              When ON, the system marks the line DONE and frees the machine automatically once the
              cycle's duration has passed. The operator can still override this on a per-load basis at start time.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="h-9 px-4 rounded-md border border-border text-sm hover:bg-muted">Cancel</button>
              <button
                onClick={() => createMut.mutate()}
                disabled={!form.name.trim() || !form.durationMinutes || createMut.isPending}
                className="h-9 px-4 rounded-md bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50"
              >
                {createMut.isPending ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Machine edit modal (Sprint 19) ─────────────────────────────────────────
function EditMachineModal({
  machine, branches, onClose, onSave, saving,
}: {
  machine:  Machine;
  branches: Branch[];
  onClose:  () => void;
  onSave:   (body: { code: string; kind: MachineKind; capacityKg: number; branchId: string }) => void;
  saving:   boolean;
}) {
  const [code,     setCode]     = useState(machine.code);
  const [kind,     setKind]     = useState<MachineKind>(machine.kind);
  const [capacity, setCapacity] = useState(String(Number(machine.capacityKg)));
  const [branchId, setBranchId] = useState(machine.branch.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
        <header className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-1.5">
            <Pencil className="h-4 w-4" /> Edit Machine
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="p-5 space-y-3">
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Branch</span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
            >
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="W1, D1, etc."
              className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm font-mono"
            />
          </label>
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as MachineKind)}
              className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
            >
              <option value="WASHER">Washer</option>
              <option value="DRYER">Dryer</option>
              <option value="COMBO">Combo (washer+dryer)</option>
            </select>
          </label>
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Capacity (kg)</span>
            <input
              type="number"
              step="0.5"
              min="0"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm font-mono"
            />
          </label>
        </div>
        <footer className="px-5 pb-5 pt-3 flex justify-end gap-2 border-t border-border">
          <button onClick={onClose} className="h-9 px-4 rounded-md border border-border text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => onSave({ code, kind, capacityKg: Number(capacity), branchId })}
            disabled={saving || !code.trim() || !branchId || !capacity}
            className="h-9 px-4 rounded-md bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
