'use client';

/**
 * Demo Sync — Time Clock.  Demo visitor (acting as the owner) can clock
 * themselves in and out.  Each click adds a record to the time entries
 * which then shows up in the Timesheet page.
 */

import { useEffect, useState } from 'react';
import { useDemoStore } from '@/lib/demo/store';
import { Clock, LogIn, LogOut } from 'lucide-react';

const DEMO_OWNER_ID = 'demo-employee-owner';

export default function DemoClockPage() {
  const timeEntries = useDemoStore((s) => s.timeEntries);
  const clockIn = useDemoStore((s) => s.clockIn);
  const clockOut = useDemoStore((s) => s.clockOut);

  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const ownerOpen = timeEntries.find(
    (t) => t.employeeId === DEMO_OWNER_ID && !t.clockOut,
  );
  const isClockedIn = !!ownerOpen;

  const ownerHistory = timeEntries
    .filter((t) => t.employeeId === DEMO_OWNER_ID && t.clockOut)
    .slice(0, 7);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Time Clock</h1>
        <p className="text-sm text-stone-500 dark:text-stone-500">
          Punch in or out.  The recorded time appears in your timesheet automatically.
        </p>
      </div>

      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-6 sm:p-8 text-center space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-stone-500 dark:text-stone-500">Current time</p>
          <p className="font-mono text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 mt-1">
            {now ? now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}
          </p>
          <p className="text-sm text-stone-500 dark:text-stone-500 mt-1">
            {now ? now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''}
          </p>
        </div>

        <div className="border-t border-stone-200 dark:border-stone-800 pt-6 space-y-3">
          {isClockedIn && ownerOpen && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-900">
              <p className="font-semibold">Clocked in since</p>
              <p>{new Date(ownerOpen.clockIn).toLocaleString('en-PH')}</p>
            </div>
          )}
          {!isClockedIn ? (
            <button
              onClick={() => clockIn(DEMO_OWNER_ID)}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-lg"
            >
              <LogIn className="w-5 h-5" />
              Clock In
            </button>
          ) : (
            <button
              onClick={() => clockOut(DEMO_OWNER_ID)}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg text-lg"
            >
              <LogOut className="w-5 h-5" />
              Clock Out
            </button>
          )}
        </div>
      </div>

      {ownerHistory.length > 0 && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-stone-500 dark:text-stone-500" />
            <h2 className="font-semibold text-stone-900 dark:text-stone-100 text-sm">Recent punches</h2>
          </div>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800 text-sm">
            {ownerHistory.map((t) => (
              <li key={t.id} className="px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-stone-900 dark:text-stone-100">
                    {new Date(t.clockIn).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-500">
                    {new Date(t.clockIn).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                    {' → '}
                    {t.clockOut ? new Date(t.clockOut).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </p>
                </div>
                <p className="text-sm font-semibold text-stone-700 dark:text-stone-300">{t.hoursWorked.toFixed(1)} hrs</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
