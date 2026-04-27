'use client';
import React, { useEffect } from 'react';
import { BookOpen, LayoutDashboard, ListOrdered, BookMarked, Zap, Banknote, CalendarClock, Scale, FileText, User, TrendingDown, TrendingUp, ShieldCheck, ClipboardCheck } from 'lucide-react';
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
const AP_ROLES         = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR'] as const;
const AR_ROLES         = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR'] as const;
const AUDIT_ROLES      = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR'] as const;
const EXPENSE_APPROVAL_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'FINANCE_LEAD', 'ACCOUNTANT'] as const;

function inLedgerRoles(role: string | undefined | null, set: readonly string[]) {
  return !!(role && set.includes(role));
}

/** Build a ledger nav item — always visible; grayed-out with lock if role lacks access. */
function makeLedgerNavItem(
  href: string, label: string, icon: React.ElementType,
  allowedRoles: readonly string[], role: string | undefined | null,
  extraCondition = true,
): NavItem {
  const hasAccess = extraCondition && inLedgerRoles(role, allowedRoles);
  return {
    href, label, icon,
    disabled: !hasAccess,
    disabledReason: !extraCondition
      ? 'Requires BIR registration — enable in Settings → BIR & Tax'
      : hasAccess ? undefined : 'Your role doesn\'t have access to this section',
  };
}

export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  const router         = useRouter();
  const { user, clear } = useAuthStore();
  const isBirRegistered = user?.isBirRegistered ?? false;
  const role           = user?.role;

  // Set accent on <html> so Radix Dialog portals (rendered at document.body)
  // also inherit the correct --accent value.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent',      LEDGER_ACCENT);
    root.style.setProperty('--accent-soft', LEDGER_ACCENT_SOFT);
    return () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
    };
  }, []);

  async function handleLogout() {
    const refresh = localStorage.getItem('app-auth');
    if (refresh) { try { await api.post('/auth/logout', { refreshToken: refresh }); } catch {} }
    clear();
    document.cookie = 'app-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    router.push('/login');
  }

  // All ledger nav items are shown to every Ledger user.
  // Items the current role cannot access appear grayed-out with a lock icon.
  // The BIR Tax item also requires isBirRegistered — shown grayed out with a
  // setup hint when the tenant hasn't configured BIR registration yet.
  const navItems: NavItem[] = [
    makeLedgerNavItem('/ledger/dashboard',     'Dashboard',          LayoutDashboard, DASHBOARD_ROLES,  role),
    makeLedgerNavItem('/ledger/accounts',      'Chart of Accounts',  ListOrdered,     ACCOUNTS_ROLES,   role),
    makeLedgerNavItem('/ledger/trial-balance', 'Trial Balance',      Scale,           TRIAL_BAL_ROLES,  role),
    makeLedgerNavItem('/ledger/journal',       'Journal Entries',    BookMarked,      JOURNAL_ROLES,    role),
    makeLedgerNavItem('/ledger/events',        'Event Queue',        Zap,             EVENT_ROLES,      role),
    makeLedgerNavItem('/ledger/settlement',    'Settlement',         Banknote,        SETTLEMENT_ROLES, role),
    makeLedgerNavItem('/ledger/periods',       'Accounting Periods', CalendarClock,   PERIODS_ROLES,    role),
    makeLedgerNavItem('/ledger/bir',           'Tax Estimation',     FileText,        BIR_ROLES,        role, isBirRegistered),
    makeLedgerNavItem('/ledger/ap/expenses',   'Payables (AP)',      TrendingDown,    AP_ROLES,         role),
    makeLedgerNavItem('/ledger/ar/invoices',   'Receivables (AR)',   TrendingUp,      AR_ROLES,         role),
    makeLedgerNavItem('/ledger/audit',            'Audit Log',          ShieldCheck,     AUDIT_ROLES,             role),
    makeLedgerNavItem('/ledger/expense-approvals','Expense Approvals',  ClipboardCheck,  EXPENSE_APPROVAL_ROLES,  role),
  ].filter((item) => !item.disabled || item.disabledReason?.startsWith('Requires'));

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
