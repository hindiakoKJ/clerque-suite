'use client';

/**
 * Sprint 25 — Purchase Orders list.
 * Owner / Manager / Warehouse staff see POs across the tenant, filtered by status.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, FileText } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * These screens are mounted twice: at /admin for platform staff and at /pos for
 * the shop owner, who cannot reach /admin at all. Links must therefore point at
 * whichever mount the reader is already on — a hardcoded /admin link sends an
 * owner to a layout that redirects them straight back out.
 */
function usePoBase() {
  const pathname = usePathname();
  return pathname?.startsWith('/admin') ? '/admin/purchase-orders' : '/pos/purchase-orders';
}

type POStatus = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

interface PurchaseOrderRow {
  id:            string;
  poNumber:      string;
  status:        POStatus;
  orderDate:     string;
  expectedAt:    string | null;
  totalCents:    number;
  vendor:        { id: string; name: string } | null;
  branch:        { id: string; name: string } | null;
}

const STATUS_LABEL: Record<POStatus, string> = {
  DRAFT:    'Draft',
  ORDERED:  'Ordered',
  PARTIAL:  'Partially Received',
  RECEIVED: 'Received',
  CANCELLED:'Cancelled',
};
const STATUS_COLOR: Record<POStatus, string> = {
  DRAFT:    'bg-muted text-muted-foreground border border-border',
  ORDERED:  'bg-blue-100 text-blue-700',
  PARTIAL:  'bg-amber-100 text-amber-700',
  RECEIVED: 'bg-emerald-100 text-emerald-700',
  CANCELLED:'bg-red-100 text-red-700',
};

export default function PurchaseOrdersPage() {
  const base = usePoBase();
  const [status, setStatus] = useState<POStatus | ''>('');

  const { data: pos, isLoading } = useQuery<PurchaseOrderRow[]>({
    queryKey: ['purchase-orders', status],
    queryFn:  () =>
      api.get<PurchaseOrderRow[]>(`/purchase-orders${status ? `?status=${status}` : ''}`)
         .then((r) => r.data),
  });

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FileText className="h-6 w-6" /> Purchase Orders
        </h1>
        <Link
          href={`${base}/new`}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" /> New PO
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as POStatus | '')}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_LABEL).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s as POStatus]}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !pos?.length ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No purchase orders match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">PO #</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Branch</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-2">
                    <Link href={`${base}/${p.id}`} className="text-blue-600 hover:underline">
                      {p.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{new Date(p.orderDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2">{p.vendor?.name ?? '—'}</td>
                  <td className="px-4 py-2">{p.branch?.name ?? '—'}</td>
                  <td className="px-4 py-2">₱{(p.totalCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${STATUS_COLOR[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
