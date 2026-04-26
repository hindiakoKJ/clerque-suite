'use client';
import type React from 'react';
import { BookOpen, LayoutDashboard, ListOrdered, BookMarked, Zap, Banknote, CalendarClock, Scale, FileText, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

const LEDGER_ACCENT      = 'hsl(173 70% 40%)';
const LEDGER_ACCENT_SOFT = 'hsl(173 70% 40% / 0.08)';

// ── SOD Ledger Nav Role Sets ────────────────────────────────────────────────
// Each role sees only the ledger sections relevant to their function.
// Bookkeeper: journal entries + trial balance, but NOT period management.
// Finance Lead: everything except journal entry creation.
// AR/AP Accountant: settlement + ledger view (no period close, no journal write).
// External Auditor: read-only — sees dashboard, accounts, trial balance only.
const DASHBOARD_ROLES  = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT', 'EXTERNAL_AUDITOR'] as const;
const ACCOUNTS_ROLES   = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR'] as const;
const TRIAL_BAL_ROLES  = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR'] as const;
const JOURNAL_ROLES    = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER'] as const;
const EVENT_ROLES      = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT'] as const;
const SETTLEMENT_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT'] as const;
const PERIODS_ROLES    = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD'] as const;
const BIR_ROLES        = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD'] as const;

function inLedgerRoles(role: string | undefined | null, set: readonly string[]) {
  return !!(role && set.includes(role));
}

export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  const router         = useRouter();
  const { user, clear } = useAuthStore();
  const isBirRegistered = user?.isBirRegistered ?? false;
  const role           = user?.role;

  async function handleLogout() {
    const refresh = localStorage.getItem('app-auth');
    if (refresh) { try { await api.post('/auth/logout', { refreshToken: refresh }); } catch {} }
    clear();
    document.cookie = 'app-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    router.push('/login');
  }

  const navItems: NavItem[] = [
    ...(inLedgerRoles(role, DASHBOARD_ROLES)  ? [{ href: '/ledger/dashboard',     label: 'Dashboard',          icon: LayoutDashboard }] : []),
    ...(inLedgerRoles(role, ACCOUNTS_ROLES)   ? [{ href: '/ledger/accounts',      label: 'Chart of Accounts',  icon: ListOrdered }]     : []),
    ...(inLedgerRoles(role, TRIAL_BAL_ROLES)  ? [{ href: '/ledger/trial-balance', label: 'Trial Balance',      icon: Scale }]           : []),
    ...(inLedgerRoles(role, JOURNAL_ROLES)    ? [{ href: '/ledger/journal',       label: 'Journal Entries',    icon: BookMarked }]      : []),
    ...(inLedgerRoles(role, EVENT_ROLES)      ? [{ href: '/ledger/events',        label: 'Event Queue',        icon: Zap }]             : []),
    ...(inLedgerRoles(role, SETTLEMENT_ROLES) ? [{ href: '/ledger/settlement',    label: 'Settlement',         icon: Banknote }]        : []),
    ...(inLedgerRoles(role, PERIODS_ROLES)    ? [{ href: '/ledger/periods',       label: 'Accounting Periods', icon: CalendarClock }]   : []),
    ...(isBirRegistered && inLedgerRoles(role, BIR_ROLES) ? [{ href: '/ledger/bir', label: 'Tax Estimation', icon: FileText }] : []),
  ];

  return (
    <div
      style={{
        '--accent':      LEDGER_ACCENT,
        '--accent-soft': LEDGER_ACCENT_SOFT,
      } as React.CSSProperties}
    >
      <AppShell
        navItems={navItems}
        logoIcon={BookOpen}
        appName="Ledger"
        onSignOut={handleLogout}
        headerRight={
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary rounded-md px-2.5 py-1.5">
            <User className="h-3.5 w-3.5" />
            <span className="max-w-[80px] truncate">{user?.name || 'User'}</span>
          </div>
        }
      >
        {children}
      </AppShell>
    </div>
  );
}
