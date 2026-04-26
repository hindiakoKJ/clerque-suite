'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download, ChevronDown, ChevronRight, AlertTriangle, TableIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { downloadAuthFile } from '@/lib/utils';
import { ComingSoon } from '@/components/ui/ComingSoon';
import { toast } from 'sonner';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type Quarter = 1 | 2 | 3 | 4;

const QUARTER_LABELS: Record<Quarter, string> = {
  1: 'Q1 (Jan – Mar)',
  2: 'Q2 (Apr – Jun)',
  3: 'Q3 (Jul – Sep)',
  4: 'Q4 (Oct – Dec)',
};

function currentQuarter(): Quarter {
  return (Math.floor(new Date().getMonth() / 3) + 1) as Quarter;
}

function fmtPeso(n: number) {
  return `₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Sub-component: 2550Q section ────────────────────────────────────────────

interface Bir2550QResult {
  year: number; quarter: Quarter;
  periodFrom: string; periodTo: string;
  outputVat: number; inputVat: number; netVatPayable: number;
  accountingRows: { accountCode: string; accountName: string; debit: number; credit: number; balance: number }[];
}

function Section2550Q({ year, quarter }: { year: number; quarter: Quarter }) {
  const { data, isLoading, error } = useQuery<Bir2550QResult>({
    queryKey: ['bir-2550q', year, quarter],
    queryFn: () => api.get(`/bir/2550q?year=${year}&quarter=${quarter}`).then((r) => r.data),
  });

  function handleDownload() {
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `2550q-${year}-Q${quarter}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-foreground">BIR Form 2550Q — Quarterly VAT Return</h2>
          {data && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Period: {data.periodFrom} – {data.periodTo}
            </p>
          )}
        </div>
        <button
          onClick={handleDownload}
          disabled={!data}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" /> Export JSON
        </button>
      </div>

      {isLoading && (
        <div className="px-5 py-6 text-sm text-muted-foreground">Loading VAT data…</div>
      )}

      {error && (
        <div className="px-5 py-6 text-sm text-red-500">
          {(error as any)?.response?.data?.message ?? 'Failed to load 2550Q data.'}
        </div>
      )}

      {data && (
        <div className="p-5 space-y-4">
          {/* VAT summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-rose-500/5 border border-rose-400/20 p-3 text-center">
              <p className="text-[10px] font-semibold uppercase text-rose-500 tracking-wide">Output VAT</p>
              <p className="text-xl font-bold text-rose-600 dark:text-rose-400 mt-1">{fmtPeso(data.outputVat)}</p>
            </div>
            <div className="rounded-lg bg-blue-500/5 border border-blue-400/20 p-3 text-center">
              <p className="text-[10px] font-semibold uppercase text-blue-500 tracking-wide">Input VAT</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{fmtPeso(data.inputVat)}</p>
            </div>
            <div className={`rounded-lg p-3 text-center border ${
              data.netVatPayable >= 0
                ? 'bg-amber-500/5 border-amber-400/20'
                : 'bg-[var(--accent-soft)] border-[var(--accent)]/20'
            }`}>
              <p className={`text-[10px] font-semibold uppercase tracking-wide ${
                data.netVatPayable >= 0 ? 'text-amber-600' : 'text-[var(--accent)]'
              }`}>
                {data.netVatPayable >= 0 ? 'Net VAT Payable' : 'VAT Refundable'}
              </p>
              <p className={`text-xl font-bold mt-1 ${
                data.netVatPayable >= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--accent)]'
              }`}>
                {fmtPeso(Math.abs(data.netVatPayable))}
              </p>
            </div>
          </div>

          {/* Account breakdown */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                <th className="pb-2 text-left font-semibold">Account</th>
                <th className="pb-2 text-right font-semibold w-28">Debit</th>
                <th className="pb-2 text-right font-semibold w-28">Credit</th>
                <th className="pb-2 text-right font-semibold w-28">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.accountingRows.map((r) => (
                <tr key={r.accountCode}>
                  <td className="py-2">
                    <span className="font-mono text-xs text-muted-foreground">{r.accountCode}</span>
                    <span className="ml-2 text-foreground">{r.accountName}</span>
                  </td>
                  <td className="py-2 text-right font-mono text-sm">{r.debit > 0 ? fmtPeso(r.debit) : '—'}</td>
                  <td className="py-2 text-right font-mono text-sm">{r.credit > 0 ? fmtPeso(r.credit) : '—'}</td>
                  <td className="py-2 text-right font-mono text-sm font-semibold text-foreground">{fmtPeso(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: 1701Q section ────────────────────────────────────────────

interface Bir1701QResult {
  year: number; quarter: Quarter;
  periodFrom: string; periodTo: string;
  grossRevenue: number; totalExpenses: number; netIncome: number;
  revenueLines: { code: string; name: string; balance: number }[];
  expenseLines: { code: string; name: string; balance: number }[];
}

function Section1701Q({ year, quarter }: { year: number; quarter: Quarter }) {
  const [showRevenue, setShowRevenue] = useState(true);
  const [showExpenses, setShowExpenses] = useState(true);

  const { data, isLoading, error } = useQuery<Bir1701QResult>({
    queryKey: ['bir-1701q', year, quarter],
    queryFn: () => api.get(`/bir/1701q?year=${year}&quarter=${quarter}`).then((r) => r.data),
  });

  function handleDownload() {
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `1701q-${year}-Q${quarter}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-foreground">BIR Form 1701Q — Quarterly Income Tax Return</h2>
          {data && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Period: {data.periodFrom} – {data.periodTo}
            </p>
          )}
        </div>
        <button
          onClick={handleDownload}
          disabled={!data}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" /> Export JSON
        </button>
      </div>

      {isLoading && <div className="px-5 py-6 text-sm text-muted-foreground">Loading income data…</div>}
      {error && (
        <div className="px-5 py-6 text-sm text-red-500">
          {(error as any)?.response?.data?.message ?? 'Failed to load 1701Q data.'}
        </div>
      )}

      {data && (
        <div className="p-5 space-y-4">
          {/* P&L summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-green-500/5 border border-green-400/20 p-3 text-center">
              <p className="text-[10px] font-semibold uppercase text-green-600 tracking-wide">Gross Revenue</p>
              <p className="text-xl font-bold text-green-700 dark:text-green-400 mt-1">{fmtPeso(data.grossRevenue)}</p>
            </div>
            <div className="rounded-lg bg-rose-500/5 border border-rose-400/20 p-3 text-center">
              <p className="text-[10px] font-semibold uppercase text-rose-600 tracking-wide">Total Expenses</p>
              <p className="text-xl font-bold text-rose-700 dark:text-rose-400 mt-1">{fmtPeso(data.totalExpenses)}</p>
            </div>
            <div className={`rounded-lg p-3 text-center border ${
              data.netIncome >= 0
                ? 'bg-[var(--accent-soft)] border-[var(--accent)]/20'
                : 'bg-rose-500/5 border-rose-400/20'
            }`}>
              <p className={`text-[10px] font-semibold uppercase tracking-wide ${
                data.netIncome >= 0 ? 'text-[var(--accent)]' : 'text-rose-600'
              }`}>
                {data.netIncome >= 0 ? 'Net Income' : 'Net Loss'}
              </p>
              <p className={`text-xl font-bold mt-1 ${
                data.netIncome >= 0 ? 'text-[var(--accent)]' : 'text-rose-700 dark:text-rose-400'
              }`}>
                {fmtPeso(Math.abs(data.netIncome))}
              </p>
            </div>
          </div>

          {/* Revenue lines (collapsible) */}
          <div>
            <button
              onClick={() => setShowRevenue((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-semibold text-green-600 mb-2"
            >
              {showRevenue ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Revenue ({data.revenueLines.length} accounts)
            </button>
            {showRevenue && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {data.revenueLines.map((r) => (
                    <tr key={r.code}>
                      <td className="py-1.5 font-mono text-xs text-muted-foreground w-16">{r.code}</td>
                      <td className="py-1.5 text-foreground">{r.name}</td>
                      <td className="py-1.5 text-right font-mono text-sm font-medium text-green-600 w-28">{fmtPeso(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Expense lines (collapsible) */}
          <div>
            <button
              onClick={() => setShowExpenses((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-semibold text-rose-600 mb-2"
            >
              {showExpenses ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Expenses ({data.expenseLines.length} accounts)
            </button>
            {showExpenses && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {data.expenseLines.map((r) => (
                    <tr key={r.code}>
                      <td className="py-1.5 font-mono text-xs text-muted-foreground w-16">{r.code}</td>
                      <td className="py-1.5 text-foreground">{r.name}</td>
                      <td className="py-1.5 text-right font-mono text-sm font-medium text-rose-600 w-28">{fmtPeso(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: 2551Q section (Percentage Tax for NON_VAT tenants) ────────

interface Bir2551QResult {
  year: number; quarter: Quarter;
  periodFrom: string; periodTo: string;
  grossReceipts: number;
  percentageTaxRate: number;
  percentageTaxAmount: number;
  revenueLines: { code: string; name: string; balance: number }[];
}

function Section2551Q({ year, quarter }: { year: number; quarter: Quarter }) {
  const { data, isLoading, error } = useQuery<Bir2551QResult>({
    queryKey: ['bir-2551q', year, quarter],
    queryFn: () => api.get(`/bir/2551q?year=${year}&quarter=${quarter}`).then((r) => r.data),
  });

  function handleDownload() {
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `2551q-${year}-Q${quarter}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-foreground">BIR Form 2551Q — Quarterly Percentage Tax</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            3% Percentage Tax on gross receipts for non-VAT registered businesses
            {data && ` • Period: ${data.periodFrom} – ${data.periodTo}`}
          </p>
        </div>
        <button
          onClick={handleDownload}
          disabled={!data}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" /> Export JSON
        </button>
      </div>

      {isLoading && <div className="px-5 py-6 text-sm text-muted-foreground">Loading percentage tax data…</div>}
      {error && (
        <div className="px-5 py-6 text-sm text-red-500">
          {(error as any)?.response?.data?.message ?? 'Failed to load 2551Q data.'}
        </div>
      )}

      {data && (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-green-500/5 border border-green-400/20 p-3 text-center">
              <p className="text-[10px] font-semibold uppercase text-green-600 tracking-wide">Gross Receipts</p>
              <p className="text-xl font-bold text-green-700 dark:text-green-400 mt-1">{fmtPeso(data.grossReceipts)}</p>
            </div>
            <div className="rounded-lg bg-muted/30 border border-border p-3 text-center">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">Tax Rate</p>
              <p className="text-xl font-bold text-foreground mt-1">{(data.percentageTaxRate * 100).toFixed(0)}%</p>
            </div>
            <div className="rounded-lg bg-amber-500/5 border border-amber-400/20 p-3 text-center">
              <p className="text-[10px] font-semibold uppercase text-amber-600 tracking-wide">Tax Payable (Est.)</p>
              <p className="text-xl font-bold text-amber-700 dark:text-amber-400 mt-1">{fmtPeso(data.percentageTaxAmount)}</p>
            </div>
          </div>

          {data.revenueLines.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                  <th className="pb-2 text-left font-semibold">Revenue Account</th>
                  <th className="pb-2 text-right font-semibold w-32">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.revenueLines.map((r) => (
                  <tr key={r.code}>
                    <td className="py-2">
                      <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                      <span className="ml-2 text-foreground">{r.name}</span>
                    </td>
                    <td className="py-2 text-right font-mono text-sm font-medium text-green-600">{fmtPeso(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main BIR / Tax Estimation Guide Page ──────────────────────────────────────

export default function BirPage() {
  const { user } = useAuthStore();
  const [year,    setYear]    = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState<Quarter>(currentQuarter());
  const [csvFrom, setCsvFrom] = useState('');
  const [csvTo,   setCsvTo]   = useState('');
  const [csvLoading, setCsvLoading] = useState(false);

  const taxStatus = user?.taxStatus ?? 'UNREGISTERED';

  // Guard: show ComingSoon for non-BIR-registered tenants
  if (!user?.isBirRegistered) {
    return (
      <ComingSoon
        icon={FileText}
        feature="Tax Estimation Guide"
        eta="Available once BIR registration is enabled for your account"
        description="Tax estimation views (2550Q, 2551Q, 1701Q) and EIS e-invoicing are available for BIR-registered businesses. Contact your administrator to enable these features."
      />
    );
  }

  async function handleAccountantCsvDownload() {
    if (!csvFrom || !csvTo) {
      toast.error('Please select a date range for the export.');
      return;
    }
    setCsvLoading(true);
    try {
      await downloadAuthFile(
        `${API_URL}/export/accountant-csv?from=${csvFrom}&to=${csvTo}`,
        `accountant-export-${csvFrom}_to_${csvTo}.csv`,
      );
    } catch {
      toast.error('Failed to download accountant export.');
    } finally {
      setCsvLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Tax Estimation Guide</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pro-forma quarterly tax estimates based on your journal entries. For filing assistance only.
          </p>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value) as Quarter)}
            className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            {([1, 2, 3, 4] as Quarter[]).map((q) => (
              <option key={q} value={q}>{QUARTER_LABELS[q]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── PRO-FORMA WATERMARK BANNER ──────────────────────────────────────── */}
      <div className="rounded-xl border-2 border-amber-400/50 bg-amber-50 dark:bg-amber-950/20 px-5 py-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-800 dark:text-amber-300 text-sm uppercase tracking-wide">
              PRO-FORMA / ESTIMATE ONLY — NOT AN OFFICIAL BIR DOCUMENT
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
              All figures shown are computed estimates based on your journal entries.
              They do not constitute an official BIR filing.
              Consult your registered accountant before submitting any return to the BIR.
              Deductions, adjustments, and compliance requirements must be verified independently.
            </p>
          </div>
        </div>
      </div>

      {/* EIS notice */}
      <div className="rounded-xl border border-[var(--accent)]/20 bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent)]">
        <strong>EIS e-Invoice (per order):</strong> Open any journal entry linked to a completed sale and click{' '}
        <em>Download EIS Invoice</em> to generate the BIR-compliant JSON for that transaction.
        The file can be uploaded manually to the BIR EIS portal.
      </div>

      {/* Tax form section — shown based on taxStatus */}
      {taxStatus === 'VAT' && <Section2550Q year={year} quarter={quarter} />}
      {taxStatus === 'NON_VAT' && <Section2551Q year={year} quarter={quarter} />}

      {/* 1701Q — quarterly income tax for all BIR-registered tenants */}
      <Section1701Q year={year} quarter={quarter} />

      {/* ── Accountant Export CSV ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3 mb-4">
          <TableIcon className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-foreground text-sm">Accountant Export</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Download a CSV of all completed orders for a date range. Share with your accountant
              for manual filing assistance. Labeled as pro-forma — not an official BIR document.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">From</label>
            <input
              type="date"
              value={csvFrom}
              onChange={(e) => setCsvFrom(e.target.value)}
              className="h-9 px-3 w-full rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">To</label>
            <input
              type="date"
              value={csvTo}
              onChange={(e) => setCsvTo(e.target.value)}
              className="h-9 px-3 w-full rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <button
            onClick={handleAccountantCsvDownload}
            disabled={!csvFrom || !csvTo || csvLoading}
            className="h-9 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {csvLoading ? 'Downloading…' : 'Export CSV'}
          </button>
        </div>
      </div>

    </div>
  );
}
