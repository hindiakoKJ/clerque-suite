'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, CheckCircle2, AlertCircle, Loader2, CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Badge } from '@/components/ui/Badge';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AttendanceEntry {
  id: string;
  date: string;
  clockIn: string;
  clockOut: string | null;
  grossHours: number | null;
  otHours: number;
  breakMins: number;
  status: 'OPEN' | 'CLOSED' | 'APPROVED' | 'REJECTED';
  notes: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatHours(h: number | null) {
  if (h == null) return '—';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function StatusBadge({ status }: { status: AttendanceEntry['status'] }) {
  const map: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'default' }> = {
    OPEN:     { label: 'In Progress', variant: 'warning' },
    CLOSED:   { label: 'Completed',   variant: 'default' },
    APPROVED: { label: 'Approved',    variant: 'success' },
    REJECTED: { label: 'Rejected',    variant: 'error'   },
  };
  const { label, variant } = map[status] ?? { label: status, variant: 'default' };
  return <Badge variant={variant}>{label}</Badge>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

// ── Default date range: current month ─────────────────────────────────────────

function getDefaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const to   = now.toISOString().split('T')[0];
  return { from, to };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const { user } = useAuthStore();
  const defaults = getDefaultRange();
  const [from, setFrom] = useState(defaults.from);
  const [to,   setTo  ] = useState(defaults.to);

  const { data: entries = [], isLoading } = useQuery<AttendanceEntry[]>({
    queryKey: ['attendance-mine', from, to],
    queryFn: () =>
      api.get('/payroll/attendance/mine', { params: { from, to } }).then((r) => r.data),
    enabled: !!user,
    staleTime: 30_000,
  });

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalDays   = entries.filter((e) => e.status !== 'OPEN').length;
  const totalHours  = entries.reduce((s, e) => s + (e.grossHours ?? 0), 0);
  const totalOT     = entries.reduce((s, e) => s + (e.otHours ?? 0), 0);
  const openEntry   = entries.find((e) => e.status === 'OPEN');

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">My Attendance</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Your clock-in / clock-out history</p>
            </div>
          </div>

          {/* Date range filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-medium text-muted-foreground">From:</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <label className="text-xs font-medium text-muted-foreground">To:</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-6 space-y-4">

        {/* Active shift banner */}
        {openEntry && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
            <Loader2 className="h-4 w-4 text-yellow-500 animate-spin shrink-0" />
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              You are currently clocked in since <strong>{formatTime(openEntry.clockIn)}</strong>. Clock out to complete this entry.
            </p>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Days Present', value: isLoading ? '—' : String(totalDays), icon: CheckCircle2 },
            { label: 'Regular Hours', value: isLoading ? '—' : formatHours(totalHours), icon: Clock },
            { label: 'Overtime Hours', value: isLoading ? '—' : formatHours(totalOT), icon: AlertCircle },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-background border border-border rounded-lg p-4 flex items-center gap-3">
              <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold text-foreground">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex justify-between gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <CalendarDays className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No attendance records found.</p>
              <p className="text-xs mt-1">Try adjusting the date range above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Clock In</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Clock Out</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Break</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Regular</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">OT</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                        {formatDate(entry.date)}
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {formatTime(entry.clockIn)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {entry.clockOut ? formatTime(entry.clockOut) : (
                          <span className="text-yellow-500 font-medium">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {entry.breakMins > 0 ? `${entry.breakMins}m` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground font-medium">
                        {formatHours(entry.grossHours)}
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: entry.otHours > 0 ? 'var(--accent)' : undefined }}>
                        {entry.otHours > 0 ? formatHours(entry.otHours) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={entry.status} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[160px] truncate">
                        {entry.notes ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
