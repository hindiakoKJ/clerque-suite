'use client';

// Payroll Clock — punch in/out page
// Accessible to ALL users with any Payroll access (CLOCK_ONLY and above)
// UI will be replaced with Claude Design handoff spec
import { useState, useEffect } from 'react';
import { Timer, LogIn, LogOut } from 'lucide-react';

export default function ClockPage() {
  const [now, setNow] = useState(new Date());
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [clockedInAt, setClockedInAt] = useState<Date | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  function handleToggle() {
    if (isClockedIn) {
      setIsClockedIn(false);
      setClockedInAt(null);
    } else {
      setIsClockedIn(true);
      setClockedInAt(new Date());
    }
  }

  const elapsed = clockedInAt
    ? Math.floor((now.getTime() - clockedInAt.getTime()) / 1000)
    : 0;
  const hrs  = Math.floor(elapsed / 3600).toString().padStart(2, '0');
  const mins = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');

  return (
    <div className="overflow-y-auto h-full p-6">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">

        {/* Clock display */}
        <div className="text-center space-y-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">Current time</p>
          <p className="text-5xl font-mono font-bold text-slate-900 dark:text-white tabular-nums">
            {now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Session timer */}
        {isClockedIn && (
          <div className="text-center">
            <p className="text-xs text-slate-400 mb-1">Time on shift</p>
            <p className="text-3xl font-mono font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
              {hrs}:{mins}:{secs}
            </p>
          </div>
        )}

        {/* Punch button — UI to be replaced by Claude Design */}
        <button
          onClick={handleToggle}
          className="flex items-center gap-3 px-10 py-4 rounded-2xl font-semibold text-white text-lg shadow-lg transition-all hover:brightness-110 active:scale-[0.97]"
          style={{ background: 'var(--accent)' }}
        >
          {isClockedIn
            ? <><LogOut className="w-5 h-5" /> Clock Out</>
            : <><LogIn  className="w-5 h-5" /> Clock In</>
          }
        </button>

        <p className="text-xs text-slate-400">
          {isClockedIn
            ? `Clocked in at ${clockedInAt?.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`
            : 'Not clocked in'
          }
        </p>
      </div>
    </div>
  );
}
