'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Plus, Send, Undo2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ───────────────────────────────────────────────────────────────────

type AdvanceStatus = 'DRAFT' | 'POSTED' | 'APPLIED' | 'REFUNDED' | 'VOIDED';
type PaymentMethod = 'CASH' | 'GCASH_PERSONAL' | 'GCASH_BUSINESS' | 'MAYA_PERSONAL' | 'MAYA_BUSINESS' | 'QR_PH';

interface Customer { id: string; name: string }
interface Invoice  { id: string; invoiceNumber: string; balanceAmount: number; status: string }

interface CustomerAdvance {
  id: string;
  advanceNumber: string;
  customer: { id: string; name: string };
  advanceDate: string;
  postingDate: string;
  method: PaymentMethod;
  reference: string | null;
  totalAmount: number;
  appliedAmount: number;
  unappliedAmount: number;
  status: AdvanceStatus;
  description: string | null;
  journalEntry?: { id: string; entryNumber: string } | null;
}

interface AdvancesResponse {
  data: CustomerAdvance[];
  total: number; page: number; pageSize: number; pages: number;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function CustomerAdvancesPage() {
  const qc = useQueryClient();

  const advancesQ = useQuery<AdvancesResponse>({
    queryKey: ['ar/customer-advances'],
    queryFn:  () => api.get('/ar/customer-advances').then((r) => r.data),
  });
  const customersQ = useQuery<Customer[]>({
    queryKey: ['ar/customers/all'],
    queryFn:  () => api.get('/ar/customers?pageSize=500').then((r) => r.data?.data ?? r.data ?? []),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [applyTarget, setApplyTarget] = useState<CustomerAdvance | null>(null);
  const [refundTarget, setRefundTarget] = useState<CustomerAdvance | null>(null);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Wallet className="w-6 h-6 text-[var(--accent)]" /> Customer Advances
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customer deposits / down payments received before invoicing.
            Sits as a liability until applied to an invoice.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> New Advance
        </button>
      </header>

      <section className="rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-4 py-2.5 font-medium">Advance #</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium text-right">Total</th>
              <th className="px-4 py-2.5 font-medium text-right">Unapplied</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium w-1"></th>
            </tr>
          </thead>
          <tbody>
            {advancesQ.isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
            )}
            {advancesQ.data?.data.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No advances yet.</td></tr>
            )}
            {advancesQ.data?.data.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-4 py-2.5 font-mono text-xs">{a.advanceNumber}</td>
                <td className="px-4 py-2.5">{a.customer.name}</td>
                <td className="px-4 py-2.5">{new Date(a.advanceDate).toLocaleDateString('en-PH')}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatPeso(Number(a.totalAmount))}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatPeso(Number(a.unappliedAmount))}</td>
                <td className="px-4 py-2.5"><StatusBadge status={a.status} /></td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {a.status === 'DRAFT' && (
                    <PostBtn id={a.id} onDone={() => qc.invalidateQueries({ queryKey: ['ar/customer-advances'] })} />
                  )}
                  {(a.status === 'POSTED') && Number(a.unappliedAmount) > 0 && (
                    <button onClick={() => setApplyTarget(a)} className="text-xs px-2 py-1 rounded border hover:bg-muted">
                      Apply
                    </button>
                  )}
                  {(a.status === 'POSTED' || a.status === 'APPLIED') && Number(a.unappliedAmount) > 0 && (
                    <button onClick={() => setRefundTarget(a)} className="ml-1 text-xs px-2 py-1 rounded border hover:bg-muted">
                      Refund
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showCreate && (
        <CreateAdvanceModal
          customers={customersQ.data ?? []}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['ar/customer-advances'] });
          }}
        />
      )}
      {applyTarget && (
        <ApplyAdvanceModal
          advance={applyTarget}
          onClose={() => setApplyTarget(null)}
          onApplied={() => {
            setApplyTarget(null);
            qc.invalidateQueries({ queryKey: ['ar/customer-advances'] });
          }}
        />
      )}
      {refundTarget && (
        <RefundAdvanceModal
          advance={refundTarget}
          onClose={() => setRefundTarget(null)}
          onDone={() => {
            setRefundTarget(null);
            qc.invalidateQueries({ queryKey: ['ar/customer-advances'] });
          }}
        />
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AdvanceStatus }) {
  const cls: Record<AdvanceStatus, string> = {
    DRAFT:    'bg-muted text-muted-foreground',
    POSTED:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    APPLIED:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    REFUNDED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    VOIDED:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  };
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls[status]}`}>{status}</span>;
}

function PostBtn({ id, onDone }: { id: string; onDone: () => void }) {
  const m = useMutation({
    mutationFn: () => api.post(`/ar/customer-advances/${id}/post`, {}, {
      headers: { 'Idempotency-Key': `post-ca-${id}-${Date.now()}` },
    }),
    onSuccess: () => { toast.success('Advance posted'); onDone(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to post'),
  });
  return (
    <button onClick={() => m.mutate()} disabled={m.isPending}
      className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 inline-flex items-center gap-1">
      <Send className="w-3 h-3" /> Post
    </button>
  );
}

// ── Create modal ────────────────────────────────────────────────────────────

function CreateAdvanceModal({
  customers, onClose, onCreated,
}: { customers: Customer[]; onClose: () => void; onCreated: () => void }) {
  const [customerId, setCustomerId] = useState('');
  const [advanceDate, setAdvanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');

  const m = useMutation({
    mutationFn: () => api.post('/ar/customer-advances', {
      customerId, advanceDate, method, totalAmount, reference: reference || undefined, description: description || undefined,
    }),
    onSuccess: () => { toast.success('Draft created'); onCreated(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  return (
    <Modal title="New Customer Advance" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Customer">
          <select className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— select —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Advance date">
          <input type="date" className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} />
        </Field>
        <Field label="Method">
          <select className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(['CASH', 'GCASH_PERSONAL', 'GCASH_BUSINESS', 'MAYA_PERSONAL', 'MAYA_BUSINESS', 'QR_PH'] as const).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Total amount (PHP)">
          <input type="number" step="0.01" className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={totalAmount || ''} onChange={(e) => setTotalAmount(Number(e.target.value))} />
        </Field>
        <Field label="Reference (OR#, GCash ref)">
          <input className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Description">
          <input className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border hover:bg-muted">Cancel</button>
        <button onClick={() => m.mutate()} disabled={!customerId || !totalAmount || m.isPending}
          className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
          Create draft
        </button>
      </div>
    </Modal>
  );
}

// ── Apply modal ─────────────────────────────────────────────────────────────

function ApplyAdvanceModal({
  advance, onClose, onApplied,
}: { advance: CustomerAdvance; onClose: () => void; onApplied: () => void }) {
  const invoicesQ = useQuery<{ data: Invoice[] }>({
    queryKey: ['ar/invoices/open', advance.customer.id],
    queryFn:  () => api.get(`/ar/invoices?customerId=${advance.customer.id}&status=OPEN,PARTIALLY_PAID&pageSize=100`).then((r) => r.data),
  });
  const invoices = invoicesQ.data?.data ?? [];
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState<number>(0);

  const m = useMutation({
    mutationFn: () => api.post(`/ar/customer-advances/${advance.id}/apply`, { invoiceId, amount }),
    onSuccess: () => { toast.success('Applied'); onApplied(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });

  const selected = useMemo(() => invoices.find((i) => i.id === invoiceId), [invoices, invoiceId]);

  return (
    <Modal title={`Apply ${advance.advanceNumber}`} onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-3">
        Unapplied balance: <span className="font-mono">{formatPeso(Number(advance.unappliedAmount))}</span>
      </p>
      <div className="space-y-3">
        <Field label="Invoice">
          <select className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">— select open invoice —</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNumber} — bal {formatPeso(Number(i.balanceAmount))}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount to apply">
          <input type="number" step="0.01"
            max={Math.min(Number(advance.unappliedAmount), Number(selected?.balanceAmount ?? 0))}
            className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border hover:bg-muted">Cancel</button>
        <button onClick={() => m.mutate()} disabled={!invoiceId || !amount || m.isPending}
          className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
          Apply
        </button>
      </div>
    </Modal>
  );
}

// ── Refund modal ────────────────────────────────────────────────────────────

function RefundAdvanceModal({
  advance, onClose, onDone,
}: { advance: CustomerAdvance; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/ar/customer-advances/${advance.id}/refund`,
      { method, reference: reference || undefined },
      { headers: { 'Idempotency-Key': `refund-ca-${advance.id}-${Date.now()}` } }),
    onSuccess: () => { toast.success('Refunded'); onDone(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });
  return (
    <Modal title={`Refund ${advance.advanceNumber}`} onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-3">
        Refunding unapplied balance of <span className="font-mono">{formatPeso(Number(advance.unappliedAmount))}</span>.
        This is a terminal action.
      </p>
      <div className="space-y-3">
        <Field label="Refund method">
          <select className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(['CASH', 'GCASH_PERSONAL', 'GCASH_BUSINESS', 'MAYA_PERSONAL', 'MAYA_BUSINESS', 'QR_PH'] as const).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Reference">
          <input className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border hover:bg-muted">Cancel</button>
        <button onClick={() => m.mutate()} disabled={m.isPending}
          className="px-3 py-1.5 text-sm rounded bg-amber-600 text-white hover:opacity-90 inline-flex items-center gap-1">
          <Undo2 className="w-3.5 h-3.5" /> Refund
        </button>
      </div>
    </Modal>
  );
}

// ── Tiny UI bits ────────────────────────────────────────────────────────────

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl border w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
