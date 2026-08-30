'use client';

import { useState, useEffect, useCallback } from 'react';
import { Timer, LogIn, LogOut, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface ClockStatus {
  isClockedIn: boolean;
  clockedInAt: string | null;
  entryId:     string | null;
  elapsedMins: number;
}

export default function ClockPage() {
  const [now,          setNow]          = useState(new Date());
  const [status,       setStatus]       = useState<ClockStatus | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [actionPending, setActionPending] = useState(false);

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch clock status on mount
  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get<ClockStatus>('/payroll/clock/status');
      setStatus(data);
    } catch {
      // If the endpoint fails (network/auth), show a neutral state
      setStatus({ isClockedIn: false, clockedInAt: null, entryId: null, elapsedMins: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  // Clock in
  async function handleClockIn() {
    setActionPending(true);
    try {
      const { data } = await api.post<ClockStatus>('/payroll/clock/in', {});
      setStatus(data);
      toast.success('Clocked in successfully.');
    } catch (err: any) {
      const msg = err?.response?.data?.message?.[0] ?? err?.response?.data?.message ?? 'Failed to clock in.';
      toast.error(msg);
    } finally {
      setActionPending(false);
    }
  }

  /*
    Clock out, asking about the unpaid break.

    breakMins was hard-coded to 0. The API computes worked = total - break
    (payroll.service.ts), so a 07:00-16:00 shift with an hour's meal break was
    recorded as 9.00 worked hours -- an hour of overtime, paid at 125%, that
    nobody worked. Wrong from the first pay run, wrong in the staff member's
    favour, and invisible: the Break column could only ever print a dash.

    One tap, not a form. Somebody is clocking out, not filling in a timesheet.
  */
  const [askBreak, setAskBreak] = useState(false);

  async function handleClockOut(breakMins: number) {
    setAskBreak(false);
    setActionPending(true);
    try {
      const { data } = await api.post<ClockStatus>('/payroll/clock/out', { breakMins });
      setStatus(data);
      toast.success('Clocked out successfully.');
    } catch (err: any) {
      const msg = err?.response?.data?.message?.[0] ?? err?.response?.data?.message ?? 'Failed to clock out.';
      toast.error(msg);
    } finally {
      setActionPending(false);
    }
  }

  // Compute elapsed time from the server-provided clockedInAt timestamp
  const clockedInAt = status?.clockedInAt ? new Date(status.clockedInAt) : null;
  const elapsed     = clockedInAt
    ? Math.max(0, Math.floor((now.getTime() - clockedInAt.getTime()) / 1000))
    : 0;
  const hrs  = Math.floor(elapsed / 3600).toString().padStart(2, '0');
  const mins = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');

  const isClockedIn = status?.isClockedIn ?? false;

  return (
    <div className="overflow-y-auto h-full p-6">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">

        {/* Current time display */}
        <div className="text-center space-y-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">Current time</p>
          <p className="text-5xl font-mono font-bold text-slate-900 dark:text-white tabular-nums">
            {now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Session elapsed timer — only shown while clocked in */}
        {isClockedIn && (
          <div className="text-center">
            <p className="text-xs text-slate-400 mb-1">Time on shift</p>
            <p className="text-3xl font-mono font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
              {hrs}:{mins}:{secs}
            </p>
          </div>
        )}

        {/* Punch button */}
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Checking status…</span>
          </div>
        ) : askBreak ? (
          <div className="w-full max-w-xs rounded-2xl border border-border bg-card p-4 text-center">
            <p className="text-sm font-semibold text-foreground">How long was your break?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Unpaid break time comes off your hours.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { m: 0,  label: 'None'   },
                { m: 30, label: '30 min' },
                { m: 60, label: '1 hour' },
              ].map((o) => (
                <button
                  key={o.m}
                  onClick={() => void handleClockOut(o.m)}
                  disabled={actionPending}
                  className="min-h-[3rem] rounded-xl border border-border text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setAskBreak(false)}
              className="mt-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={isClockedIn ? () => setAskBreak(true) : handleClockIn}
            disabled={actionPending}
            className="flex items-center gap-3 px-10 py-4 rounded-2xl font-semibold text-white text-lg shadow-lg transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)' }}
          >
            {actionPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isClockedIn ? (
              <><LogOut className="w-5 h-5" /> Clock Out</>
            ) : (
              <><LogIn  className="w-5 h-5" /> Clock In</>
            )}
          </button>
        )}

        <p className="text-xs text-slate-400">
          {isClockedIn && clockedInAt
            ? `Clocked in at ${clockedInAt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`
            : 'Not clocked in'}
        </p>

      </div>
    </div>
  );
}
