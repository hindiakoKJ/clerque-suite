'use client';
/**
 * POS → Order detail
 *
 * Per-order page showing items, payments, discounts, status timeline, and
 * attachments (Document model with entityType="Order"). Operators can
 * upload supporting docs (PO, signed DR, customer ID) and download/delete
 * existing ones. Bigger receipts (PDF, JPG) are previewed inline; other
 * formats download.
 */
import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Receipt, ShoppingBag, FileText, Upload, Trash2, Download,
  CheckCircle2, XCircle, AlertTriangle, User as UserIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface OrderItem {
  id:           string;
  productName:  string;
  quantity:     string;
  unitPrice:    string;
  lineTotal:    string;
  vatAmount:    string;
  taxType:      string;
  notes:        string | null;
}
interface OrderPayment {
  id:     string;
  method: string;
  amount: string;
  ref:    string | null;
}
interface Order {
  id:                string;
  orderNumber:       string;
  status:            string;
  invoiceType:       string;
  taxType:           string;
  subtotal:          string;
  discountAmount:    string;
  vatAmount:         string;
  totalAmount:       string;
  customerName:      string | null;
  customerTin:       string | null;
  customerAddress:   string | null;
  dueDate:           string | null;
  notes:             string | null;
  paidAt:            string | null;
  completedAt:       string | null;
  voidedAt:          string | null;
  createdAt:         string;
  customer:          { id: string; name: string } | null;
  items:             OrderItem[];
  payments:          OrderPayment[];
  branch:            { id: string; name: string };
}
interface Attachment {
  id:           string;
  filename:     string;
  mimeType:     string;
  sizeBytes:    number;
  label:        string | null;
  createdAt:    string;
}

const STATUS_TINT: Record<string, string> = {
  OPEN:      'bg-amber-500/15 text-amber-700',
  COMPLETED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  VOIDED:    'bg-red-500/15 text-red-600',
  REFUNDED:  'bg-purple-500/15 text-purple-600',
  CANCELLED: 'bg-muted text-muted-foreground',
};

