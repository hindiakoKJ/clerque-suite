'use client';

/**
 * Clerque Cloud — Tank Dips (gas station)
 *
 * Owner records morning + evening physical tank levels per fuel grade.
 * Variance vs meter-derived dispenses (and any deliveries between dips)
 * is the shrinkage signal — Phase 2 will compute it; this page logs.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';

interface Branch { id: string; name: string; }

interface TankDip {
  id: string;
  fuelGrade: 'UNLEADED' | 'REGULAR' | 'DIESEL' | 'PREMIUM' | 'KEROSENE' | 'OTHER';
  recordedAt: string;
  kind: 'MORNING' | 'EVENING' | 'DELIVERY';
  litersOnHand: number | string;
  deliveryLiters: number | string | null;
  notes: string | null;
  recordedBy: { id: string; name: string };
}

interface Draft {
  branchId: string;
  fuelGrade: TankDip['fuelGrade'];
  kind: TankDip['kind'];
  recordedAt: string;     // ISO
  litersOnHand: string;
  deliveryLiters: string;
  notes: string;
}

const EMPTY: Draft = {
  branchId: '',
  fuelGrade: 'DIESEL',
  kind: 'MORNING',
  recordedAt: new Date().toISOString().slice(0, 16),
  litersOnHand: '',
  deliveryLiters: '',
  notes: '',
};

export default function TankDipsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const branchId = user?.branchId ?? undefined;
  const [showDrawer, setShowDrawer] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const branchesQ = useQuery<Branch[]>({
    queryKey: ['tank-dips', 'branches'],
    queryFn: () => api.get('/branches').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const dipsQ = useQuery<TankDip[]>({
    queryKey: ['tank-dips', branchId],
    queryFn: () => api.get('/fuel/tank-dips', {
      params: branchId ? { branchId } : {},
    }).then((r) => r.data),
    staleTime: 30_000,
  });

  const openDrawer = () => {
    setDraft({
      ...EMPTY,
      branchId: branchId ?? branchesQ.data?.[0]?.id ?? '',
    });
    setShowDrawer(true);
  };

  const save = async () => {
    if (!draft.branchId) { toast.error('Pick a branch.'); return; }
    if (!draft.litersOnHand || Number(draft.litersOnHand) < 0) { toast.error('Liters on hand required.'); return; }
    setSaving(true);
    try {
      await api.post('/fuel/tank-dips', {
        branchId:       draft.branchId,
        fuelGrade:      draft.fuelGrade,
        recordedAt:     new Date(draft.recordedAt).toISOString(),
        kind:           draft.kind,
        litersOnHand:   Number(draft.litersOnHand),
        deliveryLiters: draft.deliveryLiters ? Number(draft.deliveryLiters) : undefined,
        notes:          draft.notes || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['tank-dips'] });
      toast.success('Tank dip recorded');
      setShowDrawer(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-purple-600" />
            Tank dips
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Morning + evening tank levels per fuel grade. Capture deliveries as
            they arrive. Phase 2 will compute the variance against meter-derived
            sales for shrinkage detection.
          </p>
        </div>
        <button onClick={openDrawer} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Record dip
        </button>
      </header>

      {dipsQ.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (dipsQ.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No dips recorded. Tap <b>Record dip</b> when you next check the tanks.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="text-left p-2">Recorded</th>
                <th className="text-left p-2">Kind</th>
                <th className="text-left p-2">Grade</th>
                <th className="text-right p-2">On hand (L)</th>
                <th className="text-right p-2">Delivered (L)</th>
                <th className="text-left p-2">Recorded by</th>
                <th className="text-left p-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {dipsQ.data!.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="p-2 text-xs">{new Date(d.recordedAt).toLocaleString()}</td>
                  <td className="p-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                      d.kind === 'MORNING'  ? 'bg-blue-100 text-blue-800' :
                      d.kind === 'EVENING'  ? 'bg-indigo-100 text-indigo-800' :
                                              'bg-amber-100 text-amber-800'
                    }`}>{d.kind}</span>
                  </td>
                  <td className="p-2 font-bold text-xs">{d.fuelGrade}</td>
                  <td className="p-2 text-right font-mono">{Number(d.litersOnHand).toFixed(3)}</td>
                  <td className="p-2 text-right font-mono">{d.deliveryLiters != null ? Number(d.deliveryLiters).toFixed(3) : '—'}</td>
                  <td className="p-2 text-xs">{d.recordedBy.name}</td>
                  <td className="p-2 text-xs italic text-gray-500">{d.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showDrawer ? (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setShowDrawer(false)}>
          <div className="bg-white w-full max-w-md h-full overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Record tank dip</h3>
              <button onClick={() => setShowDrawer(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label>
                <span className="block text-gray-600 mb-1">Branch</span>
                <select value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })} className="w-full border rounded px-2 py-1.5">
                  <option value="">Select…</option>
                  {branchesQ.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label>
                <span className="block text-gray-600 mb-1">Recorded at</span>
                <input type="datetime-local" value={draft.recordedAt} onChange={(e) => setDraft({ ...draft, recordedAt: e.target.value })} className="w-full border rounded px-2 py-1.5" />
              </label>
              <label>
                <span className="block text-gray-600 mb-1">Kind</span>
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })} className="w-full border rounded px-2 py-1.5">
                  <option value="MORNING">Morning</option>
                  <option value="EVENING">Evening</option>
                  <option value="DELIVERY">Delivery (tanker)</option>
                </select>
              </label>
              <label>
                <span className="block text-gray-600 mb-1">Fuel grade</span>
                <select value={draft.fuelGrade} onChange={(e) => setDraft({ ...draft, fuelGrade: e.target.value as Draft['fuelGrade'] })} className="w-full border rounded px-2 py-1.5">
                  <option value="DIESEL">Diesel</option>
                  <option value="UNLEADED">Unleaded</option>
                  <option value="REGULAR">Regular</option>
                  <option value="PREMIUM">Premium</option>
                  <option value="KEROSENE">Kerosene</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className="col-span-2">
                <span className="block text-gray-600 mb-1">Liters on hand</span>
                <input type="number" step="0.001" min="0" value={draft.litersOnHand} onChange={(e) => setDraft({ ...draft, litersOnHand: e.target.value })} className="w-full border rounded px-2 py-1.5 font-mono text-right" />
              </label>
              {draft.kind === 'DELIVERY' ? (
                <label className="col-span-2">
                  <span className="block text-gray-600 mb-1">Liters delivered (from tanker)</span>
                  <input type="number" step="0.001" min="0" value={draft.deliveryLiters} onChange={(e) => setDraft({ ...draft, deliveryLiters: e.target.value })} className="w-full border rounded px-2 py-1.5 font-mono text-right" placeholder="3500.000" />
                </label>
              ) : null}
              <label className="col-span-2">
                <span className="block text-gray-600 mb-1">Notes</span>
                <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="w-full border rounded px-2 py-1.5" />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowDrawer(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Cancel</button>
              <button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Record dip'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
