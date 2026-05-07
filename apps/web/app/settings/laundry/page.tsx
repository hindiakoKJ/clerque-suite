'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, WashingMachine, Wind, Tag, ToggleRight, ToggleLeft } from 'lucide-react';
import Link from 'next/link';
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
  const user = useAuthStore((s) => s.user);

  if (user && !isLaundryType((user as any).businessType ?? null)) {
    // Don't hard-block; this page is harmless on non-LAUNDRY tenants but
    // shows nothing useful. We'll just display a friendly note.
  }

  const [tab, setTab] = useState<'prices' | 'promos' | 'machines'>('prices');

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Settings
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Laundry</h1>
        <p className="text-sm text-muted-foreground">Service prices, promos, and machine fleet.</p>
      </header>

      <div className="flex gap-1 border-b border-border">
        {(['prices', 'promos', 'machines'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-[var(--accent)] text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'prices' ? 'Service Prices' : t === 'promos' ? 'Promos' : 'Machines'}
          </button>
        ))}
      </div>

      {tab === 'prices' && <PricesTab />}
      {tab === 'promos' && <PromosTab />}
      {tab === 'machines' && <MachinesTab />}
    </div>
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

  return (
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
            return (
              <tr key={code} className="border-t border-border/40">
                <td className="px-4 py-2.5 font-medium">{SERVICE_LABEL[code]}</td>
                <td className="px-4 py-2.5 text-right">
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
  const { data: branchData } = useQuery<{ data: Branch[] }>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });
  const branches = branchData?.data ?? [];

  const [showNew, setShowNew] = useState(false);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<MachineKind>('WASHER');
  const [capacity, setCapacity] = useState('8');
  const [branchId, setBranchId] = useState('');

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
              </tr>
            );
          })}
        </tbody>
      </table>

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
