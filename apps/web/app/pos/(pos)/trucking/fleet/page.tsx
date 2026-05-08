'use client';
/**
 * Trucking → Fleet
 *
 * Fleet asset register. Each row is a vehicle (truck/trailer/van/motorcycle)
 * with plate, body number, mileage, primary driver. Click a row to see PM
 * schedules + tire serials.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, ArrowLeft, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const KINDS = [
  'TRUCK_4_WHEELER', 'TRUCK_6_WHEELER', 'TRUCK_10_WHEELER',
  'TRACTOR_HEAD', 'TRAILER', 'VAN', 'MOTORCYCLE',
] as const;
type Kind = typeof KINDS[number];

interface FleetAsset {
  id:              string;
  kind:            Kind;
  plateNumber:     string;
  bodyNumber:      string | null;
  engineNumber:    string | null;
  chassisNumber:   string | null;
  yearModel:       number | null;
  mileageKm:       number;
  isActive:        boolean;
  notes:           string | null;
  primaryDriver:   { id: string; name: string } | null;
  branch:          { id: string; name: string } | null;
}

interface User   { id: string; name: string; role: string }
interface Branch { id: string; name: string }

export default function FleetPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data: assets = [] } = useQuery<FleetAsset[]>({
    queryKey: ['trucking-assets'],
    queryFn:  () => api.get('/trucking/assets').then((r) => r.data),
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Wrench className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Fleet</h1>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New Asset
        </button>
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {assets.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No fleet assets yet. Add a truck or van to start dispatching trips.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 font-medium">Plate</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Body / Engine / Chassis</th>
                    <th className="px-4 py-2.5 font-medium">Year</th>
                    <th className="px-4 py-2.5 font-medium text-right">Mileage</th>
                    <th className="px-4 py-2.5 font-medium">Driver</th>
                    <th className="px-4 py-2.5 font-medium">Branch</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-mono">{a.plateNumber}</td>
                      <td className="px-4 py-2.5 text-xs">{a.kind.replaceAll('_', ' ')}</td>
                      <td className="px-4 py-2.5 text-[10px] font-mono text-muted-foreground space-y-0.5">
                        {a.bodyNumber && <div>B: {a.bodyNumber}</div>}
                        {a.engineNumber && <div>E: {a.engineNumber}</div>}
                        {a.chassisNumber && <div>C: {a.chassisNumber}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.yearModel ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{a.mileageKm.toLocaleString()} km</td>
                      <td className="px-4 py-2.5 text-xs">{a.primaryDriver?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs">{a.branch?.name ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={
                          'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ' +
                          (a.isActive
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground')
                        }>
                          {a.isActive ? 'Active' : 'Retired'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewAssetModal
          onClose={() => setShowNew(false)}
          onSuccess={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ['trucking-assets'] });
          }}
        />
      )}
    </div>
  );
}

function NewAssetModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { data: users = [] }    = useQuery<User[]>({
    queryKey: ['users'],
    queryFn:  () => api.get('/users').then((r) => r.data),
  });
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
  });

  const [form, setForm] = useState({
    kind:            'TRUCK_6_WHEELER' as Kind,
    plateNumber:     '',
    bodyNumber:      '',
    engineNumber:    '',
    chassisNumber:   '',
    yearModel:       '',
    mileageKm:       '0',
    primaryDriverId: '',
    branchId:        '',
  });
  function f<K extends keyof typeof form>(k: K, v: any) { setForm((s) => ({ ...s, [k]: v })); }

  const mut = useMutation({
    mutationFn: () => api.post('/trucking/assets', {
      kind:            form.kind,
      plateNumber:     form.plateNumber.trim().toUpperCase(),
      bodyNumber:      form.bodyNumber.trim() || undefined,
      engineNumber:    form.engineNumber.trim() || undefined,
      chassisNumber:   form.chassisNumber.trim() || undefined,
      yearModel:       form.yearModel ? Number(form.yearModel) : undefined,
      mileageKm:       Number(form.mileageKm) || 0,
      primaryDriverId: form.primaryDriverId || undefined,
      branchId:        form.branchId || undefined,
    }).then((r) => r.data),
    onSuccess: () => { toast.success('Asset added.'); onSuccess(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">New Fleet Asset</h3>
        </header>

        <div className="p-5 space-y-3">
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Vehicle type *</span>
            <select
              value={form.kind}
              onChange={(e) => f('kind', e.target.value as Kind)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {KINDS.map((k) => <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>)}
            </select>
          </label>

          <Field label="Plate number *" v={form.plateNumber} on={(v) => f('plateNumber', v)} mono />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Body number" v={form.bodyNumber} on={(v) => f('bodyNumber', v)} mono />
            <Field label="Year model" v={form.yearModel} on={(v) => f('yearModel', v)} type="number" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Engine number" v={form.engineNumber} on={(v) => f('engineNumber', v)} mono />
            <Field label="Chassis number" v={form.chassisNumber} on={(v) => f('chassisNumber', v)} mono />
          </div>
          <Field label="Current mileage (km)" v={form.mileageKm} on={(v) => f('mileageKm', v)} type="number" />

          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Primary driver</span>
            <select
              value={form.primaryDriverId}
              onChange={(e) => f('primaryDriverId', e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">— none —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>

          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Home branch</span>
            <select
              value={form.branchId}
              onChange={(e) => f('branchId', e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">— none —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.plateNumber}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Saving…' : 'Add Asset'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, v, on, type = 'text', mono }: {
  label: string; v: string; on: (v: string) => void; type?: string; mono?: boolean;
}) {
  return (
    <label className="text-sm block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={v}
        onChange={(e) => on(e.target.value)}
        className={'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm ' + (mono ? 'font-mono' : '')}
      />
    </label>
  );
}
