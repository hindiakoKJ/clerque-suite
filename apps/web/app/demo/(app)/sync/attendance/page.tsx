'use client';

/**
 * Demo Sync — My Attendance.  Owner's own attendance log only.
 */

import { useDemoStore } from '@/lib/demo/store';

const DEMO_OWNER_ID = 'demo-employee-owner';

export default function DemoMyAttendancePage() {
  const timeEntries = useDemoStore((s) => s.timeEntries);
  const myEntries = timeEntries
    .filter((t) => t.employeeId === DEMO_OWNER_ID)
    .sort((a, b) => new Date(b.clockIn).getTime() - new Date(a.clockIn).getTime());

  const totalHours = myEntries.reduce((s, t) => s + t.hoursWorked, 0);
  const completedCount = myEntries.filter((t) => t.clockOut).length;
  const openCount = myEntries.filter((t) => !t.clockOut).length;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">My Attendance</h1>
        <p className="text-sm text-stone-500">
          Your personal clock-in / clock-out history.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Total hours" value={totalHours.toFixed(1)} />
        <SummaryCard label="Punches" value={String(completedCount)} />
        <SummaryCard label="Open" value={String(openCount)} highlight={openCount > 0} />
      </div>

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase tracking-wide text-stone-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold">Date</th>
              <th className="text-left px-4 py-2.5 font-semibold">Clock In</th>
              <th className="text-left px-4 py-2.5 font-semibold">Clock Out</th>
              <th className="text-right px-4 py-2.5 font-semibold">Hours</th>
              <th className="text-center px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-sm">
            {myEntries.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-stone-500">
                  No attendance yet. Visit Time Clock and punch in.
                </td>
              </tr>
            ) : (
              myEntries.map((t) => {
                const inDate = new Date(t.clockIn);
                const outDate = t.clockOut ? new Date(t.clockOut) : null;
                return (
                  <tr key={t.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2.5 text-stone-900">
                      {inDate.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {inDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {outDate ? outDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-stone-700">
                      {t.hoursWorked.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {outDate ? (
                        <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold rounded bg-stone-100 text-stone-700">
                          Closed
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-700">
                          Active
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`bg-white border rounded-lg p-4 ${highlight ? 'border-emerald-300 bg-emerald-50' : 'border-stone-200'}`}>
      <p className="text-[10px] uppercase tracking-wider text-stone-500">{label}</p>
      <p className="text-2xl font-bold text-stone-900 mt-1">{value}</p>
    </div>
  );
}
