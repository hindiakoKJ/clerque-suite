'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  BookOpen, Lock, ShieldAlert, Shield, ChevronRight, Search,
  Download, Upload,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { downloadAuthFile } from '@/lib/utils';
import { ImportModal } from '@/components/ui/ImportModal';

type AccountType    = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
type PostingControl = 'OPEN' | 'AP_ONLY' | 'AR_ONLY' | 'SYSTEM_ONLY';

interface Account {
  id:             string;
  code:           string;
  name:           string;
  type:           AccountType;
  normalBalance:  'DEBIT' | 'CREDIT';
  postingControl: PostingControl;
  isSystem:       boolean;
  isActive:       boolean;
  description:    string | null;
  parent:         { code: string; name: string } | null;
}

const TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

const TYPE_CONFIG: Record<AccountType, { label: string; color: string }> = {
  ASSET:     { label: 'Assets',      color: 'text-blue-600 bg-blue-500/10 border-blue-400/20' },
  LIABILITY: { label: 'Liabilities', color: 'text-rose-600 bg-rose-500/10 border-rose-400/20' },
  EQUITY:    { label: 'Equity',      color: 'text-purple-600 bg-purple-500/10 border-purple-400/20' },
  REVENUE:   { label: 'Revenue',     color: 'text-green-600 bg-green-500/10 border-green-400/20' },
  EXPENSE:   { label: 'Expenses',    color: 'text-amber-600 bg-amber-500/10 border-amber-400/20' },
};

