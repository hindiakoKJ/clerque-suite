'use client';

/**
 * Clerque Cloud — Fuel Pumps (Gas Station owner setup)
 *
 * Configure each physical pump: label, fuel grade, the linked Product
 * (which sets the per-liter price). Cashier on Counter sees only the pumps
 * the owner has configured here.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Fuel, X, Pencil, Power } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';

interface Branch  { id: string; name: string; }
interface ProductLite { id: string; name: string; price: number | string; }

interface FuelPump {
  id: string;
  label: string;
  fuelGrade: 'UNLEADED' | 'REGULAR' | 'DIESEL' | 'PREMIUM' | 'KEROSENE' | 'OTHER';
  isActive: boolean;
  currentMeter: number | string;
  doeCeilingPricePhp: number | string | null;
  sortOrder: number;
  product: { id: string; name: string; price: number | string };
  dispenses: Array<{
    id: string;
    status: 'OPEN' | 'COMPLETED' | 'VOIDED';
    attendant: { id: string; name: string };
    openingMeter: number | string;
  }>;
}

interface PumpDraft {
  label: string;
  fuelGrade: FuelPump['fuelGrade'];
  productId: string;
  currentMeter: string;
  doeCeilingPricePhp: string;
  branchId: string;
  isActive: boolean;
}

const EMPTY: PumpDraft = {
  label: 'Pump 1',
  fuelGrade: 'DIESEL',
  productId: '',
  currentMeter: '0',
  doeCeilingPricePhp: '',
  branchId: '',
  isActive: true,
};

export default function FuelPumpsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const userBranchId = user?.branchId ?? undefined;
  const [drawer, setDrawer] = useState<{ kind: 'create' | 'edit'; pumpId?: string } | null>(null);
  const [draft, setDraft] = useState<PumpDraft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const branchesQ = useQuery<Branch[]>({
    queryKey: ['fuel-pumps', 'branches'],
    queryFn: () => api.get('/branches').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const productsQ = useQuery<ProductLite[]>({
    queryKey: ['fuel-pumps', 'products'],
    queryFn: () => api.get('/products').then((r) => r.data),
    staleTime: 60_000,
  });
  const pumpsQ = useQuery<FuelPump[]>({
    queryKey: ['fuel-pumps', userBranchId],
    queryFn: () => api.get('/fuel/pumps', {
      params: userBranchId ? { branchId: userBranchId } : {},
    }).then((r) => r.data),
    staleTime: 30_000,
  });

  const startCreate = () => {
    setDraft({ ...EMPTY, branchId: userBranchId ?? branchesQ.data?.[0]?.id ?? '' });
    setDrawer({ kind: 'create' });
  };
  const startEdit = (p: FuelPump) => {
    setDraft({
      label: p.label,
      fuelGrade: p.fuelGrade,
      productId: p.product.id,
      currentMeter: String(p.currentMeter),
      doeCeilingPricePhp: p.doeCeilingPricePhp != null ? String(p.doeCeilingPricePhp) : '',
      branchId: userBranchId ?? branchesQ.data?.[0]?.id ?? '',
      isActive: p.isActive,
    });
    setDrawer({ kind: 'edit', pumpId: p.id });
  };

  const save = async () => {
    if (!draft.label.trim()) { toast.error('Label required.'); return; }
    if (!draft.productId)    { toast.error('Pick a fuel product.'); return; }
    setSaving(true);
    try {
      const ceiling = draft.doeCeilingPricePhp ? Number(draft.doeCeilingPricePhp) : null;
      if (drawer?.kind === 'create') {
        await api.post('/fuel/pumps', {
          branchId:     draft.branchId,
          label:        draft.label.trim(),
          fuelGrade:    draft.fuelGrade,
          productId:    draft.productId,
          currentMeter: Number(draft.currentMeter) || 0,
          doeCeilingPricePhp: ceiling,
        });
      } else if (drawer?.kind === 'edit' && drawer.pumpId) {
        await api.patch(`/fuel/pumps/${drawer.pumpId}`, {
          label:        draft.label.trim(),
          fuelGrade:    draft.fuelGrade,
          productId:    draft.productId,
          currentMeter: Number(draft.currentMeter) || 0,
          doeCeilingPricePhp: ceiling,
          isActive:     draft.isActive,
        });
      }
      await qc.invalidateQueries({ queryKey: ['fuel-pumps'] });
      toast.success('Saved');
      setDrawer(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: FuelPump) => {
    try {
      await api.patch(`/fuel/pumps/${p.id}`, { isActive: !p.isActive });
      await qc.invalidateQueries({ queryKey: ['fuel-pumps'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Fuel className="w-6 h-6 text-purple-600" />
            Fuel pumps
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Configure each physical pump. The cashier on Counter sees these and
            taps to capture opening + closing meter readings. Price per liter
            comes from the linked Product — update its price to update the pump.
          </p>
        </div>
        <button
          onClick={startCreate}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New pump
        </button>
      </header>

      {pumpsQ.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (pumpsQ.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No pumps yet. Tap <b>New pump</b> to add one.{' '}
          <span className="text-xs block mt-2">
            (First create a fuel Product on <a href="/pos/products" className="text-purple-600 underline">Products</a> — e.g. &ldquo;Diesel (per Liter)&rdquo; @ ₱62.50)
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pumpsQ.data!.map((p) => {
            const openDispense = p.dispenses[0];
            return (
              <div key={p.id} className={`bg-white border rounded-lg p-4 ${!p.isActive ? 'opacity-50' : ''} ${openDispense ? 'border-amber-400 border-2' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-lg">{p.label}</div>
                    <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-gray-100 text-gray-700">
                      {p.fuelGrade}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Price/L</div>
                    <div className="font-mono font-bold text-lg">{formatPeso(Math.round(Number(p.product.price) * 100))}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Product: <span className="text-gray-800">{p.product.name}</span>
                </div>
                {p.doeCeilingPricePhp != null ? (
                  Number(p.product.price) > Number(p.doeCeilingPricePhp) ? (
                    <div className="mt-2 text-[11px] font-bold uppercase tracking-wider rounded bg-red-100 text-red-800 px-1.5 py-0.5 inline-flex items-center gap-1">
                      ⚠ Above DOE ceiling (₱{Number(p.doeCeilingPricePhp).toFixed(2)})
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] uppercase tracking-wider text-green-700">
                      ≤ DOE ceiling ₱{Number(p.doeCeilingPricePhp).toFixed(2)}
                    </div>
                  )
                ) : null}
                <div className="text-xs text-gray-500 mt-1 font-mono">
                  Meter: <span className="text-gray-800">{Number(p.currentMeter).toFixed(3)} L</span>
                </div>
                {openDispense ? (
                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-xs">
                    <b>Dispensing</b> · {openDispense.attendant.name}
                  </div>
                ) : null}
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                  <button onClick={() => startEdit(p)} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1">
                    <Pencil className="w-3 h-3" />Edit
                  </button>
                  <button onClick={() => void toggleActive(p)} className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 ml-auto">
                    <Power className="w-3 h-3" />{p.isActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer */}
      {drawer ? (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setDrawer(null)}>
          <div className="bg-white w-full max-w-md h-full overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{drawer.kind === 'create' ? 'New pump' : 'Edit pump'}</h3>
              <button onClick={() => setDrawer(null)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Label</span>
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Pump 1 — Diesel side" className="w-full border rounded px-2 py-1.5" />
            </label>

            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Fuel grade</span>
              <select value={draft.fuelGrade} onChange={(e) => setDraft({ ...draft, fuelGrade: e.target.value as PumpDraft['fuelGrade'] })} className="w-full border rounded px-2 py-1.5">
                <option value="DIESEL">Diesel</option>
                <option value="UNLEADED">Unleaded</option>
                <option value="REGULAR">Regular</option>
                <option value="PREMIUM">Premium</option>
                <option value="KEROSENE">Kerosene</option>
                <option value="OTHER">Other</option>
              </select>
            </label>

            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Linked product (per-liter)</span>
              <select value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })} className="w-full border rounded px-2 py-1.5">
                <option value="">Select product…</option>
                {productsQ.data?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — ₱{Number(p.price).toFixed(2)}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Price comes from this product. Update on <a href="/pos/products" className="text-purple-600 underline">Products</a>.</p>
            </label>

            {drawer.kind === 'create' ? (
              <label className="text-sm block mb-3">
                <span className="block text-gray-600 mb-1">Branch</span>
                <select value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })} className="w-full border rounded px-2 py-1.5">
                  <option value="">Select…</option>
                  {branchesQ.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            ) : null}

            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">Current totalizer (L)</span>
              <input type="number" min="0" step="0.001" value={draft.currentMeter} onChange={(e) => setDraft({ ...draft, currentMeter: e.target.value })} className="w-full border rounded px-2 py-1.5 font-mono text-right" />
              <p className="text-xs text-gray-500 mt-1">The next dispense will use this as the default opening reading.</p>
            </label>

            <label className="text-sm block mb-3">
              <span className="block text-gray-600 mb-1">
                DOE price ceiling (₱/L)
                <span className="ml-1 text-[10px] uppercase tracking-wider text-gray-500">optional</span>
              </span>
              <input
                type="number" min="0" step="0.01"
                value={draft.doeCeilingPricePhp}
                onChange={(e) => setDraft({ ...draft, doeCeilingPricePhp: e.target.value })}
                placeholder="Leave blank if no ceiling in force"
                className="w-full border rounded px-2 py-1.5 font-mono text-right"
              />
              <p className="text-xs text-gray-500 mt-1">
                Set when DOE issues a price freeze. The pump card flashes red if the
                linked Product&apos;s price exceeds this value. Update manually when
                the freeze lifts.
              </p>
            </label>

            {drawer.kind === 'edit' ? (
              <label className="text-sm flex items-center gap-2 mb-3">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
                <span>Active (visible to cashier on Counter)</span>
              </label>
            ) : null}

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setDrawer(null)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Cancel</button>
              <button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : drawer.kind === 'create' ? 'Create pump' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
