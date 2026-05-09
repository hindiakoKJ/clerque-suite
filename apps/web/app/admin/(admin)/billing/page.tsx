'use client';
/**
 * Console → Subscription Billing
 *
 * Sprint 15 rewrite — reads from HNS Corp PH's own tenant data (Orders +
 * Customers + AR aging) instead of the deprecated SubscriptionInvoice
 * table. The actual billing happens via the platform-issue endpoint
 * (Order in HNS tenant + APBill in customer tenant atomically).
 *
 * Privacy invariant: this page only reads HNS Corp's own tenant data.
 * It does NOT read customer-tenant business financials.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Receipt, RefreshCw, AlertTriangle, Send, ExternalLink, Download,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { api } from '@/lib/api';

interface PlatformConfig {
  hnsTenantId: string | null;
  taxStatus:   string;
}

interface HnsOrder {
  id:             string;
  orderNumber:    string;
  status:         string;
  invoiceType:    string;
  totalAmount:    string;
  vatAmount:      string;
  dueDate:        string | null;
  completedAt:    string | null;
  createdAt:      string;
  customer:       { id: string; name: string } | null;
  items:          Array<{ productName: string; lineTotal: string }>;
}

interface Tenant {
  id:           string;
  name:         string;
  slug:         string;
  planCode:     string | null;
  taxStatus:    string;
  status:       string;
  isDemoTenant: boolean;
}

function fmtPeso(n: string | number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n));
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

export default function BillingPage() {
  const qc = useQueryClient();

  const { data: cfg } = useQuery<PlatformConfig>({
    queryKey: ['platform-config'],
    queryFn:  () => api.get('/admin/platform/config').then((r) => r.data),
  });

  const { data: ordersResp = { orders: [] }, refetch, isFetching } = useQuery<{ orders: HnsOrder[] }>({
    queryKey: ['platform-billing-orders'],
    queryFn:  () => api.get('/admin/platform/billing/orders').then((r) => r.data),
    enabled:  !!cfg?.hnsTenantId,
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['admin-tenants'],
    queryFn:  () => api.get('/admin/tenants').then((r) => r.data),
  });

  const [issuingTenantId, setIssuingTenantId] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: (tenantId: string) =>
      api.post(`/admin/platform/billing/issue/${tenantId}`).then((r) => r.data),
    onSuccess: (data: { hnsOrderNumber: string; customerBillNumber: string; totalAmount: number }) => {
      toast.success(`Issued ${data.hnsOrderNumber} (₱${data.totalAmount}) — customer bill ${data.customerBillNumber}`);
      qc.invalidateQueries({ queryKey: ['platform-billing-orders'] });
      setIssuingTenantId(null);
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message ?? 'Failed.');
      setIssuingTenantId(null);
    },
  });

  if (!cfg) {
    return <div className="p-6 text-sm text-muted-foreground">Loading platform config…</div>;
  }

  if (!cfg.hnsTenantId) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-base font-semibold">HNS Corp PH tenant not bootstrapped</h2>
          </div>
          <p className="text-sm">
            Subscription billing requires HNS Corp PH to be provisioned as a Clerque tenant first. Head to{' '}
            <Link href="/admin/settings" className="underline font-medium">Settings → Billing</Link> and click
            &ldquo;Provision HNS Corp PH tenant&rdquo;.
          </p>
        </div>
      </div>
    );
  }

  const orders = ordersResp.orders ?? [];
  const billables = tenants.filter((t) =>
    t.status === 'ACTIVE' &&
    t.planCode &&
    t.planCode !== 'ENTERPRISE' &&
    t.id !== cfg.hnsTenantId,
  );

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Receipt className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Subscription Billing</h1>
            <p className="text-xs text-muted-foreground">
              Billing data lives in HNS Corp PH&rsquo;s own tenant — Orders + AR. This is a read-only operational view.
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm border border-border hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">
        {/* Quick-issue panel: list of billable tenants with one-click "Issue" */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <header className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Issue subscription</h2>
              <p className="text-[11px] text-muted-foreground">Manually issue a bill for the current month. Auto-cron runs on the 1st.</p>
            </div>
            <span className="text-xs text-muted-foreground">{billables.length} active billable tenant{billables.length === 1 ? '' : 's'}</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Tenant</th>
                  <th className="text-left px-4 py-2 font-medium">Plan</th>
                  <th className="text-left px-4 py-2 font-medium">Tax status</th>
                  <th className="text-right px-4 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {billables.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No billable tenants.</td></tr>
                ) : billables.map((t) => (
                  <tr key={t.id} className="border-t border-border/60 hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{t.slug}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{t.planCode}</td>
                    <td className="px-4 py-2.5 text-xs">{t.taxStatus}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => { setIssuingTenantId(t.id); issue.mutate(t.id); }}
                        disabled={issue.isPending && issuingTenantId === t.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
                      >
                        <Send className="h-3 w-3" />
                        {issue.isPending && issuingTenantId === t.id ? 'Issuing…' : 'Issue this month'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Issued orders — read from HNS tenant */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Issued subscription invoices</h2>
            <p className="text-[11px] text-muted-foreground">Latest 200 CHARGE-type Orders from HNS Corp PH&rsquo;s POS.</p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Invoice #</th>
                  <th className="text-left px-4 py-2 font-medium">Customer (tenant)</th>
                  <th className="text-left px-4 py-2 font-medium">Items</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="text-right px-4 py-2 font-medium">VAT</th>
                  <th className="text-left px-4 py-2 font-medium">Issued</th>
                  <th className="text-left px-4 py-2 font-medium">Due</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">No subscriptions issued yet.</td></tr>
                ) : orders.map((o) => (
                  <tr key={o.id} className="border-t border-border/60 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono text-xs">{o.orderNumber}</td>
                    <td className="px-4 py-2.5">{o.customer?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {o.items.length === 1 ? o.items[0].productName : `${o.items.length} items`}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtPeso(o.totalAmount)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{fmtPeso(o.vatAmount)}</td>
                    <td className="px-4 py-2.5 text-xs">{fmtDate(o.completedAt ?? o.createdAt)}</td>
                    <td className="px-4 py-2.5 text-xs">{fmtDate(o.dueDate)}</td>
                    <td className="px-4 py-2.5">
                      <span className={
                        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ' +
                        (o.status === 'COMPLETED'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground')
                      }>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/admin/platform/billing/orders/${o.id}/receipt.pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Download className="h-3 w-3" /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <ExternalLink className="h-3 w-3" />
          To record customer payments, mark them paid on HNS Corp PH&rsquo;s tenant → Ledger → AR (the actual books).
        </p>
      </div>
    </div>
  );
}
