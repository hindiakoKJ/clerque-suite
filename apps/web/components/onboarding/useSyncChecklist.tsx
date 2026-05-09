'use client';
/**
 * Get Started checklist for the Sync (Payroll) dashboard.
 *
 * Captures the minimum-viable path for a new tenant to run their first
 * payroll cycle:
 *   1. Add staff (with salary type + rate)
 *   2. Set work shifts so attendance can compute hours
 *   3. Have at least one closed time entry (proves clock-in/out works)
 *   4. Create + lock the first PayRun (this is what posts the salary GL)
 *
 * Auto-hides once every required step is done.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ChecklistItem } from './GetStartedChecklist';

interface EmployeeRow {
  id:         string;
  basicRate:  number | null;
  shiftStart: string | null;
  shiftEnd:   string | null;
}

interface PayRunRow {
  id:     string;
  status: 'DRAFT' | 'COMPLETED' | 'LOCKED' | 'CANCELLED';
}

export function useSyncChecklist(): ChecklistItem[] {
  const { data: employees = [] } = useQuery<EmployeeRow[]>({
    queryKey: ['payroll-employees'],
    queryFn:  () => api.get('/payroll/employees').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const { data: runs = [] } = useQuery<PayRunRow[]>({
    queryKey: ['payroll-runs'],
    queryFn:  () => api.get('/payroll/runs').then((r) => r.data),
    staleTime: 60_000,
  });

  // Time entries — sample the most recent 5; if any are CLOSED/APPROVED we
  // count clock-in as exercised.
  interface TE { status: 'OPEN' | 'CLOSED' | 'APPROVED' | 'REJECTED' }
  const { data: timeEntries = [] } = useQuery<TE[]>({
    queryKey: ['recent-time-entries-checklist'],
    queryFn:  () =>
      api.get('/payroll/timesheets', { params: { weekStart: new Date().toISOString().slice(0, 10) } })
        .then((r) => r.data?.entries ?? r.data ?? []),
    staleTime: 60_000,
    retry: false,
  });

  const hasStaff       = employees.length > 0;
  const hasSalaryRates = employees.some((e) => e.basicRate != null && e.basicRate > 0);
  const hasShifts      = employees.some((e) => e.shiftStart && e.shiftEnd);
  const hasClockEntry  = Array.isArray(timeEntries)
    ? timeEntries.some((e) => e.status === 'CLOSED' || e.status === 'APPROVED')
    : false;
  const hasPayRun      = runs.length > 0;
  const hasLockedRun   = runs.some((r) => r.status === 'LOCKED');

  return [
    {
      done: hasStaff,
      label: 'Add your staff',
      hint: 'Create user accounts for each employee — name, role, employment type.',
      href: '/payroll/staff',
    },
    {
      done: hasSalaryRates,
      label: 'Set salary rates',
      hint: 'Open each staff record and pick salaryType + monthly/daily/hourly rate. Required before payroll math runs.',
      href: '/payroll/staff',
    },
    {
      done: hasShifts,
      label: 'Define work shifts',
      hint: 'Set shiftStart and shiftEnd on each staff so attendance can compute regular vs overtime hours.',
      href: '/payroll/staff',
      optional: true,
    },
    {
      done: hasClockEntry,
      label: 'Clock in your first time entry',
      hint: 'A staff member opens /payroll/clock and starts their shift. Proves attendance is wired up.',
      href: '/payroll/clock',
      optional: true,
    },
    {
      done: hasPayRun,
      label: 'Create your first pay run',
      hint: 'Pick a cut-off period (semi-monthly is the PH default) and process payslips for everyone with hours in range.',
      href: '/payroll/runs',
    },
    {
      done: hasLockedRun,
      label: 'Lock the run + post the salary GL',
      hint: 'After reviewing payslips, click Lock & Post GL. This seals the run and writes the entry to the Ledger.',
      href: '/payroll/runs',
    },
  ];
}
