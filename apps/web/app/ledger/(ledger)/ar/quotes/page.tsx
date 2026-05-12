'use client';
/**
 * Sales Quotes list page.
 *
 * Quotes are pre-revenue: editing them does NOT touch the GL. They post
 * to the ledger only on conversion to an AR Invoice, which uses the
 * existing AR invoice path.
 *
 * Lifecycle visible here: DRAFT → SENT → ACCEPTED → CONVERTED (or
 * REJECTED / EXPIRED). Convert links the new invoice back via
 * convertedToInvoiceId; the badge shows the converted invoice number.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Plus, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';

type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

interface Customer { id: string; name: string }

interface Quote {
  id:           string;
  quoteNumber:  string;
  status:       QuoteStatus;
  quoteDate:    string;
  validUntil:   string;
  customerId:   string;
  customer:     { id: string; name: string };
  totalAmount:  string;
  convertedInvoice: { id: string; invoiceNumber: string } | null;
}

interface ListResponse {
  data:     Quote[];
  total:    number;
  page:     number;
  pageSize: number;
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
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ' +
  'focus:border-transparent transition-shadow';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function QuotesListPage() {
  const user = useAuthStore((s) => s.user);
  const [statusFilter, setStatusFilter]   = useState<QuoteStatus | ''>('');
  const [customerFilter, setCustomerFilter] = useState<string>('');

  const canWrite = user ? WRITE_ROLES.includes(user.role) : false;

  const params = new URLSearchParams();
  if (statusFilter)  params.set('status', statusFilter);
  if (customerFilter) params.set('customerId', customerFilter);

  const { data: list, isLoading } = useQuery<ListResponse>({
    queryKey: ['ar-quotes-list', statusFilter, customerFilter],
    queryFn:  () => api.get(`/ar/quotes?${params.toString()}`).then((r) => r.data),
    enabled:  !!user,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['ar-customers-list'],
    queryFn:  () => api.get('/ar/customers').then((r) => r.data?.data ?? r.data),
    enabled:  !!user,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileSignature className="w-6 h-6" /> Quotes
          </h1>
          <p className="text-sm text-muted-foreground">
            Sales quotes (Proforma / Estimate). No GL impact until converted to an AR Invoice.
          </p>
        </div>
        {canWrite && (
          <Link href="/ledger/ar/quotes/new"
            className="h-10 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Quote
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={INPUT_CLS} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | '')}>
          <option value="">All statuses</option>
          {(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'] as const).map((s) => (
            <option key={s} value={s}>{STATUS_BADGE[s].label}</option>
          ))}
        </select>
        <select className={INPUT_CLS} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Quote #</th>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Customer</th>
              <th className="text-right px-4 py-2">Total</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Valid Until</th>
              <th className="text-left px-4 py-2">Actions</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">Loading…</td></tr>
            ) : (list?.data ?? []).length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">
                No quotes yet. {canWrite && 'Click "New Quote" to create one.'}
              </td></tr>
            ) : (
              list!.data.map((q) => (
                <tr key={q.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/ledger/ar/quotes/${q.id}`} className="hover:underline">{q.quoteNumber}</Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(q.quoteDate)}</td>
                  <td className="px-4 py-2">{q.customer.name}</td>
                  <td className="px-4 py-2 text-right">{formatPeso(Number(q.totalAmount))}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[q.status].cls}`}>
                      {STATUS_BADGE[q.status].label}
                    </span>
                    {q.status === 'CONVERTED' && q.convertedInvoice && (
                      <span className="ml-2 text-xs text-muted-foreground">→ {q.convertedInvoice.invoiceNumber}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(q.validUntil)}</td>
                  <td className="px-4 py-2">
                    <Link href={`/ledger/ar/quotes/${q.id}`} className="text-[var(--accent)] hover:underline text-xs">
                      Open
                    </Link>
                  </td>
                  <td className="px-2"><ChevronRight className="w-4 h-4 text-muted-foreground" /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
