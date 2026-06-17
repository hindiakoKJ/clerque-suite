'use client';
import React, { useEffect } from 'react';
import { BookOpen, LayoutDashboard, ListOrdered, BookMarked, Zap, Banknote, Landmark, CalendarClock, Scale, FileText, User, TrendingDown, TrendingUp, ShieldCheck, ClipboardCheck, Receipt, FileSpreadsheet, BarChart3, FileBarChart, FileSignature, Wallet } from 'lucide-react';
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
// Sprint 19 — Ledger role consolidation.
//
// Ledger is the back-office accounting plane. CASHIER / SALES_LEAD /
// CLERICAL roles never reach this app — they live in POS or Sync.
//
//   ACCOUNTING_LEAD  = Owner + Branch Manager + the senior accounting roles
//                      (Accountant, Bookkeeper, Finance Lead).
//                      Manager is here so they can see margins / AP / AR
//                      for branch oversight.
//   AR_TEAM / AP_TEAM = the specialist accountants + the leads above
//   AUDITOR_VIEW      = read-only; auditor + leads
//
// The previous ad-hoc lists (10+ variations) collapse into 4 tiers below.
const ACCOUNTING_LEAD = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER',
                         'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD'] as const;
const AR_TEAM         = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER',
                         'FINANCE_LEAD', 'AR_ACCOUNTANT'] as const;
const AP_TEAM         = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER',
                         'FINANCE_LEAD', 'AP_ACCOUNTANT'] as const;
const AUDITOR_VIEW    = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER',
                         'FINANCE_LEAD', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
                         'EXTERNAL_AUDITOR'] as const;
// Period close + JE post are sensitive — restrict to actual accountants.
const SENSITIVE_GL    = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT'] as const;

const DASHBOARD_ROLES  = AUDITOR_VIEW;
const ACCOUNTS_ROLES   = AUDITOR_VIEW;
const TRIAL_BAL_ROLES  = AUDITOR_VIEW;
const JOURNAL_ROLES    = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER'] as const;
const EVENT_ROLES      = SENSITIVE_GL;
const SETTLEMENT_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD',
                          'AR_ACCOUNTANT', 'AP_ACCOUNTANT'] as const;
const PERIODS_ROLES    = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD'] as const;
const BIR_ROLES        = ACCOUNTING_LEAD;
const AP_ROLES         = AP_TEAM;
const AR_ROLES         = AR_TEAM;
const AUDIT_ROLES      = AUDITOR_VIEW;
const EXPENSE_APPROVAL_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER',
                                'FINANCE_LEAD', 'ACCOUNTANT'] as const;

function inLedgerRoles(role: string | undefined | null, set: readonly string[]) {
  return !!(role && set.includes(role));
}

/** Build a ledger nav item — always visible; grayed-out with lock if role lacks access. */
function makeLedgerNavItem(
  href: string, label: string, icon: React.ElementType,
  allowedRoles: readonly string[], role: string | undefined | null,
  opts: { extraCondition?: boolean; sectionStart?: string; lockedReason?: string } = {},
): NavItem {
  const extraCondition = opts.extraCondition ?? true;
  const hasAccess = extraCondition && inLedgerRoles(role, allowedRoles);
  return {
    href, label, icon,
    sectionStart: opts.sectionStart,
    disabled: !hasAccess,
    disabledReason: !extraCondition
      ? (opts.lockedReason ?? 'Requires BIR registration — enable in Settings → BIR & Tax')
      : hasAccess ? undefined : 'Your role doesn\'t have access to this section',
  };
}