const CTRL_CONFIG: Record<PostingControl, { label: string; Icon: React.ElementType; color: string; tip: string }> = {
  OPEN:        { label: 'Open',    Icon: BookOpen,    color: 'text-[var(--accent)] bg-[var(--accent-soft)]',      tip: 'Manual journal entries allowed' },
  AP_ONLY:     { label: 'AP Only', Icon: ShieldAlert, color: 'text-amber-600 bg-amber-500/10',    tip: 'Only the AP module may post here (Phase 4)' },
  AR_ONLY:     { label: 'AR Only', Icon: ShieldAlert, color: 'text-sky-600 bg-sky-500/10',        tip: 'Only the AR module may post here (Phase 5)' },
  SYSTEM_ONLY: { label: 'System',  Icon: Lock,        color: 'text-muted-foreground bg-muted/60', tip: 'Posted automatically by the event queue only' },
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function AccountsPage() {
  const router       = useRouter();
  const user         = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.isSuperAdmin;
  const queryClient  = useQueryClient();

  const [search,      setSearch]      = useState('');
  const [filterType,  setFilterType]  = useState<AccountType | ''>('');
  const [filterCtrl,  setFilterCtrl]  = useState<PostingControl | ''>('');
  const [showImport,  setShowImport]  = useState(false);
  const [exporting,   setExporting]   = useState(false);

  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounting/accounts').then((r) => r.data),
  });

  async function handleExport() {
    setExporting(true);
    try {
      const url      = `${API_URL}/api/v1/export/chart-of-accounts`;
      const filename = `chart-of-accounts-${new Date().toISOString().slice(0, 10)}.xlsx`;
      await downloadAuthFile(url, filename);
    } finally {
      setExporting(false);
    }
  }

  const filtered = accounts.filter((a) => {
    if (!a.isActive) return false;
    if (filterType && a.type !== filterType) return false;
    if (filterCtrl && a.postingControl !== filterCtrl) return false;
    if (search) {
      const q = search.toLowerCase();
      return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    }
    return true;
  });

  const grouped = TYPE_ORDER.reduce<Record<AccountType, Account[]>>((acc, t) => {
    acc[t] = filtered.filter((a) => a.type === t);
    return acc;
  }, {} as Record<AccountType, Account[]>);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Chart of Accounts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {accounts.filter((a) => a.isActive).length} active accounts
            {isSuperAdmin && <span className="ml-2 text-amber-500 font-medium">· Super Admin view</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            Import COA
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || isLoading}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? 'Exporting…' : 'Export .xlsx'}
          </button>
        </div>
      </div>

      {/* Context notice */}
      {isSuperAdmin ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm flex items-start gap-2 text-amber-700 dark:text-amber-400">
          <Shield className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Super Admin mode — </span>
            Account structure changes (add / rename / posting control) go through the admin panel.
            System accounts <Lock className="w-3 h-3 inline" /> cannot be deleted or have their posting control changed.
          </span>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground flex items-start gap-2">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            COA structure is managed by the platform administrator. Accounts marked{' '}
            <span className="font-medium text-[var(--accent)]">Open</span> can be used in manual journal entries.
          </span>
        </div>
      )}

      {/* Posting control legend */}
      <div className="flex flex-wrap gap-2">
        {(Object.entries(CTRL_CONFIG) as [PostingControl, typeof CTRL_CONFIG[PostingControl]][]).map(([key, cfg]) => (
          <span
            key={key}
            title={cfg.tip}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border border-transparent cursor-help ${cfg.color}`}
          >
            <cfg.Icon className="w-3 h-3" />
            {cfg.label} — {cfg.tip}
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            className="h-9 pl-8 pr-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="Search code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as AccountType | '')}
        >
          <option value="">All Types</option>
          {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_CONFIG[t].label}</option>)}
        </select>
        <select
          className="h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          value={filterCtrl}
          onChange={(e) => setFilterCtrl(e.target.value as PostingControl | '')}
        >
          <option value="">All Posting Controls</option>
          {(Object.keys(CTRL_CONFIG) as PostingControl[]).map((k) => (
            <option key={k} value={k}>{CTRL_CONFIG[k].label}</option>
          ))}
        </select>
      </div>

      {/* Account groups */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading chart of accounts…</div>
      ) : (
        <div className="space-y-6">
          {TYPE_ORDER.map((type) => {
            const rows = grouped[type];
            if (!rows.length) return null;
            const cfg = TYPE_CONFIG[type];
            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.color}`}>
                    {cfg.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{rows.length} accounts</span>
                </div>
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase">
                        <th className="px-4 py-2.5 text-left font-semibold w-20">Code</th>
                        <th className="px-4 py-2.5 text-left font-semibold">Name</th>
                        <th className="px-4 py-2.5 text-left font-semibold hidden md:table-cell">Normal Balance</th>
                        <th className="px-4 py-2.5 text-left font-semibold">Posting Control</th>
                        <th className="px-4 py-2.5 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((acct) => {
                        const ctrl = CTRL_CONFIG[acct.postingControl];
                        return (
                          <tr
                            key={acct.id}
                            onClick={() => router.push(`/ledger/accounts/${acct.id}`)}
                            className="hover:bg-muted/30 cursor-pointer transition-colors"
                          >
                            <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{acct.code}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-foreground">{acct.name}</span>
                                {acct.isSystem && (
                                  <span title="System account — cannot be deleted"><Lock className="w-3 h-3 text-muted-foreground/40" /></span>
                                )}
                              </div>
                              {acct.parent && (
                                <p className="text-xs text-muted-foreground mt-0.5">{acct.parent.code} — {acct.parent.name}</p>
                              )}
                            </td>
                            <td className="px-4 py-2.5 hidden md:table-cell text-xs text-muted-foreground">
                              {acct.normalBalance}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${ctrl.color}`}>
                                <ctrl.Icon className="w-3 h-3" />
                                {ctrl.label}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              <ChevronRight className="w-4 h-4" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ImportModal
        open={showImport}
        title="Import Chart of Accounts"
        description="Upload your existing COA to add or update accounts. System accounts are protected and cannot be overwritten. New accounts are created with Open posting control."
        templateUrl="/api/v1/import/template/chart-of-accounts"
        uploadUrl="/import/chart-of-accounts"
        onClose={() => setShowImport(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['accounts'] });
          setShowImport(false);
        }}
      />
    </div>
  );
}
