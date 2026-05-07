'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Calendar, FileText, DollarSign, Clock, ArrowRight, Plane } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface MySalary {
  name:       string;
  salaryRate: number | null;
  salaryType: string | null;
  hiredAt:    string | null;
  department: string | null;
  lastPayslip: {
    netPay:    number;
    grossPay:  number;
    runLabel:  string;
    periodEnd: string;
  } | null;
}

interface MyLeave {
  id:        string;
  type:      string;
  status:    string;
  startDate: string;
  endDate:   string;
  daysCount: string;
  reason:    string;
  approver?: { name: string } | null;
}

function fmtPeso(n: number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

const LEAVE_STATUS_TINT: Record<string, string> = {
  PENDING:   'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  APPROVED:  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  REJECTED:  'bg-red-500/15 text-red-600',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export default function MyPayrollPage() {
  const { user } = useAuthStore();

  const { data: salary } = useQuery<MySalary>({
    queryKey: ['payroll-me-salary'],
    queryFn:  () => api.get('/payroll/me/salary').then((r) => r.data),
    enabled:  !!user,
  });

  const { data: leaves = [] } = useQuery<MyLeave[]>({
    queryKey: ['payroll-me-leaves'],
    queryFn:  () => api.get('/payroll/me/leaves').then((r) => r.data),
    enabled:  !!user,
  });

  const { data: payslips = [] } = useQuery<any[]>({
    queryKey: ['payroll-me-payslips'],
    queryFn:  () => api.get('/payroll/me/payslips').then((r) => r.data),
    enabled:  !!user,
  });

  const pendingLeaves   = leaves.filter((l) => l.status === 'PENDING').length;
  const approvedYtdDays = leaves
    .filter((l) => l.status === 'APPROVED' && new Date(l.startDate).getFullYear() === new Date().getFullYear())
    .reduce((sum, l) => sum + Number(l.daysCount), 0);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My Payroll</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hi {salary?.name?.split(' ')[0] ?? user?.name?.split(' ')[0]}. Your salary, attendance, and payslips at a glance.
        </p>
      </header>

      {/* ── Stat cards ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Last payslip"
          value={fmtPeso(salary?.lastPayslip?.netPay)}
          hint={salary?.lastPayslip?.runLabel ?? '—'}
          Icon={FileText}
        />
        <StatCard
          label="Salary rate"
          value={fmtPeso(salary?.salaryRate)}
          hint={salary?.salaryType?.replace('_', '-').toLowerCase() ?? '—'}
          Icon={DollarSign}
        />
        <StatCard
          label="Approved leave (YTD)"
          value={`${approvedYtdDays.toFixed(1)} days`}
          hint={`${pendingLeaves} pending`}
          Icon={Plane}
        />
        <StatCard
          label="Joined"
          value={salary?.hiredAt ? fmtDate(salary.hiredAt) : '—'}
          hint={salary?.department ?? '—'}
          Icon={Clock}
        />
      </div>

      {/* ── Quick actions ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/payroll/clock" className="rounded-xl border border-border bg-card p-4 hover:bg-muted/40 transition-colors flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Clock In / Out</div>
            <div className="text-xs text-muted-foreground">Track today's attendance</div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link href="/payroll/me/leaves" className="rounded-xl border border-border bg-card p-4 hover:bg-muted/40 transition-colors flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Request Leave</div>
            <div className="text-xs text-muted-foreground">Submit a new request</div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link href="/payroll/payslips" className="rounded-xl border border-border bg-card p-4 hover:bg-muted/40 transition-colors flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">All Payslips</div>
            <div className="text-xs text-muted-foreground">{payslips.length} on record</div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>

      {/* ── Recent payslips ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent payslips</h2>
          <Link href="/payroll/payslips" className="text-xs text-[var(--accent)] hover:underline">View all</Link>
        </header>
        {payslips.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No payslips yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Pay run</th>
                <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Period</th>
                <th className="text-right px-4 py-2 font-medium">Gross</th>
                <th className="text-right px-4 py-2 font-medium">Net</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {payslips.slice(0, 5).map((s: any) => (
                <tr key={s.id} className="border-t border-border/40">
                  <td className="px-4 py-2.5">{s.payRun?.label ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                    {fmtDate(s.payRun?.periodStart)} – {fmtDate(s.payRun?.periodEnd)}
                  </td>
                  <td className="px-4 py-2.5 text-right">{fmtPeso(Number(s.grossPay))}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{fmtPeso(Number(s.netPay))}</td>
                  <td className="px-2 py-2.5 text-right">
                    <a
                      href={`/api/v1/payroll/me/payslips/${s.id}/pdf`}
                      className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                    >
                      PDF <FileText className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Recent leaves ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">My leave requests</h2>
          <Link href="/payroll/me/leaves" className="text-xs text-[var(--accent)] hover:underline">Manage</Link>
        </header>
        {leaves.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No leave requests filed.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {leaves.slice(0, 4).map((l) => (
              <li key={l.id} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    {l.type.toLowerCase()} · {Number(l.daysCount).toFixed(1)} day{Number(l.daysCount) === 1 ? '' : 's'}
                  </div>
                  <div className="text-xs text-muted-foreground">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</div>
                  <div className="text-xs text-muted-foreground italic mt-0.5">{l.reason}</div>
                </div>
                <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${LEAVE_STATUS_TINT[l.status] ?? 'bg-muted'}`}>
                  {l.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, hint, Icon }: { label: string; value: string; hint?: string; Icon: any }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-lg font-semibold leading-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}
