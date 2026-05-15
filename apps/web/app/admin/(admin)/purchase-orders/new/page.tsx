'use client';

/**
 * Sprint 25 — Create a new draft Purchase Order.
 * Lines reference either a RawMaterial or a Product. Saved POs land in DRAFT
 * status and can be edited/submitted from the detail page.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Trash2, Plus } from 'lucide-react';
import { api } from '@/lib/api';

interface RawMaterial { id: string; name: string; unit: string }
interface Branch      { id: string; name: string }
interface Vendor      { id: string; name: string }

interface LineDraft {
  rawMaterialId: string;
  description:   string;
  qtyOrdered:    string;
  unitCost:      string;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [branchId, setBranchId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([
    { rawMaterialId: '', description: '', qtyOrdered: '', unitCost: '' },
  ]);

  const { data: branches }  = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn:  () => api.get<Branch[]>('/tenant/branches').then((r) => r.data).catch(() => []),
  });
  const { data: vendors }   = useQuery<Vendor[]>({
    queryKey: ['vendors'],
    queryFn:  () => api.get<Vendor[]>('/ap/vendors').then((r) => r.data).catch(() => []),
  });
  const { data: materials } = useQuery<RawMaterial[]>({
    queryKey: ['raw-materials'],
    queryFn:  () => api.get<RawMaterial[]>('/inventory/raw-materials').then((r) => r.data).catch(() => []),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const payload = {
        branchId:   branchId || null,
        vendorId:   vendorId || null,
        orderDate,
        expectedAt: expectedAt || null,
        notes:      notes || undefined,
        items:      lines
          .filter((l) => l.rawMaterialId && parseFloat(l.qtyOrdered) > 0)
          .map((l) => ({
            rawMaterialId: l.rawMaterialId,
            description:   l.description || materials?.find((m) => m.id === l.rawMaterialId)?.name || '',
            qtyOrdered:    parseFloat(l.qtyOrdered),
            unitCost:      parseFloat(l.unitCost || '0'),
          })),
      };
      return api.post<{ id: string }>('/purchase-orders', payload).then((r) => r.data);
    },
    onSuccess: (po) => router.push(`/admin/purchase-orders/${po.id}`),
  });

  const updateLine = (idx: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine    = () => setLines((p) => [...p, { rawMaterialId: '', description: '', qtyOrdered: '', unitCost: '' }]);
  const removeLine = (idx: number) => setLines((p) => p.filter((_, i) => i !== idx));

  const subtotal = lines.reduce(
    (sum, l) => sum + (parseFloat(l.qtyOrdered || '0') * parseFloat(l.unitCost || '0')),
    0,
  );

  const canSubmit = lines.some((l) => l.rawMaterialId && parseFloat(l.qtyOrdered) > 0);

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-6">New Purchase Order</h1>

      <div className="rounded-lg border bg-white p-6 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Branch</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm">
              <option value="">— Select —</option>
              {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Vendor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm">
              <option value="">— None —</option>
              {vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Order Date</label>
            <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium">Expected By</label>
            <input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="text-sm font-medium">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Line Items</h2>
          <button onClick={addLine} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Add Line
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Material</th>
              <th className="py-2">Description</th>
              <th className="py-2 w-24">Qty</th>
              <th className="py-2 w-32">Unit Cost</th>
              <th className="py-2 w-32">Line Total</th>
              <th className="py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const lineTotal = (parseFloat(l.qtyOrdered || '0') * parseFloat(l.unitCost || '0'));
              return (
                <tr key={i} className="border-t">
                  <td className="py-2 pr-2">
                    <select value={l.rawMaterialId} onChange={(e) => updateLine(i, { rawMaterialId: e.target.value })} className="w-full rounded-md border px-2 py-1.5">
                      <option value="">— Select —</option>
                      {materials?.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input type="text" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="w-full rounded-md border px-2 py-1.5" />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" min="0" step="0.0001" value={l.qtyOrdered} onChange={(e) => updateLine(i, { qtyOrdered: e.target.value })} className="w-full rounded-md border px-2 py-1.5" />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" min="0" step="0.01" value={l.unitCost} onChange={(e) => updateLine(i, { unitCost: e.target.value })} className="w-full rounded-md border px-2 py-1.5" />
                  </td>
                  <td className="py-2 pr-2 text-right">₱{lineTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 pr-2">
                    <button onClick={() => removeLine(i)} className="text-red-600" disabled={lines.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="text-right">
            <div className="text-sm text-slate-500">Subtotal</div>
            <div className="text-2xl font-semibold">₱{subtotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={() => router.back()} className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
        <button
          onClick={() => createMut.mutate()}
          disabled={!canSubmit || createMut.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50 hover:bg-slate-800"
        >
          {createMut.isPending ? 'Saving…' : 'Save as Draft'}
        </button>
      </div>
    </div>
  );
}
