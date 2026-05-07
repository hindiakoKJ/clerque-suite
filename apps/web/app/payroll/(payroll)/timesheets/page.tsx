'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertCircle, Check, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Badge } from '@/components/ui/Badge';

function weekLabel(dateStr: string) {
  const d   = new Date(`${dateStr}T12:00:00+08:00`);
  const end = new Date(d.getTime() + 6 * 86400000);
  const fmt = (x: Date) => x.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  return `${fmt(d)} – ${fmt(end)}`;
}

function currentWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const mon = new Date(now.setDate(diff));
  return mon.toISOString().slice(0, 10);
}

function offsetWeek(dateStr: string, weeks: number) {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

interface TimesheetRow {
  employeeId: string;
  employeeName: string;
  department: string;
  mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number;
  totalHours: number;
  overtime: number;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
}

const STATUS_STYLES: Record<
  TimesheetRow['status'],
  { tone: 'success' | 'warn' | 'danger'; label: string; icon: React.ElementType }
> = {
  APPROVED: { tone: 'success', label: 'Approved', icon: CheckCircle2 },
  PENDING:  { tone: 'warn',    label: 'Pending',  icon: AlertCircle  },
  REJECTED: { tone: 'danger',  label: 'Rejected', icon: XCircle      },
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export default function TimesheetsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(currentWeekStart());

  const canApprove = !!user && ['BUSINESS_OWNER', 'PAYROLL_MASTER', 'BRANCH_MANAGER', 'SUPER_ADMIN'].includes(user.role);

  const { data: rows = [], isLoading } = useQuery<TimesheetRow[]>({
    queryKey: ['timesheets', weekStart],
    queryFn: () => api.get(`/payroll/timesheets?weekStart=${weekStart}`).then((r) => r.data),
    enabled: !!user,
    staleTime: 30_000,
  });

  const approveMut = useMutation({
    mutationFn: (userId: string) =>
      api.post('/payroll/timesheets/approve-week', { userId, weekStart }).then((r) => r.data),
    onSuccess: (data: { count: number }) => {
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success(`Approved ${data.count} entr${data.count === 1 ? 'y' : 'ies'}.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      api.post('/payroll/timesheets/reject-week', { userId, weekStart, reason }).then((r) => r.data),
    onSuccess: (data: { count: number }) => {
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success(`Rejected ${data.count} entr${data.count === 1 ? 'y' : 'ies'}.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  function reject(userId: string) {
    const reason = window.prompt('Reason for rejecting this employee\'s week?');
    if (!reason || !reason.trim()) return;
    rejectMut.mutate({ userId, reason: reason.trim() });
  }

  const pending  = rows.filter((r) => r.status === 'PENDING').length;
  const approved = rows.filter((r) => r.status === 'APPROVED').length;

  return (
    <div className="flex flex-col h-full overflow-auto">

      {/* Header */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">Timesheets</h1>
          </div>

          {/* Week navigator */}
          <div className="flex items-center gap-1 bg-muted rounded-lg px-1 py-1">
            <button
              onClick={() => setWeekStart((w) => offsetWeek(w, -1))}
              className="p-1 rounded hover:bg-background transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <span className="text-sm font-medium text-foreground px-2 min-w-[160px] text-center">
              {weekLabel(weekStart)}
            </span>
            <button
              onClick={() => setWeekStart((w) => offsetWeek(w, 1))}
              disabled={weekStart >= currentWeekStart()}
              className="p-1 rounded hover:bg-background transition-colors disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Summary pills */}
        {!isLoading && rows.length > 0 && (
          <div className="flex gap-2 mt-3">
            <Badge tone="warn">{pending} pending</Badge>
            <Badge tone="success">{approved} approved</Badge>
            <Badge tone="default">{rows.length} total</Badge>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 p-4 sm:p-6">
        {isLoading ? (
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="h-10 bg-muted border-b border-border" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-3 flex gap-4 border-b border-border last:border-0">
                <div className="h-4 w-36 bg-muted animate-pulse rounded" />
                {[0, 1, 2, 3, 4, 5, 6].map((j) => (
                  <div key={j} className="h-4 w-8 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Clock className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No timesheets for this week</p>
          </div>
        ) : (
          <div className="bg-background rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs">Employee</th>
                  {DAYS.map((d) => (
                    <th key={d} className="text-center px-2 py-3 font-semibold text-muted-foreground text-xs w-10">
                      {d}
                    </th>
                  ))}
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs">Total</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs">OT</th>
                  <th className="text-center px-4 py-3 font-semibold text-muted-foreground text-xs">Status</th>
                  {canApprove && (
                    <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-xs">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const s = STATUS_STYLES[row.status];
                  const dayHours = [row.mon, row.tue, row.wed, row.thu, row.fri, row.sat, row.sun];
                  return (
                    <tr key={row.employeeId} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{row.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{row.department}</p>
                      </td>
                      {dayHours.map((h, i) => (
                        <td
                          key={i}
                          className={`text-center px-2 py-3 text-xs tabular-nums ${
                            h === 0 ? 'text-muted-foreground/40' : 'text-foreground'
                          }`}
                        >
                          {h > 0 ? h : '–'}
                        </td>
                      ))}
                      <td className="text-right px-4 py-3 font-semibold text-foreground tabular-nums">
                        {row.totalHours}h
                      </td>
                      <td className="text-right px-4 py-3 tabular-nums text-xs text-muted-foreground">
                        {row.overtime > 0 ? `+${row.overtime}h` : '–'}
                      </td>
                      <td className="text-center px-4 py-3">
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </td>
                      {canApprove && (
                        <td className="text-right px-4 py-3">
                          {row.status === 'PENDING' ? (
                            <div className="inline-flex gap-1">
                              <button
                                onClick={() => approveMut.mutate(row.employeeId)}
                                disabled={approveMut.isPending}
                                className="p-1.5 rounded text-emerald-700 hover:bg-emerald-500/15"
                                title="Approve all CLOSED entries this week"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => reject(row.employeeId)}
                                disabled={rejectMut.isPending}
                                className="p-1.5 rounded text-red-600 hover:bg-red-500/15"
                                title="Reject all CLOSED entries this week"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
