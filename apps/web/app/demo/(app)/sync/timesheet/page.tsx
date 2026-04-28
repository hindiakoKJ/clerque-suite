'use client';

/**
 * Demo Sync — Timesheet.  Manager view of all employees' attendance
 * across the past week, grouped by employee.
 */

import { useMemo } from 'react';
import { useDemoStore } from '@/lib/demo/store';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function DemoTimesheetPage() {
  const employees = useDemoStore((s) => s.employees);
  const timeEntries = useDemoStore((s) => s.timeEntries);

  const days = useMemo(() => {
    const list: Array<{ date: Date; key: string; label: string; weekday: string }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      list.push({
        date: d,
        key: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
        weekday: DAY_LABELS[d.getDay()],
      });
    }
    return list;
  }, []);

  // Map of employeeId → { dateKey → totalHours }
  const grid = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const t of timeEntries) {
      const dateKey = new Date(t.clockIn).toISOString().slice(0, 10);
      if (!result[t.employeeId]) result[t.employeeId] = {};
      result[t.employeeId][dateKey] = (result[t.employeeId][dateKey] ?? 0) + t.hoursWorked;
    }
    return result;
  }, [timeEntries]);

  const visibleEmployees = employees.filter((e) => e.isActive);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Timesheet</h1>
        <p className="text-sm text-stone-500">
          Hours worked by each employee for the past 7 days. Click a cell to see entries.
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr className="text-[10px] uppercase tracking-wide text-stone-600">
              <th className="text-left px-4 py-2.5 font-semibold sticky left-0 bg-stone-50 z-10">
                Employee
              </th>
              {days.map((d) => (
                <th key={d.key} className="text-center px-3 py-2.5 font-semibold">
                  <div>{d.weekday}</div>
                  <div className="text-stone-400 text-[9px] font-normal">{d.label}</div>
                </th>
              ))}
              <th className="text-right px-4 py-2.5 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-sm">
            {visibleEmployees.map((emp) => {
              const empHours = grid[emp.id] ?? {};
              const total = Object.values(empHours).reduce((s, h) => s + h, 0);
              return (
                <tr key={emp.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 sticky left-0 bg-white z-10">
                    <p className="font-medium text-stone-900">{emp.name}</p>
                    <p className="text-xs text-stone-500">{emp.role.replace(/_/g, ' ')}</p>
                  </td>
                  {days.map((d) => {
                    const hours = empHours[d.key] ?? 0;
                    return (
                      <td key={d.key} className="text-center px-3 py-2.5">
                        {hours > 0 ? (
                          <span className="inline-block px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700 rounded">
                            {hours.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right font-bold text-stone-900">
                    {total.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
