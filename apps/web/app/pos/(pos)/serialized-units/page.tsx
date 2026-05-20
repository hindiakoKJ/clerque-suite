'use client';

/**
 * Clerque Cloud — Serialized Units (DME inventory of trackable equipment)
 *
 * Wheelchairs, CPAP machines, hospital beds — anything with a serial number.
 * Owner adds units as they're acquired; status tracks the lifecycle:
 *   IN_STOCK → SOLD | ON_RENT → IN_STOCK | IN_REPAIR → RETIRED
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileBadge, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';

interface Branch { id: string; name: string; }
interface ProductLite { id: string; name: string; sku: string | null; price: number | string; }

interface SerializedUnit {
  id: string;
  serialNumber: string;
  status: 'IN_STOCK' | 'SOLD' | 'ON_RENT' | 'IN_REPAIR' | 'RETIRED';
  acquiredAt: string;
  acquiredCost: number | string | null;
  conditionNotes: string | null;
  product: { id: string; name: string; sku: string | null; price: number | string };
  branch:  { id: string; name: string };
}

interface Draft {
  branchId: string;
  productId: string;
  serialNumber: string;
  acquiredCost: string;
  conditionNotes: string;
}

const EMPTY: Draft = { branchId: '', productId: '', serialNumber: '', acquiredCost: '', conditionNotes: '' };

export default function SerializedUnitsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [filter, setFilter] = useState<SerializedUnit['status'] | 'ALL'>('ALL');
  const [showDrawer, setShowDrawer] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const branchesQ = useQuery<Branch[]>({
    queryKey: ['units', 'branches'],
    queryFn: () => api.get('/branches').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const productsQ = useQuery<ProductLite[]>({
    queryKey: ['units', 'products'],
    queryFn: () => api.get('/products').then((r) => r.data),
    staleTime: 60_000,
  });
  const unitsQ = useQuery<SerializedUnit[]>({
    queryKey: ['units', filter],
    queryFn: () => api.get('/serialized-units', {
      params: filter === 'ALL' ? {} : { status: filter },
    }).then((r) => r.data),
    staleTime: 30_000,
  });

  const counts = useMemo(() => {
    const map: Record<string, number> = { IN_STOCK: 0, SOLD: 0, ON_RENT: 0, IN_REPAIR: 0, RETIRED: 0 };
    for (const u of unitsQ.data ?? []) map[u.status] = (map[u.status] ?? 0) + 1;
    return map;
  }, [unitsQ.data]);

  const openDrawer = () => {
    setDraft({ ...EMPTY, branchId: user?.branchId ?? branchesQ.data?.[0]?.id ?? '' });
    setShowDrawer(true);
  };

  const save = async () => {
    if (!draft.productId || !draft.serialNumber.trim()) {
      toast.error('Product and serial number are required.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/serialized-units', {
        branchId:       draft.branchId,
        productId:      draft.productId,
        serialNumber:   draft.serialNumber.trim(),
        acquiredCost:   draft.acquiredCost ? Number(draft.acquiredCost) : undefined,
        conditionNotes: draft.conditionNotes || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['units'] });
      toast.success('Unit added');
      setShowDrawer(false);
      setDraft(EMPTY);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileBadge className="w-6 h-6 text-purple-600" />
            Serialized units
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Per-unit inventory for serialized equipment. Each row tracks a specific
            wheelchair / CPAP / bed by serial number, with its lifecycle status.
          </p>
        </div>
        <button onClick={openDrawer} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add unit
        </button>
      </header>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['ALL', 'IN_STOCK', 'ON_RENT', 'IN_REPAIR', 'SOLD', 'RETIRED'] as const).map((s) => {
          const active = filter === s;
          const c = s === 'ALL' ? (unitsQ.data?.length ?? 0) : (counts[s] ?? 0);
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full ${active ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {s.replace('_', ' ')} · {c}
            </button>
          );
        })}
      </div>

      {unitsQ.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (unitsQ.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No serialized units yet. Tap <b>Add unit</b> when you receive your first wheelchair / CPAP.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="text-left p-2">Serial #</th>
                <th className="text-left p-2">Product</th>
                <th className="text-left p-2">Branch</th>
                <th className="text-right p-2">Acquired cost</th>
                <th className="text-left p-2">Notes</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {unitsQ.data!.map((u) => (
                <tr key={u.id} className="border-b border-gray-100">
                  <td className="p-2 font-mono text-xs">{u.serialNumber}</td>
                  <td className="p-2">{u.product.name}</td>
                  <td className="p-2 text-xs">{u.branch.name}</td>
                  <td className="p-2 text-right font-mono text-xs">
                    {u.acquiredCost != null ? formatPeso(Math.round(Number(u.acquiredCost) * 100)) : '—'}
                  </td>
                  <td className="p-2 text-xs italic text-gray-500">{u.conditionNotes ?? '—'}</td>
                  <td className="p-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                      u.status === 'IN_STOCK'  ? 'bg-green-100 text-green-800' :
                      u.status === 'ON_RENT'   ? 'bg-purple-100 text-purple-800' :
                      u.status === 'IN_REPAIR' ? 'bg-amber-100 text-amber-800' :
                      u.status === 'SOLD'      ? 'bg-blue-100 text-blue-800' :
                                                 'bg-red-100 text-red-800'
                    }`}>{u.status.replace('_', ' ')}</span>
                  </td>
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
              <h3 className="text-lg font-bold">Add serialized unit</h3>
              <button onClick={() => setShowDrawer(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Branch</span>
              <select value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })} className="w-full border rounded px-2 py-1.5">
                <option value="">Select…</option>
                {branchesQ.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Product</span>
              <select value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })} className="w-full border rounded px-2 py-1.5">
                <option value="">Select…</option>
                {productsQ.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</option>)}
              </select>
            </label>
            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Serial number</span>
              <input value={draft.serialNumber} onChange={(e) => setDraft({ ...draft, serialNumber: e.target.value })} placeholder="e.g. WC-2026-00042" className="w-full border rounded px-2 py-1.5 font-mono" />
            </label>
            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Acquired cost (₱) — optional</span>
              <input type="number" step="0.01" min="0" value={draft.acquiredCost} onChange={(e) => setDraft({ ...draft, acquiredCost: e.target.value })} placeholder="0.00" className="w-full border rounded px-2 py-1.5 font-mono text-right" />
            </label>
            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Condition notes</span>
              <textarea rows={2} value={draft.conditionNotes} onChange={(e) => setDraft({ ...draft, conditionNotes: e.target.value })} className="w-full border rounded px-2 py-1.5" />
            </label>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowDrawer(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Cancel</button>
              <button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Add unit'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
