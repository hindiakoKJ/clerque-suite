'use client';
/**
 * AR Invoice detail page (Sprint 22).
 *
 * Minimal detail view focused on the two new Sprint-22 actions:
 *   1. Download PDF (GET /ar/invoices/:id/pdf)
 *   2. Email to Customer (POST /ar/invoices/:id/email — confirm modal first,
 *      pre-fills customer.contactEmail)
 *
 * The summary card mirrors what the backend findOne() returns so the user
 * can verify what they're about to send before they click.
 */
import { useParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, Mail, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';

interface InvoiceLine {
  id:          string;
  description: string | null;
  quantity:    string;
  unitPrice:   string;
  lineTotal:   string;
  account:     { code: string; name: string };
}

interface InvoiceDetail {
  id:            string;
  invoiceNumber: string;
  reference:     string | null;
  status:        string;
  invoiceDate:   string;
  dueDate:       string;
  termsDays:     number;
  subtotal:      string;
  vatAmount:     string;
  totalAmount:   string;
  paidAmount:    string;
  balanceAmount: string;
  customer:      { id: string; name: string; contactEmail: string | null; tin: string | null; address: string | null };
  lines:         InvoiceLine[];
}

export default function ArInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id     = params.id;

  const { data: invoice, isLoading } = useQuery<InvoiceDetail>({
    queryKey: ['ar-invoice', id],
    queryFn:  () => api.get(`/ar/invoices/${id}`).then((r) => r.data),
    enabled:  Boolean(id),
  });

  const [emailOpen, setEmailOpen] = useState(false);
  const [recipient, setRecipient] = useState('');

  const downloadPdf = async () => {
    try {
      const res = await api.get(`/ar/invoices/${id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data as Blob], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice?.invoiceNumber ?? id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to download PDF.');
    }
  };

  const sendEmail = useMutation({
    mutationFn: () => api.post(`/ar/invoices/${id}/email`, { to: recipient }).then((r) => r.data),
    onSuccess:  (data) => {
      toast.success(`Invoice sent to ${data.recipient}`);
      setEmailOpen(false);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to send email.'),
  });

  const openEmailModal = () => {
    setRecipient(invoice?.customer?.contactEmail ?? '');
    setEmailOpen(true);
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading invoice…</div>;
  if (!invoice)  return <div className="p-6 text-sm text-destructive">Invoice not found.</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{invoice.invoiceNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {invoice.customer?.name} · {invoice.status}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={downloadPdf}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border bg-card hover:bg-accent text-sm"
          >
            <Download className="w-4 h-4" /> Download PDF
          </button>
          <button
            onClick={openEmailModal}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-sm"
          >
            <Mail className="w-4 h-4" /> Email to Customer
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Subtotal" value={formatPeso(Number(invoice.subtotal))} />
        <Stat label="VAT"      value={formatPeso(Number(invoice.vatAmount))} />
        <Stat label="Total"    value={formatPeso(Number(invoice.totalAmount))} />
        <Stat label="Balance"  value={formatPeso(Number(invoice.balanceAmount))} />
      </div>

      {/* Lines table */}
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Unit Price</th>
              <th className="text-right px-3 py-2">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2">{l.description || l.account.name}</td>
                <td className="px-3 py-2 text-right">{Number(l.quantity)}</td>
                <td className="px-3 py-2 text-right">{formatPeso(Number(l.unitPrice))}</td>
                <td className="px-3 py-2 text-right">{formatPeso(Number(l.lineTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Email confirm modal */}
      {emailOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEmailOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-background border rounded-lg shadow-lg w-full max-w-md p-5 space-y-4"
          >
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">Email Invoice</h2>
              <button onClick={() => setEmailOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="recipient-email">Recipient email</label>
              <input
                id="recipient-email"
                type="email"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={invoice.customer?.contactEmail ?? 'customer@example.com'}
                className="w-full px-3 py-2 border rounded-md text-sm bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Defaults to the customer's contact email. We'll attach the PDF rendering of {invoice.invoiceNumber}.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEmailOpen(false)}
                className="px-3 py-2 rounded-md border text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => sendEmail.mutate()}
                disabled={!recipient || sendEmail.isPending}
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
              >
                {sendEmail.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md p-3 bg-card">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
