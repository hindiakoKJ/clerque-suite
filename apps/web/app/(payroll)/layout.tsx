import type React from 'react';
import { Users, Clock, LayoutDashboard, CalendarDays, UserCheck, Timer, FileText, DollarSign, HeartHandshake } from 'lucide-react';
import { AppShell, type NavItem } from '@/components/shell/AppShell';

const PAYROLL_ACCENT      = 'hsl(262 70% 58%)';
const PAYROLL_ACCENT_SOFT = 'hsl(262 70% 58% / 0.08)';

const navItems: NavItem[] = [
  { href: '/payroll/clock',        label: 'Clock In / Out',   icon: Timer },
  { href: '/payroll/dashboard',    label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/payroll/timesheets',   label: 'Timesheets',       icon: CalendarDays },
  { href: '/payroll/staff',        label: 'Staff',            icon: UserCheck },
  // Coming Soon items — still in nav, route shows placeholder
  { href: '/payroll/coming-soon/runs',          label: 'Pay Runs',        icon: DollarSign },
  { href: '/payroll/coming-soon/payslips',      label: 'Payslips',        icon: FileText },
  { href: '/payroll/coming-soon/contributions', label: 'Contributions',   icon: HeartHandshake },
  { href: '/payroll/coming-soon/reports',       label: 'Reports',         icon: Clock },
];

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        '--accent':      PAYROLL_ACCENT,
        '--accent-soft': PAYROLL_ACCENT_SOFT,
      } as React.CSSProperties}
    >
      <AppShell navItems={navItems} logoIcon={Users} appName="Sync">
        {children}
      </AppShell>
    </div>
  );
}
