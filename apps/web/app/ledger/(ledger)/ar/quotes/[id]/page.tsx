'use client';
/**
 * Quote detail view. Shows quote info + lines + status, with status-aware
 * action buttons:
 *   DRAFT     → Send
 *   SENT      → Accept | Reject
 *   ACCEPTED  → Convert to Invoice  (opens dialog)
 *   CONVERTED → link to the resulting AR Invoice
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, ArrowLeft, Send, CheckCircle2, XCircle, ArrowRightCircle, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

interface QuoteLine {
  id: string; description: string; quantity: string; unitPrice: string;
  taxAmount: string; lineTotal: string;
}
interface Quote {
  id: string; quoteNumber: string; status: QuoteStatus;
  quoteDate: string; validUntil: string;
  customer: { id: string; name: string; tin?: string | null };
  terms: string | null; notes: string | null;
  subtotal: string; vatAmount: string; totalAmount: string;
  lines: QuoteLine[];
  convertedInvoice: { id: string; invoiceNumber: string; status: string } | null;
  sentAt: string | null; acceptedAt: string | null; convertedAt: string | null;
}

const WRITE_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'SALES_LEAD'];

const STATUS_BADGE: Record<QuoteStatus, { label: string; cls: string }> = {
  DRAFT:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-700' },
  SENT:      { label: 'Sent',      cls: 'bg-amber-100 text-amber-800' },
  ACCEPTED:  { label: 'Accepted',  cls: 'bg-green-100 text-green-800' },
  REJECTED:  { label: 'Rejected',  cls: 'bg-red-100 text-red-800' },
  EXPIRED:   { label: 'Expired',   cls: 'bg-gray-200 text-gray-600' },
  CONVERTED: { label: 'Converted', cls: 'bg-amber-900/10 text-amber-900' },
};

const INPUT_CLS =
  'h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow w-full';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function daysBetween(a: string, b: string) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

function ConvertDialog({
  quote, onClose, onConverted,
}: {
  quote: Quote;
  onClose: () => void;
  onConverted: (invoiceId: string) => void;
}) {
  const today = todayIso();
  // Default term: distance from today to quote.validUntil, capped at 30 days minimum
  const defaultTerms = Math.max(30, daysBetween(today, quote.validUntil));
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [termsDays, setTermsDays]     = useState(String(defaultTerms));
  const [saving, setSaving]           = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post(`/ar/quotes/${quote.id}/convert`, {
        invoiceDate,
        termsDays: parseInt(termsDays, 10) || 30,
      });
      toast.success('Quote converted to AR Invoice (DRAFT). Review & post in AR Billing.');
      onConverted(res.data.convertedInvoice?.id ?? '');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Conversion failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl border border-border w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-semibold">Convert to AR Invoice</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <p className="text-xs text-muted-foreground">
            Creates a DRAFT AR Invoice from this quote&apos;s lines. The Revenue account
            defaults to code 4000 — you can adjust on the invoice before posting.
          </p>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Invoice Date</label>
            <input type="date" className={INPUT_CLS} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Payment Terms (days)</label>
            <input type="number" className={INPUT_CLS} value={termsDays} onChange={(e) => setTermsDays(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-border text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="h-9 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50">
              {saving ? 'Converting…' : 'Convert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc     = useQueryClient();
  const user   = useAuthStore((s) => s.user);
  const canWrite = user ? WRITE_ROLES.includes(user.role) : false;

  const [convertOpen, setConvertOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: quote, isLoading } = useQuery<Quote>({
    queryKey: ['ar-quote', params.id],
    queryFn:  () => api.get(`/ar/quotes/${params.id}`).then((r) => r.data),
    enabled:  !!user && !!params.id,
  });

  async function action(label: string, path: string) {
    setBusy(true);
    try {
      await api.post(path);
      toast.success(label);
      qc.invalidateQueries({ queryKey: ['ar-quote', params.id] });
      qc.invalidateQueries({ queryKey: ['ar-quotes-list'] });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? `${label} failed`);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!quote)    return <div className="p-8 text-muted-foreground">Quote not found.</div>;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <FileSignature className="w-6 h-6" /> {quote.quoteNumber}
            </h1>
            <div className="text-sm flex items-center gap-2">
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[quote.status].cls}`}>
                {STATUS_BADGE[quote.status].label}
              </span>
              {quote.status === 'CONVERTED' && quote.convertedInvoice && (
                <Link href="/ledger/ar/billing" className="text-xs text-[var(--accent)] hover:underline">
                  → AR Invoice {quote.convertedInvoice.invoiceNumber}
                </Link>
              )}
            </div>
          </div>
        </div>

        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {quote.status === 'DRAFT' && (
              <button disabled={busy} onClick={() => action('Quote sent', `/ar/quotes/${quote.id}/send`)}
                className="h-9 px-3 rounded-lg bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
                <Send className="w-4 h-4" /> Send
              </button>
            )}
            {quote.status === 'SENT' && (
              <>
                <button disabled={busy} onClick={() => action('Quote accepted', `/ar/quotes/${quote.id}/accept`)}
                  className="h-9 px-3 rounded-lg bg-green-600 text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
                  <CheckCircle2 className="w-4 h-4" /> Accept
                </button>
                <button disabled={busy} onClick={() => action('Quote rejected', `/ar/quotes/${quote.id}/reject`)}
                  className="h-9 px-3 rounded-lg border border-red-300 text-red-700 text-sm flex items-center gap-1.5 disabled:opacity-50">
                  <XCircle className="w-4 h-4" /> Reject
                </button>
              </>
            )}
            {quote.status === 'ACCEPTED' && (
              <button disabled={busy} onClick={() => setConvertOpen(true)}
                className="h-9 px-3 rounded-lg bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
                <ArrowRightCircle className="w-4 h-4" /> Convert to Invoice
              </button>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-background p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Customer</div>
            <div className="font-medium">{quote.customer.name}</div>
            {quote.customer.tin && <div className="text-xs text-muted-foreground">TIN: {quote.customer.tin}</div>}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Quote Date</div>
            <div>{fmtDate(quote.quoteDate)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Valid Until</div>
            <div>{fmtDate(quote.validUntil)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Sent / Accepted</div>
            <div className="text-xs">
              Sent: {fmtDate(quote.sentAt)} · Accepted: {fmtDate(quote.acceptedAt)}
              {quote.convertedAt && <> · Converted: {fmtDate(quote.convertedAt)}</>}
            </div>
          </div>
          {quote.terms && (
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground">Terms</div>
              <div className="whitespace-pre-line">{quote.terms}</div>
            </div>
          )}
          {quote.notes && (
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground">Notes</div>
              <div className="whitespace-pre-line">{quote.notes}</div>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Line Items</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-1.5">Description</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Unit Price</th>
                <th className="text-right">VAT</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="py-2">{l.description}</td>
                  <td className="text-right">{Number(l.quantity)}</td>
                  <td className="text-right">{formatPeso(Number(l.unitPrice))}</td>
                  <td className="text-right">{formatPeso(Number(l.taxAmount))}</td>
                  <td className="text-right font-medium">{formatPeso(Number(l.lineTotal))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-1 text-sm border-t border-border pt-3">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatPeso(Number(quote.subtotal))}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>VAT</span>
            <span>{formatPeso(Number(quote.vatAmount))}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{formatPeso(Number(quote.totalAmount))}</span>
          </div>
        </div>
      </div>

      {convertOpen && (
        <ConvertDialog
          quote={quote}
          onClose={() => setConvertOpen(false)}
          onConverted={() => {
            setConvertOpen(false);
            qc.invalidateQueries({ queryKey: ['ar-quote', params.id] });
            qc.invalidateQueries({ queryKey: ['ar-quotes-list'] });
          }}
        />
      )}
    </div>
  );
}
