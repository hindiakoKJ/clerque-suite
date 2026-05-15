'use client';

/**
 * Sprint 25 — Purchase Order detail.
 * Shows the PO header + line items. From here the owner can submit a DRAFT,
 * or record receipts against an ORDERED / PARTIAL PO.
 */
import { useState, use as usePromise } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Send, Inbox } from 'lucide-react';
import { api } from '@/lib/api';

type POStatus = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

interface POItem {
  id:             string;
  description:    string;
  rawMaterialId:  string | null;
  productId:      string | null;
  qtyOrdered:     string;
  qtyReceived:    string;
  unitCost:       string;
  lineTotalCents: number;
  rawMaterial:    { id: string; name: string; unit: string } | null;
  product:        { id: string; name: string; sku: string | null } | null;
}
interface PO {
  id:            string;
  poNumber:      string;
  status:        POStatus;
  orderDate:     string;
  expectedAt:    string | null;
  notes:         string | null;
  subtotalCents: number;
  taxCents:      number;
  totalCents:    number;
  vendor:        { id: string; name: string } | null;
  branch:        { id: string; name: string } | null;
  items:         POItem[];
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const queryClient = useQueryClient();
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

  const { data: po, isLoading } = useQuery<PO>({
    queryKey: ['purchase-order', id],
    queryFn:  () => api.get<PO>(`/purchase-orders/${id}`).then((r) => r.data),
  });

  const submitMut = useMutation({
    mutationFn: () => api.post(`/purchase-orders/${id}/submit`),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['purchase-order', id] }),
  });

  const receiveMut = useMutation({
    mutationFn: () => {
      const lines = Object.entries(receiveQty)
        .filter(([, q]) => parseFloat(q) > 0)
        .map(([itemId, q]) => ({ itemId, qtyReceived: parseFloat(q) }));
      return api.post(`/purchase-orders/${id}/receive`, { lines });
    },
    onSuccess: () => {
      setReceiveQty({});
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] });
    },
  });

  if (isLoading || !po) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const canSubmit  = po.status === 'DRAFT' && po.items.length > 0;
  const canReceive = po.status === 'ORDERED' || po.status === 'PARTIAL';

  return (
    <div className="p-6 max-w-5xl">
      <Link href="/admin/purchase-orders" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to list
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{po.poNumber}</h1>
          <div className="text-sm text-slate-500 mt-1">
            {new Date(po.orderDate).toLocaleDateString()} · {po.vendor?.name ?? 'No vendor'} · {po.branch?.name ?? 'No branch'}
          </div>
        </div>
        <div className="flex gap-2">
          {canSubmit && (
            <button
              onClick={() => submitMut.mutate()}
              disabled={submitMut.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {submitMut.isPending ? 'Submitting…' : 'Submit to Vendor'}
            </button>
          )}
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs">{po.status}</span>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Line Items</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Material</th>
              <th className="py-2">Description</th>
              <th className="py-2 w-24">Ordered</th>
              <th className="py-2 w-24">Received</th>
              <th className="py-2 w-28">Unit Cost</th>
              <th className="py-2 w-28">Line Total</th>
              {canReceive && <th className="py-2 w-32">Receive Now</th>}
            </tr>
          </thead>
          <tbody>
            {po.items.map((it) => {
              const remaining = parseFloat(it.qtyOrdered) - parseFloat(it.qtyReceived);
              return (
                <tr key={it.id} className="border-t">
                  <td className="py-2">{it.rawMaterial?.name ?? it.product?.name ?? '—'}</td>
                  <td className="py-2">{it.description}</td>
                  <td className="py-2">{it.qtyOrdered}</td>
                  <td className="py-2">{it.qtyReceived}</td>
                  <td className="py-2">₱{parseFloat(it.unitCost).toFixed(2)}</td>
                  <td className="py-2">₱{(it.lineTotalCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  {canReceive && (
                    <td className="py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        max={remaining}
                        value={receiveQty[it.id] ?? ''}
                        onChange={(e) => setReceiveQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                        placeholder={`max ${remaining}`}
                        className="w-full rounded-md border px-2 py-1"
                        disabled={remaining <= 0}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="text-right">
            <div className="text-sm text-slate-500">Subtotal</div>
            <div className="text-xl">₱{(po.subtotalCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
            {po.taxCents > 0 && (
              <>
                <div className="mt-1 text-sm text-slate-500">Tax</div>
                <div>₱{(po.taxCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
              </>
            )}
            <div className="mt-2 text-sm text-slate-500">Total</div>
            <div className="text-2xl font-semibold">₱{(po.totalCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>

        {canReceive && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => receiveMut.mutate()}
              disabled={receiveMut.isPending || !Object.values(receiveQty).some((v) => parseFloat(v) > 0)}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Inbox className="h-4 w-4" /> {receiveMut.isPending ? 'Recording…' : 'Record Receipt'}
            </button>
          </div>
        )}
      </div>

      {po.notes && (
        <div className="rounded-lg border bg-white p-4 text-sm">
          <div className="font-medium mb-1">Notes</div>
          <div className="whitespace-pre-wrap text-slate-700">{po.notes}</div>
        </div>
      )}
    </div>
  );
}
