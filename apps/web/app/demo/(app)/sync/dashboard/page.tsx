'use client';

/**
 * Demo Sync — Dashboard.  Workforce snapshot: active employees, hours
 * worked this period, last payroll totals, currently clocked-in count.
 */

import { useMemo } from 'react';
import { useDemoStore } from '@/lib/demo/store';
import { Users, Clock, Banknote, UserCheck } from 'lucide-react';

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DemoSyncDashboard() {
  const employees = useDemoStore((s) => s.employees);
  const timeEntries = useDemoStore((s) => s.timeEntries);
  const payslips = useDemoStore((s) => s.payslips);

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.isActive);
    const clockedIn = timeEntries.filter((t) => !t.clockOut);

    // Last 7 days of completed time entries
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentHours = timeEntries
      .filter((t) => t.clockOut && new Date(t.clockIn) >= sevenDaysAgo)
      .reduce((s, t) => s + t.hoursWorked, 0);

    // Last payroll period totals
    const lastPayrollGross = payslips.reduce((s, p) => s + p.grossPay, 0);
    const lastPayrollNet = payslips.reduce((s, p) => s + p.netPay, 0);
    const lastPayrollContributions = payslips.reduce(
      (s, p) => s + p.sssContribution + p.philhealthContribution + p.pagibigContribution,
      0,
    );
    const lastPayrollWHT = payslips.reduce((s, p) => s + p.withholdingTax, 0);

    return {
      activeCount: active.length,
      clockedInCount: clockedIn.length,
      recentHours,
      payslipsCount: payslips.length,
      lastPayrollGross,
      lastPayrollNet,
      lastPayrollContributions,
      lastPayrollWHT,
    };
  }, [employees, timeEntries, payslips]);

  const lastPeriod = payslips[0];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Sync Dashboard</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Workforce snapshot — attendance, payroll, and government contributions.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          icon={Users}
          label="Active Employees"
          value={String(stats.activeCount)}
          sub="On payroll"
          accent="purple"
        />
        <Stat
          icon={UserCheck}
          label="Clocked In Now"
          value={String(stats.clockedInCount)}
          sub="Currently on shift"
          accent="emerald"
        />
        <Stat
          icon={Clock}
          label="Hours This Week"
          value={stats.recentHours.toFixed(1)}
          sub="Last 7 days"
          accent="blue"
        />
        <Stat
          icon={Banknote}
          label="Last Period Payroll"
          value={peso(stats.lastPayrollGross)}
          sub={`${stats.payslipsCount} payslips`}
          accent="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">Last Payroll Breakdown</h2>
          {lastPeriod ? (
            <>
              <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
                {new Date(lastPeriod.periodStart).toLocaleDateString('en-PH', { month: 'long', day: 'numeric' })} —
                {' '}{new Date(lastPeriod.periodEnd).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
              <div className="space-y-2 text-sm">
                <Row label="Gross pay" value={stats.lastPayrollGross} bold />
                <Row label="Government contributions" value={stats.lastPayrollContributions} negative />
                <Row label="Withholding tax" value={stats.lastPayrollWHT} negative />
                <div className="border-t border-stone-200 dark:border-stone-800 pt-2 mt-2">
                  <Row label="Net Pay" value={stats.lastPayrollNet} bold large />
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-stone-500 dark:text-stone-400 py-4 text-center">No payroll history.</p>
          )}
        </div>

        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">Active Employees</h2>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800 text-sm">
            {employees
              .filter((e) => e.isActive)
              .map((emp) => {
                const isClocked = timeEntries.some(
                  (t) => t.employeeId === emp.id && !t.clockOut,
                );
                return (
                  <li key={emp.id} className="py-2 flex items-center justify-between">
                    <div>
                      <p className="text-stone-900 dark:text-stone-100">{emp.name}</p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        {emp.role.replace(/_/g, ' ')}
                      </p>
                    </div>
                    {isClocked ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        On shift
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400">
                        Off
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: 'emerald' | 'blue' | 'purple' | 'amber';
}) {
  const accentMap = {
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30',
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
    purple: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30',
  };
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg mb-3 ${accentMap[accent]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</p>
      <p className="text-xl font-bold text-stone-900 dark:text-stone-100 mt-0.5">{value}</p>
      <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{sub}</p>
    </div>
  );
}

function Row({
  label,
  value,
  bold = false,
  negative = false,
  large = false,
}: {
  label: string;
  value: number;
  bold?: boolean;
  negative?: boolean;
  large?: boolean;
}) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''} ${large ? 'text-base' : ''}`}>
      <span className="text-stone-700 dark:text-stone-300">{label}</span>
      <span className={negative && value > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-stone-900 dark:text-stone-100'}>
        {negative && value > 0 ? '-' : ''}
        {peso(value)}
      </span>
    </div>
  );
}
