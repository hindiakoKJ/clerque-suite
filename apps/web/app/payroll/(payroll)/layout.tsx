'use client';
import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Users, Clock, LayoutDashboard, CalendarDays, UserCheck, Timer, FileText, DollarSign, HeartHandshake, Receipt, User as UserIcon, Plane, ClipboardList, Gift } from 'lucide-react';
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
// Sprint 19 — Sync (Payroll) role consolidation.
//
// Sync has two audiences: HR managers + employees. Roles split accordingly:
//   - HR_MGMT      = Owner + Branch Manager + Payroll Master
//                    (the 3 people who run HR/payroll)
//   - PAYROLL_ONLY = Owner + Payroll Master
//                    (the sensitive payroll-finance work — cap salaries,
//                     run pay runs, view contributions)
//   - EMPLOYEE     = literally every authenticated user with a tenant,
//                    incl. CASHIER / WAREHOUSE_STAFF / AR_ACCOUNTANT etc.
//                    (clock in/out + see own payslips + file own
//                     requests/leaves — every staff member needs this)
const HR_MGMT      = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'PAYROLL_MASTER'] as const;
const PAYROLL_ONLY = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'PAYROLL_MASTER'] as const;
const EMPLOYEE     = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SALES_LEAD',
                      'PAYROLL_MASTER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD',
                      'BOOKKEEPER', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
                      'GENERAL_EMPLOYEE'] as const;

const CLOCK_ROLES         = EMPLOYEE;
const PAY_DASHBOARD_ROLES = HR_MGMT;
const TIMESHEETS_ROLES    = HR_MGMT;
const PAY_STAFF_ROLES     = HR_MGMT;
const PAY_RUNS_ROLES      = PAYROLL_ONLY;
const PAYSLIPS_ROLES      = EMPLOYEE;
const HR_VIEW_ROLES       = HR_MGMT;
const MY_EXPENSES_ROLES   = EMPLOYEE;

function inPayrollRoles(role: string | undefined | null, set: readonly string[]) {
  return !!(role && set.includes(role));
}

function makePayNavItem(
  href: string, label: string, icon: React.ElementType,
  allowedRoles: readonly string[], role: string | undefined | null,
  sectionStart?: string,
): NavItem {
  const hasAccess = inPayrollRoles(role, allowedRoles);
  return {
    href, label, icon,
    disabled: !hasAccess,
    disabledReason: hasAccess ? undefined : 'Your role doesn\'t have access to this section',
    sectionStart,
  };
}

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, clear } = useAuthStore();
  const isHrRole = !!user && (HR_VIEW_ROLES as readonly string[]).includes(user.role);

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
      return;
    }
    // Auto-route non-HR roles landing on /payroll or /payroll/dashboard to
    // their employee self-service home.
    if (!isHrRole && (pathname === '/payroll' || pathname === '/payroll/dashboard')) {
      router.replace('/payroll/me');
    }
  }, [user, router, isHrRole, pathname]);

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

  // Sprint 19 — Self-clock policy hides the in-app Clock link when the
  // tenant has not opted in. Only the kiosk path is visible to employees;
  // HR keeps Timesheets / Pay Runs / etc. so kiosk-recorded hours can be
  // reviewed and processed normally.
  const allowSelfClockIn = (user as any)?.allowSelfClockIn === true;

  // Build payroll nav — items differ based on whether this is an HR-view role
  // (dashboard-first, with Staff + Pay Runs + Leaves admin) or an employee
  // self-service role (lands on /payroll/me with the Requests landing).
  //
  // sectionStart on the FIRST item of each group renders a small header above
  // it (AppShell handles the rendering). Sections are kept light — three
  // logical groupings: Overview, Time & Attendance, then payroll/finance.
  const navItems: NavItem[] = (
    isHrRole
      ? [
          // Overview
          makePayNavItem('/payroll/dashboard',     'Dashboard',      LayoutDashboard, PAY_DASHBOARD_ROLES, role, 'Overview'),
          // Time & Attendance — Clock link only when self-service clocking is enabled
          ...(allowSelfClockIn
            ? [makePayNavItem('/payroll/clock',         'Clock In / Out', Timer,           CLOCK_ROLES,         role, 'Time & Attendance')]
            : []),
          makePayNavItem('/payroll/timesheets',    'Timesheets',     CalendarDays,    TIMESHEETS_ROLES,    role, allowSelfClockIn ? undefined : 'Time & Attendance'),
          makePayNavItem('/payroll/leaves',        'Leaves',         Plane,           HR_VIEW_ROLES,       role),
          // People
          makePayNavItem('/payroll/staff',         'Staff',          UserCheck,       PAY_STAFF_ROLES,     role, 'People'),
          // Payroll & Finance
          makePayNavItem('/payroll/runs',          'Pay Runs',       DollarSign,      PAY_RUNS_ROLES,      role, 'Payroll & Finance'),
          makePayNavItem('/payroll/payslips',      'Payslips',       FileText,        PAYSLIPS_ROLES,      role),
          makePayNavItem('/payroll/contributions',     'Contributions',  HeartHandshake,  PAY_RUNS_ROLES,      role),
          makePayNavItem('/payroll/thirteenth-month',  '13th-Month',     Gift,            PAY_RUNS_ROLES,      role),
          makePayNavItem('/payroll/reports',           'Reports',        Clock,           PAY_DASHBOARD_ROLES, role),
        ]
      : [
          // Overview
          makePayNavItem('/payroll/me',          'Home',           UserIcon,        CLOCK_ROLES,         role, 'Overview'),
          // Time & Attendance — Clock link only when self-service clocking is enabled
          ...(allowSelfClockIn
            ? [makePayNavItem('/payroll/clock',       'Clock In / Out', Timer,           CLOCK_ROLES,         role, 'Time & Attendance')]
            : []),
          makePayNavItem('/payroll/attendance',  'My Attendance',  CalendarDays,    CLOCK_ROLES,         role, allowSelfClockIn ? undefined : 'Time & Attendance'),
          makePayNavItem('/payroll/me/requests', 'Requests',       ClipboardList,   CLOCK_ROLES,         role),
          // Payroll & Finance
          makePayNavItem('/payroll/payslips',    'My Payslips',    FileText,        PAYSLIPS_ROLES,      role, 'Payroll & Finance'),
          makePayNavItem('/payroll/my-expenses', 'My Expenses',    Receipt,         MY_EXPENSES_ROLES,   role),
        ]
  ).filter((item) => !item.disabled);

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
