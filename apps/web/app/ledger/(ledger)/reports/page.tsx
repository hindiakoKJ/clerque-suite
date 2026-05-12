'use client';

/**
 * Reports Hub — Sprint 21.
 *
 * Single discovery + launch surface for every XLSX-exportable Ledger report.
 * Each card holds the inline filters the report needs (date picker, range,
 * account/customer/vendor dropdown, status select) plus an "Export XLSX"
 * button that streams the file via the `downloadAuthFile` helper.
 *
 * Permission + plan-feature gating:
 *   - Role-gating: each report carries a `roles: string[]` list; we render
 *     the card only if `user.role` is in that list. (Backend still enforces
 *     via @Roles decorators; this is purely cosmetic.)
 *   - Plan-gating: reports gated by a plan feature carry `planFeature:
 *     'birForms' | 'auditLog'`. When the tenant's plan doesn't include the
 *     feature, the card renders in a locked state with upsell copy.
 *
 * To add a new report after this commit: add an entry to REPORTS below.
 * No new download code needed.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileBarChart, Download, Lock, ChevronDown,
  TrendingUp, BookOpen, Users as UsersIcon, ShoppingBag, Banknote, FileText, Activity,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { downloadAuthFile } from '@/lib/utils';

// ─── Report registry ──────────────────────────────────────────────────────

type FilterKind =
  | 'asOf'             // single date — defaults to today
  | 'dateRange'        // from + to — defaults to month-to-date
  | 'dateRangeStatus'  // from + to + status
  | 'yearQuarter'      // year + quarter
  | 'customerId'       // dropdown of AR customers + date range
  | 'vendorId'         // dropdown of AP vendors + date range
  | 'accountId'        // dropdown of bank/cash accounts + asOf
  | 'periodId'         // dropdown of accounting periods
  | 'none';            // no filter

interface ReportDef {
  id:           string;                      // matches backend endpoint suffix
  name:         string;
  desc:         string;
  filter:       FilterKind;
  roles:        readonly string[];           // allowed roles
  planFeature?: 'birForms' | 'auditLog';     // optional plan-feature gate
  section:     'Financial Statements' | 'General Ledger' | 'AR' | 'AP' | 'Bank & Cash' | 'BIR & Compliance' | 'Operations';
}

const BASE        = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT'] as const;
const AR_ROLES    = [...BASE, 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR'] as const;
const AP_ROLES    = [...BASE, 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR'] as const;
const READ_ALL    = [...BASE, 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR'] as const;
// P&L and Cash Flow are management-sensitive — Bookkeeper excluded (SOD).
const MGMT_VIEW   = [...BASE, 'FINANCE_LEAD', 'EXTERNAL_AUDITOR'] as const;

const REPORTS: ReportDef[] = [
  // ── Financial Statements ─────────────────────────────────────────────────
  { id: 'trial-balance',       name: 'Trial Balance',          desc: 'Account balances at a point in time. The starting point of every audit.', filter: 'asOf',       roles: READ_ALL, section: 'Financial Statements' },
  { id: 'pl-summary',          name: 'Income Statement (P&L)', desc: 'Revenue vs expenses for the period. Net income trend.',                     filter: 'dateRange',  roles: MGMT_VIEW, section: 'Financial Statements' },
  { id: 'balance-sheet',       name: 'Balance Sheet',          desc: 'Assets, liabilities, and equity at a point in time.',                        filter: 'asOf',       roles: MGMT_VIEW, section: 'Financial Statements' },
  { id: 'cash-flow',           name: 'Cash Flow Statement',    desc: 'Operating, investing, financing cash movements for the period.',            filter: 'dateRange',  roles: MGMT_VIEW, section: 'Financial Statements' },

  // ── General Ledger ───────────────────────────────────────────────────────
  { id: 'chart-of-accounts',   name: 'Chart of Accounts',      desc: 'Full account master with codes, types, and posting controls.',              filter: 'none',       roles: READ_ALL, section: 'General Ledger' },
  { id: 'journal',             name: 'Journal Entries',        desc: 'All posted JEs with debits, credits, and references.',                      filter: 'dateRangeStatus', roles: BASE, section: 'General Ledger' },
  { id: 'journal-templates',   name: 'Journal Templates',      desc: 'Recurring JE patterns and next-run schedules.',                              filter: 'none',       roles: BASE, section: 'General Ledger' },

  // ── Accounts Receivable ──────────────────────────────────────────────────
  { id: 'ar-invoice-register', name: 'AR Invoice Register',    desc: 'All AR invoices in the period with status and balances.',                   filter: 'dateRangeStatus', roles: AR_ROLES, section: 'AR' },
  { id: 'ar-aging',            name: 'AR Aging',               desc: 'Outstanding receivables bucketed by age (1-30, 31-60, 61-90, 90+).',        filter: 'none',       roles: AR_ROLES, section: 'AR' },
  { id: 'ar-customer-statement', name: 'AR Customer Statement', desc: 'Per-customer invoice + payment history for the period.',                 filter: 'customerId', roles: AR_ROLES, section: 'AR' },
  { id: 'ar-payments',         name: 'AR Payments Received',   desc: 'All payments collected from customers in the period.',                       filter: 'dateRange',  roles: AR_ROLES, section: 'AR' },

  // ── Accounts Payable ─────────────────────────────────────────────────────
  { id: 'ap-bill-register',    name: 'AP Bill Register',       desc: 'All vendor bills in the period with status, WHT, and balances.',            filter: 'dateRangeStatus', roles: AP_ROLES, section: 'AP' },
  { id: 'ap-aging',            name: 'AP Aging',               desc: 'Outstanding payables bucketed by age (1-30, 31-60, 61-90, 90+).',           filter: 'none',       roles: AP_ROLES, section: 'AP' },
  { id: 'ap-vendor-statement', name: 'AP Vendor Statement',    desc: 'Per-vendor bill + payment history for the period.',                          filter: 'vendorId',   roles: AP_ROLES, section: 'AP' },
  { id: 'ap-payments',         name: 'AP Payments Made',       desc: 'All payments to vendors in the period, with WHT breakdown.',                filter: 'dateRange',  roles: AP_ROLES, section: 'AP' },
  { id: 'ap-expenses',         name: 'AP Expenses Register',   desc: 'Simple expense entries (non-bill) — utilities, rent, supplies.',           filter: 'dateRange',  roles: AP_ROLES, section: 'AP' },
  { id: 'expense-claims',      name: 'Expense Claims',         desc: 'Employee reimbursements: submitted, approved, paid.',                       filter: 'dateRangeStatus', roles: AP_ROLES, section: 'AP' },

  // ── Bank & Cash ──────────────────────────────────────────────────────────
  { id: 'bank-reconciliation', name: 'Bank Reconciliation',    desc: 'Matched and unmatched items for the chosen bank account.',                  filter: 'accountId',  roles: BASE, section: 'Bank & Cash' },
  { id: 'settlement-batches',  name: 'Settlement Batches',     desc: 'E-wallet / QR-PH / Maya batches grouped for bank deposit.',                 filter: 'dateRange',  roles: BASE, section: 'Bank & Cash' },
  { id: 'cash-position',       name: 'Cash Position',          desc: 'All cash + bank account balances at a point in time.',                       filter: 'asOf',       roles: READ_ALL, section: 'Bank & Cash' },

  // ── BIR & Compliance ─────────────────────────────────────────────────────
  { id: 'bir-2550q', name: 'BIR 2550Q (VAT Return)',       desc: 'Quarterly VAT return — output VAT, input VAT, net payable.',           filter: 'yearQuarter', roles: BASE, planFeature: 'birForms', section: 'BIR & Compliance' },
  { id: 'bir-1701q', name: 'BIR 1701Q (Income Tax)',       desc: 'Quarterly income tax return for self-employed / sole prop.',           filter: 'yearQuarter', roles: BASE, planFeature: 'birForms', section: 'BIR & Compliance' },
  { id: 'bir-2551q', name: 'BIR 2551Q (Percentage Tax)',   desc: 'Quarterly percentage tax for NON_VAT registered tenants.',              filter: 'yearQuarter', roles: BASE, planFeature: 'birForms', section: 'BIR & Compliance' },
  { id: 'bir-2316',  name: 'BIR 2316 Alphalist',           desc: 'Annual compensation alphalist for payroll — BIR upload-ready.',         filter: 'yearQuarter', roles: ['BUSINESS_OWNER', 'SUPER_ADMIN', 'PAYROLL_MASTER', 'ACCOUNTANT'] as const, planFeature: 'birForms', section: 'BIR & Compliance' },
  { id: 'z-read-history', name: 'Z-Read History',          desc: 'Daily Z-Read closing summaries for BIR CAS compliance.',                filter: 'dateRange',    roles: BASE, section: 'BIR & Compliance' },
  { id: 'audit-log', name: 'Audit Log',                    desc: 'Immutable trail of sensitive actions (price changes, role updates, etc).', filter: 'dateRange', roles: READ_ALL, planFeature: 'auditLog', section: 'BIR & Compliance' },

  // ── Operations ───────────────────────────────────────────────────────────
  { id: 'accounting-events',     name: 'Accounting Events',     desc: 'POS → GL event queue: created, synced, failed.',                       filter: 'dateRangeStatus', roles: READ_ALL, section: 'Operations' },
  { id: 'period-close-summary',  name: 'Period Close Summary',  desc: 'Closing checklist + per-account balances at period end.',              filter: 'periodId',  roles: BASE, section: 'Operations' },
  { id: 'ledger-kpi-snapshot',   name: 'Ledger KPI Snapshot',   desc: 'Event lag, DSO/DPO, void rate, period-close age — single-sheet.',     filter: 'asOf',      roles: READ_ALL, section: 'Operations' },
];

const SECTION_ORDER: ReportDef['section'][] = [
  'Financial Statements', 'General Ledger', 'AR', 'AP', 'Bank & Cash', 'BIR & Compliance', 'Operations',
];
const SECTION_ICONS: Record<ReportDef['section'], React.ElementType> = {
  'Financial Statements': TrendingUp,
  'General Ledger':       BookOpen,
  'AR':                   UsersIcon,
  'AP':                   ShoppingBag,
  'Bank & Cash':          Banknote,
  'BIR & Compliance':     FileText,
  'Operations':           Activity,
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
};

interface CustomerOpt { id: string; name: string; }
interface VendorOpt   { id: string; name: string; }
interface AccountOpt  { id: string; code: string; name: string; }
interface PeriodOpt   { id: string; name: string; }

// ─── Report card ──────────────────────────────────────────────────────────

function ReportCard({
  report, customers, vendors, accounts, periods,
}: {
  report:   ReportDef;
  customers: CustomerOpt[];
  vendors:   VendorOpt[];
  accounts:  AccountOpt[];
  periods:   PeriodOpt[];
}) {
  const Icon = SECTION_ICONS[report.section];
  const [asOf, setAsOf]   = useState(todayIso());
  const [from, setFrom]   = useState(monthStartIso());
  const [to, setTo]       = useState(todayIso());
  const [status, setStatus] = useState('');
  const [year, setYear]   = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState('1');
  const [refId, setRefId] = useState(''); // customerId, vendorId, accountId, periodId
  const [busy, setBusy]   = useState(false);

  async function download() {
    setBusy(true);
    try {
      const q = new URLSearchParams();
      let path = `/export/${report.id}`;
      let filenameStem = report.id;

      switch (report.filter) {
        case 'asOf':
          q.set('asOf', asOf);
          filenameStem = `${report.id}-${asOf}`;
          break;
        case 'dateRange':
          q.set('from', from); q.set('to', to);
          filenameStem = `${report.id}-${from}_to_${to}`;
          break;
        case 'dateRangeStatus':
          q.set('from', from); q.set('to', to);
          if (status) q.set('status', status);
          filenameStem = `${report.id}-${from}_to_${to}`;
          break;
        case 'yearQuarter':
          q.set('year', year);
          if (report.id !== 'bir-2316') q.set('quarter', quarter);
          filenameStem = `${report.id}-${year}${report.id === 'bir-2316' ? '' : `-Q${quarter}`}`;
          break;
        case 'customerId':
        case 'vendorId':
        case 'accountId':
          if (!refId) { toast.error('Pick an option first.'); setBusy(false); return; }
          path = `/export/${report.id}/${refId}`;
          if (report.filter === 'accountId') q.set('asOf', asOf);
          else { q.set('from', from); q.set('to', to); }
          filenameStem = `${report.id}-${refId}-${report.filter === 'accountId' ? asOf : `${from}_to_${to}`}`;
          break;
        case 'periodId':
          if (!refId) { toast.error('Pick a period first.'); setBusy(false); return; }
          q.set('periodId', refId);
          filenameStem = `${report.id}-${refId}`;
          break;
      }
      const qs = q.toString();
      const url = qs ? `${path}?${qs}` : path;
      await downloadAuthFile(url, `${filenameStem}.xlsx`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Download failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Icon className="h-5 w-5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground leading-tight">{report.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{report.desc}</p>
        </div>
      </div>

      {/* Inline filters per report.filter type */}
      <div className="flex flex-wrap gap-2">
        {report.filter === 'asOf' && (
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
            className="text-xs px-2 py-1 border border-border rounded bg-background" />
        )}
        {(report.filter === 'dateRange' || report.filter === 'dateRangeStatus') && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background" />
            <span className="text-xs text-muted-foreground self-center">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background" />
            {report.filter === 'dateRangeStatus' && (
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="text-xs px-2 py-1 border border-border rounded bg-background">
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="POSTED">Posted</option>
                <option value="OPEN">Open</option>
                <option value="PAID">Paid</option>
                <option value="VOIDED">Voided</option>
                <option value="SYNCED">Synced</option>
                <option value="FAILED">Failed</option>
              </select>
            )}
          </>
        )}
        {report.filter === 'yearQuarter' && (
          <>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} min="2020" max="2099"
              className="text-xs px-2 py-1 border border-border rounded bg-background w-20" />
            {report.id !== 'bir-2316' && (
              <select value={quarter} onChange={(e) => setQuarter(e.target.value)}
                className="text-xs px-2 py-1 border border-border rounded bg-background">
                <option value="1">Q1</option><option value="2">Q2</option>
                <option value="3">Q3</option><option value="4">Q4</option>
              </select>
            )}
          </>
        )}
        {report.filter === 'customerId' && (
          <>
            <select value={refId} onChange={(e) => setRefId(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background min-w-[140px]">
              <option value="">— Pick a customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background" />
            <span className="text-xs text-muted-foreground self-center">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background" />
          </>
        )}
        {report.filter === 'vendorId' && (
          <>
            <select value={refId} onChange={(e) => setRefId(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background min-w-[140px]">
              <option value="">— Pick a vendor —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background" />
            <span className="text-xs text-muted-foreground self-center">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background" />
          </>
        )}
        {report.filter === 'accountId' && (
          <>
            <select value={refId} onChange={(e) => setRefId(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background min-w-[140px]">
              <option value="">— Pick an account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
              className="text-xs px-2 py-1 border border-border rounded bg-background" />
          </>
        )}
        {report.filter === 'periodId' && (
          <select value={refId} onChange={(e) => setRefId(e.target.value)}
            className="text-xs px-2 py-1 border border-border rounded bg-background min-w-[200px]">
            <option value="">— Pick a period —</option>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      <button onClick={download} disabled={busy}
        className="flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded text-white disabled:opacity-50 mt-auto"
        style={{ background: 'var(--accent)' }}>
        <Download className="h-3 w-3" /> {busy ? 'Generating…' : 'Export XLSX'}
      </button>
    </div>
  );
}

function LockedCard({ report, reason }: { report: ReportDef; reason: string }) {
  return (
    <div className="bg-card border border-dashed border-border rounded-xl p-4 opacity-60">
      <div className="flex items-start gap-2 mb-2">
        <Lock className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground leading-tight">{report.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{report.desc}</p>
        </div>
      </div>
      <p className="text-[11px] text-amber-600 mt-2">{reason}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function ReportsHubPage() {
  const { user } = useAuthStore();

  // Helpful dropdown data (cached)
  const { data: customers = [] } = useQuery<CustomerOpt[]>({
    queryKey: ['ar-customers-min'],
    queryFn:  () => api.get('/ar/customers?take=500').then((r) => Array.isArray(r.data) ? r.data : r.data?.data ?? []),
    enabled:  !!user,
    staleTime: 5 * 60_000,
  });
  const { data: vendors = [] } = useQuery<VendorOpt[]>({
    queryKey: ['ap-vendors-min'],
    queryFn:  () => api.get('/ap/vendors?take=500').then((r) => Array.isArray(r.data) ? r.data : r.data?.data ?? []),
    enabled:  !!user,
    staleTime: 5 * 60_000,
  });
  const { data: accounts = [] } = useQuery<AccountOpt[]>({
    queryKey: ['accounts-cash'],
    queryFn:  () => api.get('/accounting/accounts').then((r) =>
      (r.data ?? []).filter((a: { code: string; type: string }) =>
        a.type === 'ASSET' && (a.code.startsWith('101') || a.code.startsWith('102')),
      ),
    ),
    enabled:  !!user,
    staleTime: 5 * 60_000,
  });
  const { data: periods = [] } = useQuery<PeriodOpt[]>({
    queryKey: ['accounting-periods-min'],
    queryFn:  () => api.get('/accounting-periods').then((r) =>
      (r.data ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })),
    ),
    enabled:  !!user,
    staleTime: 5 * 60_000,
  });

  // Group reports by section, filtered by role + plan feature
  const grouped = SECTION_ORDER.map((section) => ({
    section,
    items: REPORTS
      .filter((r) => r.section === section)
      .map((r) => {
        const hasRole = !user?.role ? false : (r.roles as readonly string[]).includes(user.role);
        if (!hasRole) return null;
        // Plan-feature gate: locked card with upsell if feature absent
        if (r.planFeature && user?.planFeatures && !user.planFeatures[r.planFeature]) {
          return { def: r, locked: true as const, reason: `Locked — your plan does not include ${r.planFeature === 'birForms' ? 'BIR forms' : 'audit log'}. Upgrade to unlock.` };
        }
        return { def: r, locked: false as const };
      })
      .filter((x): x is { def: ReportDef; locked: false } | { def: ReportDef; locked: true; reason: string } => x !== null),
  })).filter((s) => s.items.length > 0);

  const totalVisible = grouped.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <FileBarChart className="h-5 w-5" style={{ color: 'var(--accent)' }} />
          Reports
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every Ledger feature, one click to Excel. {totalVisible} reports available to your role.
        </p>
      </div>

      <div className="flex-1 p-4 sm:p-6 space-y-8">
        {grouped.length === 0 && (
          <div className="text-center py-16 text-sm text-muted-foreground">
            No reports available for your role.
          </div>
        )}
        {grouped.map(({ section, items }) => {
          const Icon = SECTION_ICONS[section];
          return (
            <section key={section}>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {section}
                <span className="text-xs text-muted-foreground font-normal">· {items.length}</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((it) => it.locked
                  ? <LockedCard key={it.def.id} report={it.def} reason={it.reason} />
                  : <ReportCard key={it.def.id} report={it.def} customers={customers} vendors={vendors} accounts={accounts} periods={periods} />,
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
