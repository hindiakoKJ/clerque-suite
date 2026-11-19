'use client';

/**
 * Deliveries to confirm: supplier invoices AIBA read from the owner's photos,
 * held as receiving drafts (apps/api/src/service-api/receiving-drafts.*).
 * Nothing has moved yet. Confirming receives every line through Clerque's own
 * receiving (stock, cost, the journal and the supplier bill on credit);
 * discarding drops the draft.
 *
 * Owner and branch manager only, as the API says: confirming receives stock at
 * a cost and files a bill.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Truck, Loader2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';

type Status = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

interface Line {
  itemId: string;
  itemName: string | null;
  itemUnit: string | null;
  qty: string;
  uom: string | null;
  unitCost: string;
  lineTotal: string;
  printed: string | null;
}
type Outcome =
  | { itemId: string; outcome: 'POSTED'; quantityAfter: number }
  | { itemId: string; outcome: 'ALREADY_POSTED' }
  | { itemId: string; outcome: 'FAILED'; reason: string };

interface Draft {
  id: string;
  reference: string;
  status: Status | 'POSTING';
  branchName: string | null;
  supplierName: string;
  supplierTin: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  vatable: boolean;
  subtotal: string;
  vat: string;
  total: string;
  purchaseOrderId: string | null;
  lines: Line[];
  result: Outcome[] | null;
  confirmedAt: string | null;
  createdAt: string;
}

const TABS: { id: Status; label: string }[] = [
  { id: 'DRAFT', label: 'To confirm' },
  { id: 'CONFIRMED', label: 'Received' },
  { id: 'CANCELLED', label: 'Discarded' },
];

const peso = (v: string | number) =>
  `P${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (v: string) => Number(v).toLocaleString('en-PH', { maximumFractionDigits: 4 });
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }) : '';
const errText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m ?? fallback;
};

export default function DeliveriesPage() {
  const [tab, setTab] = useState<Status>('DRAFT');
  const { data = [], isLoading, isError, error, refetch } = useQuery<Draft[]>({
    queryKey: ['receiving-drafts', tab],
    queryFn: () => api.get<Draft[]>('/receiving-drafts', { params: { status: tab } }).then((r) => r.data),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Truck className="h-5 w-5 text-[var(--accent)]" /> Deliveries to confirm
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Supplier invoices AIBA read from your photos. Nothing is in stock or in the books until you confirm.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === t.id ? 'bg-[var(--accent)] text-white' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isError ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-center gap-3">
          <p className="text-sm flex-1">{errText(error, 'Could not load the deliveries.')}</p>
          <button type="button" onClick={() => refetch()} className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted">Try again</button>
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {tab === 'DRAFT' ? 'Nothing waiting. New deliveries appear here when AIBA reads a supplier invoice.' : 'None.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((d) => <DraftCard key={d.id} d={d} />)}
        </ul>
      )}
    </div>
  );
}

function DraftCard({ d }: { d: Draft }) {
  const qc = useQueryClient();
  const failed = (d.result ?? []).filter((o): o is Extract<Outcome, { outcome: 'FAILED' }> => o.outcome === 'FAILED');
  const doneIds = new Set((d.result ?? []).filter((o) => o.outcome !== 'FAILED').map((o) => o.itemId));
  const partly = doneIds.size > 0;
  const [acceptCost, setAcceptCost] = useState(false);
  const unmatched = d.lines.some((l) => !l.itemName);

  const refresh = () => qc.invalidateQueries({ queryKey: ['receiving-drafts'] });
  const receive = useMutation({
    mutationFn: () =>
      api.post<Draft & { lines: Outcome[] }>(`/receiving-drafts/${d.id}/confirm`, { acceptCostChange: acceptCost }).then((r) => r.data),
    onSuccess: (r) => {
      if (r.status === 'CONFIRMED') toast.success(`Received: invoice ${d.invoiceNumber} from ${d.supplierName}.`);
      else toast.error('Some lines were not received. The reasons are on the card.');
      refresh();
    },
    onError: (e: any) => { toast.error(errText(e, 'Could not confirm.')); refresh(); },
  });
  const discard = useMutation({
    mutationFn: () => api.post(`/receiving-drafts/${d.id}/cancel`).then((r) => r.data),
    onSuccess: () => { toast.success('Discarded. Nothing was received.'); refresh(); },
    onError: (e: any) => toast.error(errText(e, 'Could not discard.')),
  });
  const busy = receive.isPending || discard.isPending || d.status === 'POSTING';

  return (
    <li className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{d.supplierName}</div>
          <div className="text-xs text-muted-foreground">
            Invoice {d.invoiceNumber}, {day(d.invoiceDate)}
            {d.dueDate ? `, due ${day(d.dueDate)}` : ''}
            {d.branchName ? `, for ${d.branchName}` : ''}
            {d.supplierTin ? `, TIN ${d.supplierTin}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold">{peso(d.total)}</div>
          <div className="text-xs text-muted-foreground">
            {d.vatable ? `${peso(d.subtotal)} + VAT ${peso(d.vat)}` : 'Not VAT'}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">On the invoice</th>
              <th className="py-1 pr-3 font-medium">Clerque item</th>
              <th className="py-1 pr-3 font-medium text-right">Qty</th>
              <th className="py-1 pr-3 font-medium text-right">Unit cost{d.vatable ? ' (net of VAT)' : ''}</th>
              <th className="py-1 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => {
              const fail = failed.find((f) => f.itemId === l.itemId);
              return (
                <tr key={`${l.itemId}-${i}`} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3 text-muted-foreground">{l.printed ?? '-'}</td>
                  <td className="py-1.5 pr-3">
                    {l.itemName ?? <span className="text-red-600">Item not found</span>}
                    {doneIds.has(l.itemId) && <span className="ml-2 text-xs text-emerald-600">received</span>}
                    {fail && <span className="block text-xs text-red-600">{fail.reason}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{qty(l.qty)} {l.uom ?? l.itemUnit ?? ''}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{peso(l.unitCost)}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">{peso(l.lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-muted-foreground">
        Read by AIBA {day(d.createdAt)}, reference {d.reference}
        {d.purchaseOrderId ? ', matched to an open purchase order' : ''}
        {d.status === 'CONFIRMED' && d.confirmedAt ? `. Received ${day(d.confirmedAt)}.` : ''}
      </div>

      {(d.status === 'DRAFT' || d.status === 'POSTING') && (
        <div className="space-y-3 border-t border-border pt-3">
          {failed.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <div className="space-y-2">
                <p>
                  {failed.length} line{failed.length === 1 ? ' was' : 's were'} not received. Fix the reason in Clerque, or, if the
                  price really changed, tick the box and confirm again. Lines already received are not received twice.
                </p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={acceptCost} onChange={(e) => setAcceptCost(e.target.checked)} />
                  The supplier&apos;s price really changed; take the new cost
                </label>
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {!partly && (
              <button
                type="button"
                disabled={busy}
                onClick={() => { if (window.confirm(`Discard invoice ${d.invoiceNumber} from ${d.supplierName}? Nothing will be received.`)) discard.mutate(); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" /> Discard
              </button>
            )}
            <button
              type="button"
              disabled={busy || unmatched}
              title={unmatched ? 'A line has no Clerque item; discard it and send the invoice again.' : undefined}
              onClick={() => receive.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {partly ? 'Receive the rest' : `Receive ${peso(d.total)}`}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
