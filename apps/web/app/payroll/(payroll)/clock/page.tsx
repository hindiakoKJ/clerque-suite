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

  // Clock out
  async function handleClockOut() {
    setActionPending(true);
    try {
      const { data } = await api.post<ClockStatus>('/payroll/clock/out', { breakMins: 0 });
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
        ) : (
          <button
            onClick={isClockedIn ? handleClockOut : handleClockIn}
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
