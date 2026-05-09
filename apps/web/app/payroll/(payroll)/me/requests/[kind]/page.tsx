'use client';
/**
 * Sync (Payroll) → Requests → [kind]
 *
 * Self-service list + form for one of the 5 employee request kinds:
 *   COA       — Certificate of Attendance
 *   SCHEDULE  — Schedule Adjustment
 *   OB        — Official Business
 *   OT        — Overtime
 *   UT        — Undertime
 *
 * The shape of the form changes per kind but the list + status badge UI is
 * shared. Server-side validation lives in EmployeeRequestsService.
 */
import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, X, FileBadge, CalendarClock, Briefcase, TrendingUp, Hourglass } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Kind = 'COA' | 'SCHEDULE' | 'OB' | 'OT' | 'UT';
type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface EmployeeRequest {
  id:              string;
  kind:            Kind;
  status:          Status;
  forDate:         string;
  reason:          string;
  payload:         Record<string, any>;
  rejectionReason: string | null;
  createdAt:       string;
  approver:        { id: string; name: string } | null;
}

const META: Record<Kind, { title: string; subtitle: string; icon: any }> = {
  COA:      { title: 'Certificate of Attendance',  subtitle: 'Log a missed clock-in or clock-out.', icon: FileBadge },
  SCHEDULE: { title: 'Schedule Adjustment',        subtitle: 'Temporarily change working time.',   icon: CalendarClock },
  OB:       { title: 'Official Business',          subtitle: 'Off-site work hours.',               icon: Briefcase },
  OT:       { title: 'Overtime',                   subtitle: 'Hours beyond your scheduled shift.', icon: TrendingUp },
  UT:       { title: 'Undertime',                  subtitle: 'Early-out / short shift.',           icon: Hourglass },
};

const STATUS_TINT: Record<Status, string> = {
  PENDING:   'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  APPROVED:  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  REJECTED:  'bg-red-500/15 text-red-600',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export default function MyRequestsByKindPage() {
  const router = useRouter();
  const params = useParams<{ kind: string }>();
  const kindRaw = (params?.kind as string)?.toUpperCase();
  const kind = (['COA', 'SCHEDULE', 'OB', 'OT', 'UT'] as const).includes(kindRaw as Kind)
    ? (kindRaw as Kind)
    : null;
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data: requests = [], isLoading } = useQuery<EmployeeRequest[]>({
    queryKey: ['my-employee-requests', kind],
    queryFn:  () => api.get('/employee-requests/me', { params: { kind } }).then((r) => r.data),
    enabled:  !!kind,
  });

  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/employee-requests/me/${id}/cancel`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-employee-requests', kind] });
      toast.success('Request cancelled.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  if (!kind) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Unknown request type.
        <button onClick={() => router.push('/payroll/me/requests')} className="underline ml-2">Back</button>
      </div>
    );
  }

  const m = META[kind];
  const Icon = m.icon;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <button
        type="button"
        onClick={() => router.push('/payroll/me/requests')}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Requests
      </button>

      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon className="h-6 w-6 text-[var(--accent)]" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
            <p className="text-sm text-muted-foreground">{m.subtitle}</p>
          </div>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New
        </button>
      </header>

      <section className="space-y-2">
        {isLoading ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No {m.title.toLowerCase()} requests yet.
          </div>
        ) : (
          requests.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded ${STATUS_TINT[r.status]}`}>
                      {r.status}
                    </span>
                    <span className="text-sm font-semibold">
                      {new Date(r.forDate).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
                    </span>
                  </div>
                  <PayloadSummary kind={kind} payload={r.payload} />
                  <div className="mt-1 text-xs text-muted-foreground">{r.reason}</div>
                  {r.rejectionReason && (
                    <div className="mt-1 text-xs text-red-600">
                      <span className="font-semibold">Rejected:</span> {r.rejectionReason}
                    </div>
                  )}
                  {r.approver && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.status === 'APPROVED' ? 'Approved' : r.status === 'REJECTED' ? 'Rejected' : 'Reviewed'} by {r.approver.name}
                    </div>
                  )}
                </div>
                {r.status === 'PENDING' && (
                  <button
                    onClick={() => {
                      if (window.confirm('Cancel this request?')) cancel.mutate(r.id);
                    }}
                    disabled={cancel.isPending}
                    className="text-xs px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      {showNew && (
        <NewRequestModal
          kind={kind}
          onClose={() => setShowNew(false)}
          onSuccess={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ['my-employee-requests', kind] });
          }}
        />
      )}
    </div>
  );
}