function fmtPeso(n: string | number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n));
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}
function fmtBytes(n: number) {
  if (n < 1024)        return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const qc = useQueryClient();

  const { data: order, isLoading, isError } = useQuery<Order>({
    queryKey: ['order', id],
    queryFn:  () => api.get(`/orders/${id}`).then((r) => r.data),
    enabled:  !!id,
  });

  const { data: attachments = [] } = useQuery<Attachment[]>({
    queryKey: ['order-attachments', id],
    queryFn:  () => api.get('/documents', { params: { entityType: 'Order', entityId: id } }).then((r) => r.data),
    enabled:  !!id,
  });

  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entityType', 'Order');
      fd.append('entityId',   id);
      fd.append('label',      file.name);
      return api.post('/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success('Attached.');
      qc.invalidateQueries({ queryKey: ['order-attachments', id] });
      if (fileInput.current) fileInput.current.value = '';
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Upload failed.'),
  });

  const remove = useMutation({
    mutationFn: (docId: string) => api.delete(`/documents/${docId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Removed.');
      qc.invalidateQueries({ queryKey: ['order-attachments', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading order…</div>;
  }
  if (isError || !order) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-sm">
          Couldn&rsquo;t load that order. It may have been voided or you don&rsquo;t have access.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <ShoppingBag className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold font-mono">{order.orderNumber}</h1>
            <p className="text-xs text-muted-foreground">{order.branch.name}</p>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_TINT[order.status] ?? 'bg-muted text-muted-foreground'}`}>
            {order.status}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
            {order.invoiceType.replace('_', ' ')}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5 max-w-4xl mx-auto w-full">
        {/* Customer block */}
        {(order.customer || order.customerName) && (
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-2">
              <UserIcon className="h-3 w-3" /> Customer
            </div>
            <div className="text-base font-semibold">{order.customer?.name ?? order.customerName}</div>
            {(order.customerTin || order.customerAddress) && (
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                {order.customerTin     && <div>TIN: <span className="font-mono">{order.customerTin}</span></div>}
                {order.customerAddress && <div>{order.customerAddress}</div>}
              </div>
            )}
            {order.dueDate && (
              <div className="text-xs text-amber-600 mt-1">Due: {fmtDate(order.dueDate)}</div>
            )}
          </section>
        )}

        {/* Items */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Items
            </h2>
          </header>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Description</th>
                <th className="text-right px-4 py-2 font-medium">Qty</th>
                <th className="text-right px-4 py-2 font-medium">Unit price</th>
                <th className="text-right px-4 py-2 font-medium">VAT</th>
                <th className="text-right px-4 py-2 font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id} className="border-t border-border/60">
                  <td className="px-4 py-2.5">
                    <div>{it.productName}</div>
                    {it.notes && <div className="text-[10px] text-muted-foreground">{it.notes}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{Number(it.quantity)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtPeso(it.unitPrice)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground">{fmtPeso(it.vatAmount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtPeso(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Totals + Payments */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <section className="rounded-xl border border-border bg-card p-4 space-y-1.5 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Totals</div>
            <Row label="Subtotal" value={fmtPeso(order.subtotal)} />
            {Number(order.discountAmount) > 0 && <Row label="Discount" value={`−${fmtPeso(order.discountAmount)}`} muted />}
            {Number(order.vatAmount) > 0       && <Row label="VAT" value={fmtPeso(order.vatAmount)} muted />}
            <div className="pt-2 border-t border-border" />
            <Row label="Total" value={fmtPeso(order.totalAmount)} bold />
          </section>

          <section className="rounded-xl border border-border bg-card p-4 space-y-1.5 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Payments</div>
            {order.payments.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">No payment recorded yet.</div>
            ) : order.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs">
                <span>{p.method}{p.ref ? ` · ${p.ref}` : ''}</span>
                <span className="font-mono">{fmtPeso(p.amount)}</span>
              </div>
            ))}
          </section>
        </div>

        {/* Status timeline */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-1.5 text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Timeline</div>
          <Timeline label="Created"   when={order.createdAt}     icon={<CheckCircle2 className="h-3 w-3" />} />
          <Timeline label="Paid"      when={order.paidAt}        icon={<CheckCircle2 className="h-3 w-3" />} muted={!order.paidAt} />
          <Timeline label="Completed" when={order.completedAt}   icon={<CheckCircle2 className="h-3 w-3" />} muted={!order.completedAt} />
          {order.voidedAt && <Timeline label="Voided" when={order.voidedAt} icon={<XCircle className="h-3 w-3 text-red-600" />} />}
        </section>

        {/* Attachments */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <header className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" /> Attachments
              <span className="text-[11px] font-normal text-muted-foreground">({attachments.length})</span>
            </h2>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              Upload file
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                }}
              />
            </label>
          </header>

          {attachments.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <AlertTriangle className="h-5 w-5 mx-auto mb-2 opacity-50" />
              No attachments yet. Upload a PDF, image, or document related to this order
              (signed DR, customer PO, ID copy, etc.)
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.label ?? a.filename}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {a.mimeType} · {fmtBytes(a.sizeBytes)} · {fmtDate(a.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={`/api/documents/${a.id}/download`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      <Download className="h-3 w-3" /> Download
                    </a>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${a.label ?? a.filename}"?`)) remove.mutate(a.id);
                      }}
                      disabled={remove.isPending}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium hover:bg-red-500/10 text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={'flex items-center justify-between ' + (muted ? 'text-muted-foreground' : '')}>
      <span className={bold ? 'font-semibold' : ''}>{label}</span>
      <span className={'tabular-nums font-mono ' + (bold ? 'font-bold' : '')}>{value}</span>
    </div>
  );
}

function Timeline({ label, when, icon, muted }: { label: string; when: string | null; icon: React.ReactNode; muted?: boolean }) {
  return (
    <div className={'flex items-center justify-between text-xs ' + (muted ? 'text-muted-foreground/50' : '')}>
      <span className="inline-flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="font-mono">{fmtDate(when)}</span>
    </div>
  );
}
