'use client';
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Clock, LayoutDashboard, CalendarDays, UserCheck, Timer, FileText, DollarSign, HeartHandshake, Receipt } from 'lucide-react';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

const PAYROLL_ACCENT      = 'hsl(262 70% 58%)';
const PAYROLL_ACCENT_SOFT = 'hsl(262 70% 58% / 0.08)';

// ── Payroll SOD Role Sets ─────────────────────────────────────────────────────
// Clock In/Out → ALL roles (every employee can track attendance)
// Dashboard    → Owners, managers, payroll admins, finance leads
// Timesheets   → Management + Sales Lead (who manages shift workers)
// Staff        → HR/Payroll management only
// Pay Runs & financial payroll → PAYROLL_MASTER + BUSINESS_OWNER only
// Note: EXTERNAL_AUDITOR is read-only outside staff — no clock-in/out, no own-payslip view.
const CLOCK_ROLES         = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD', 'CASHIER',
                              'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'BOOKKEEPER', 'ACCOUNTANT',
                              'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
                              'PAYROLL_MASTER', 'GENERAL_EMPLOYEE'] as const;
const PAY_DASHBOARD_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'PAYROLL_MASTER', 'FINANCE_LEAD'] as const;
const TIMESHEETS_ROLES    = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'PAYROLL_MASTER', 'SALES_LEAD'] as const;
const PAY_STAFF_ROLES     = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'PAYROLL_MASTER', 'MDM'] as const;
const PAY_RUNS_ROLES      = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'PAYROLL_MASTER'] as const;
const PAYSLIPS_ROLES      = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD', 'CASHIER',
                              'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD', 'BOOKKEEPER', 'ACCOUNTANT',
                              'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
                              'PAYROLL_MASTER', 'GENERAL_EMPLOYEE'] as const;
// My Expenses — personal-reimbursement claims; every authenticated employee can submit.
const MY_EXPENSES_ROLES   = PAYSLIPS_ROLES;

function inPayrollRoles(role: string | undefined | null, set: readonly string[]) {
  return !!(role && set.includes(role));
}

function makePayNavItem(
  href: string, label: string, icon: React.ElementType,
  allowedRoles: readonly string[], role: string | undefined | null,
): NavItem {
  const hasAccess = inPayrollRoles(role, allowedRoles);
  return {
    href, label, icon,
    disabled: !hasAccess,
    disabledReason: hasAccess ? undefined : 'Your role doesn\'t have access to this section',
  };
}

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, clear } = useAuthStore();

  // ── App-level guard ────────────────────────────────────────────────────────
  // KIOSK_DISPLAY accounts are kiosk-hardware credentials and have NO business
  // in Payroll regardless of what their (potentially stale) UserAppAccess rows
  // say. Role check first; appAccess check second as a backstop for everyone
  // else who lacks Payroll.
  useEffect(() => {
    if (!user) return;
    if (user.role === 'KIOSK_DISPLAY') {
      router.replace('/pos/select-display');
      return;
    }
    const payrollAccess = user.appAccess.find((a) => a.app === 'PAYROLL');
    const hasPayroll =
      payrollAccess && payrollAccess.level !== 'NONE';
    if (!hasPayroll) {
      router.replace('/select');
    }
  }, [user, router]);

  // Set accent on <html> so Radix Dialog portals (rendered at document.body)
  // also inherit the correct --accent value.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent',      PAYROLL_ACCENT);
    root.style.setProperty('--accent-soft', PAYROLL_ACCENT_SOFT);
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

  const role = user?.role;

  // Build payroll nav — all items shown; grayed-out when role lacks access.
  // Clock In/Out is accessible to EVERY role (universal attendance tracking).
  const navItems: NavItem[] = [
    makePayNavItem('/payroll/clock',       'Clock In / Out', Timer,           CLOCK_ROLES,         role),
    makePayNavItem('/payroll/attendance',  'My Attendance',  CalendarDays,    CLOCK_ROLES,         role),
    makePayNavItem('/payroll/dashboard',   'Dashboard',      LayoutDashboard, PAY_DASHBOARD_ROLES, role),
    makePayNavItem('/payroll/timesheets',  'Timesheets',     CalendarDays,    TIMESHEETS_ROLES,    role),
    makePayNavItem('/payroll/staff',       'Staff',          UserCheck,       PAY_STAFF_ROLES,     role),
    makePayNavItem('/payroll/runs',        'Pay Runs',       DollarSign,      PAY_RUNS_ROLES,      role),
    makePayNavItem('/payroll/payslips',    'Payslips',       FileText,        PAYSLIPS_ROLES,      role),
    makePayNavItem('/payroll/my-expenses', 'My Expenses',    Receipt,         MY_EXPENSES_ROLES,   role),
    makePayNavItem('/payroll/contributions','Contributions', HeartHandshake,  PAY_RUNS_ROLES,      role),
    makePayNavItem('/payroll/reports',     'Reports',        Clock,           PAY_DASHBOARD_ROLES, role),
  ].filter((item) => !item.disabled);

  return (
    <div
      style={{
        '--accent':      PAYROLL_ACCENT,
        '--accent-soft': PAYROLL_ACCENT_SOFT,
      } as React.CSSProperties}
    >
      <AppShell navItems={navItems} logoIcon={Users} appName="Sync" helpHref="/payroll/help" onSignOut={handleLogout}>
        {children}
      </AppShell>
    </div>
  );
}