export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  const router         = useRouter();
  const { user, clear } = useAuthStore();
  const isBirRegistered = user?.isBirRegistered ?? false;
  const isFullLedger   = user?.planFeatures?.advancedAccounting ?? false;
  const role           = user?.role;

  // ── App-level guard ────────────────────────────────────────────────────────
  // KIOSK_DISPLAY accounts are kiosk-hardware credentials and never belong in
  // Ledger regardless of what their (potentially stale) UserAppAccess rows
  // say. Role check first; appAccess check second as a backstop for everyone
  // else who lacks Ledger.
  useEffect(() => {
    if (!user) return;
    if (user.role === 'KIOSK_DISPLAY') {
      router.replace('/pos/select-display');
      return;
    }
    const ledgerAccess = user.appAccess.find((a) => a.app === 'LEDGER');
    const hasLedger =
      ledgerAccess && ledgerAccess.level !== 'NONE';
    if (!hasLedger) {
      router.replace('/select');
    }
  }, [user, router]);

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
    // ── Overview ────────────────────────────────────────────────────────────
    makeLedgerNavItem('/ledger/dashboard',     'Dashboard',          LayoutDashboard, DASHBOARD_ROLES,  role,
      { sectionStart: 'Overview' }),

    // ── Receivables (sub-ledger) ────────────────────────────────────────────
    makeLedgerNavItem('/ledger/ar/quotes',     'Quotes',             FileSignature,   AR_ROLES,         role,
      { sectionStart: 'Receivables', extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    // Sprint 21 — clearer labels. Flow is Customer → Quote → Invoice →
    // Payment. "Customer Billing" was ambiguous; renamed to "Invoices"
    // which matches what people actually click for. POS-derived AR keeps
    // the POS-collections lens but with a label that says what it IS.
    makeLedgerNavItem('/ledger/ar/billing',    'Invoices',           FileSpreadsheet, AR_ROLES,         role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/ar/invoices',   'POS-derived AR',     TrendingUp,      AR_ROLES,         role),
    makeLedgerNavItem('/ledger/ar/advances',   'Customer Advances',  Wallet,          AR_ROLES,         role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),

    // ── Payables (sub-ledger) ───────────────────────────────────────────────
    makeLedgerNavItem('/ledger/ap/bills',      'Vendor Bills',       Receipt,         AP_ROLES,         role,
      { sectionStart: 'Payables', extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/ap/expenses',   'Expense Claims',     TrendingDown,    AP_ROLES,         role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/ap/advances',   'Vendor Advances',    Wallet,          AP_ROLES,         role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/expense-approvals', 'Expense Approvals', ClipboardCheck, EXPENSE_APPROVAL_ROLES, role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),

    // ── Cash & Bank ─────────────────────────────────────────────────────────
    makeLedgerNavItem('/ledger/settlement',    'Settlement',         Banknote,        SETTLEMENT_ROLES, role,
      { sectionStart: 'Cash & Bank' }),
    makeLedgerNavItem('/ledger/bank-recon',    'Bank Reconciliation', Landmark,       PERIODS_ROLES,    role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),

    // ── General Ledger ──────────────────────────────────────────────────────
    makeLedgerNavItem('/ledger/accounts',      'Chart of Accounts',  ListOrdered,     ACCOUNTS_ROLES,   role,
      { sectionStart: 'General Ledger', extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/journal',       'Journal Entries',    BookMarked,      JOURNAL_ROLES,    role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/events',        'Event Queue',        Zap,             EVENT_ROLES,      role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),

    // ── Period Close & Reports ──────────────────────────────────────────────
    makeLedgerNavItem('/ledger/periods',         'Accounting Periods', CalendarClock,   PERIODS_ROLES,    role,
      { sectionStart: 'Period & Reports', extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/trial-balance',   'Trial Balance',      Scale,           TRIAL_BAL_ROLES,  role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/pl-statement',    'Income Statement',   BarChart3,       PERIODS_ROLES,    role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/balance-sheet',   'Balance Sheet',      Scale,           TRIAL_BAL_ROLES,  role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/cash-flow',       'Cash Flow Statement', BarChart3,      PERIODS_ROLES,    role,
      { extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
    makeLedgerNavItem('/ledger/bir',             'Tax Estimation',     FileText,        BIR_ROLES,        role,
      { extraCondition: isFullLedger && isBirRegistered, lockedReason: 'Upgrade to full accounting to unlock this' }),

    // ── Reports hub (Sprint 21) ─────────────────────────────────────────────
    // Single entry point for every exportable XLSX report across the Ledger.
    // Permission filtering happens per-card on the page itself; nav role gate
    // here is the loose union so anyone with at least one report stays seen.
    makeLedgerNavItem('/ledger/reports',       'Reports',            FileBarChart,    TRIAL_BAL_ROLES,  role),

    // ── Audit ───────────────────────────────────────────────────────────────
    makeLedgerNavItem('/ledger/audit',         'Audit Log',          ShieldCheck,     AUDIT_ROLES,      role,
      { sectionStart: 'Audit', extraCondition: isFullLedger, lockedReason: 'Upgrade to full accounting to unlock this' }),
  ].filter((item) => !item.disabled
    || item.disabledReason?.startsWith('Requires')
    || item.disabledReason === 'Upgrade to full accounting to unlock this');

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
        helpHref="/ledger/help"
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