function PayloadSummary({ kind, payload }: { kind: Kind; payload: Record<string, any> }) {
  const fmtTime = (t: string | undefined) => t ? new Date(t).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—';
  switch (kind) {
    case 'COA':
      return (
        <div className="text-sm">
          {payload.clockIn && <span>Clock-in: {fmtTime(payload.clockIn)}</span>}
          {payload.clockIn && payload.clockOut && <span> · </span>}
          {payload.clockOut && <span>Clock-out: {fmtTime(payload.clockOut)}</span>}
        </div>
      );
    case 'SCHEDULE':
      return <div className="text-sm">{payload.newStart} → {payload.newEnd}</div>;
    case 'OB':
      return <div className="text-sm">{fmtTime(payload.startTime)} → {fmtTime(payload.endTime)} · {payload.location}</div>;
    case 'OT':
      return <div className="text-sm">{fmtTime(payload.startTime)} → {fmtTime(payload.endTime)} ({payload.hoursClaimed ?? '—'} hrs)</div>;
    case 'UT':
      return <div className="text-sm">Early out: {fmtTime(payload.earlyOutAt)} ({payload.hoursMissed ?? '—'} hrs short)</div>;
  }
}

function NewRequestModal({ kind, onClose, onSuccess }: { kind: Kind; onClose: () => void; onSuccess: () => void }) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [forDate, setForDate] = useState(todayStr);
  const [reason, setReason] = useState('');
  // Per-kind fields (loosely typed — the API validates).
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [hoursClaimed, setHoursClaimed] = useState('');
  const [earlyOutAt, setEarlyOutAt] = useState('');
  const [hoursMissed, setHoursMissed] = useState('');

  function buildPayload(): Record<string, any> {
    // For time-of-day fields we anchor them on `forDate` to produce ISO strings.
    const isoOnDay = (hhmm: string) => {
      if (!hhmm) return undefined;
      // hhmm could be HH:MM (from time input) or already ISO from datetime-local.
      if (hhmm.includes('T')) return new Date(hhmm).toISOString();
      const [h, m] = hhmm.split(':');
      const d = new Date(`${forDate}T${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}:00`);
      return d.toISOString();
    };

    switch (kind) {
      case 'COA':
        return { clockIn: isoOnDay(clockIn), clockOut: isoOnDay(clockOut) };
      case 'SCHEDULE':
        return { newStart, newEnd };
      case 'OB':
        return { startTime: isoOnDay(startTime), endTime: isoOnDay(endTime), location: location.trim() };
      case 'OT':
        return {
          startTime:    isoOnDay(startTime),
          endTime:      isoOnDay(endTime),
          hoursClaimed: hoursClaimed ? Number(hoursClaimed) : undefined,
        };
      case 'UT':
        return {
          earlyOutAt:  isoOnDay(earlyOutAt),
          hoursMissed: hoursMissed ? Number(hoursMissed) : undefined,
        };
    }
  }

  const mut = useMutation({
    mutationFn: () => api.post('/employee-requests/me', {
      kind,
      forDate,
      reason: reason.trim(),
      payload: buildPayload(),
    }).then((r) => r.data),
    onSuccess: () => { toast.success('Request submitted.'); onSuccess(); },
    onError:   (e: any) => toast.error(e?.response?.data?.message ?? 'Failed.'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-auto rounded-2xl bg-background border border-border shadow-xl">
        <header className="px-5 py-4 border-b border-border sticky top-0 bg-background flex items-center justify-between">
          <h3 className="text-base font-semibold">New {META[kind].title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-5 space-y-3">
          <Field label="Date *" type="date" v={forDate} on={setForDate} />

          {kind === 'COA' && (
            <>
              <Field label="Clock-in (optional)"  type="time" v={clockIn}  on={setClockIn} />
              <Field label="Clock-out (optional)" type="time" v={clockOut} on={setClockOut} />
              <Hint>Provide at least one. Use this when you forgot to clock in/out.</Hint>
            </>
          )}

          {kind === 'SCHEDULE' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="New start *" type="time" v={newStart} on={setNewStart} />
                <Field label="New end *"   type="time" v={newEnd}   on={setNewEnd} />
              </div>
              <Hint>Temporary shift change for the day above only.</Hint>
            </>
          )}

          {kind === 'OB' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start time *" type="time" v={startTime} on={setStartTime} />
                <Field label="End time *"   type="time" v={endTime}   on={setEndTime} />
              </div>
              <Field label="Location *" v={location} on={setLocation} placeholder="e.g. Client site, Pasig" />
            </>
          )}

          {kind === 'OT' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start time *" type="time" v={startTime} on={setStartTime} />
                <Field label="End time *"   type="time" v={endTime}   on={setEndTime} />
              </div>
              <Field label="Hours claimed" type="number" v={hoursClaimed} on={setHoursClaimed} placeholder="e.g. 2.5" />
              <Hint>Overtime must be pre-approved by your manager.</Hint>
            </>
          )}

          {kind === 'UT' && (
            <>
              <Field label="Early out at *" type="time" v={earlyOutAt} on={setEarlyOutAt} />
              <Field label="Hours short"    type="number" v={hoursMissed} on={setHoursMissed} placeholder="e.g. 1.5" />
            </>
          )}

          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">Reason *</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Brief justification for your manager."
            />
          </label>
        </div>

        <footer className="px-5 pb-5 flex justify-end gap-2 border-t border-border pt-4 sticky bottom-0 bg-background">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !reason.trim() || !forDate}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
          >
            {mut.isPending ? 'Submitting…' : 'Submit'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, v, on, type = 'text', placeholder }: {
  label: string; v: string; on: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="text-sm block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type} value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-muted-foreground italic">{children}</div>;
}
