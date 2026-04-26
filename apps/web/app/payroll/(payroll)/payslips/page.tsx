'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { FileText, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayslipDto {
  id: string;
  payRunId: string;
  payRunLabel: string;
  userId: string;
  employeeName: string;
  position: string;
  department: string;
  periodStart: string;
  periodEnd: string;
  basicPay: number;
  overtimePay: number;
  allowances: number;
  grossPay: number;
  sssContrib: number;
  philhealthContrib: number;
  pagibigContrib: number;
  withholdingTax: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
  regularHours: number;
  overtimeHours: number;
  createdAt: string;
}

interface PayRunOption {
  id: string;
  label: string;
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'PAYROLL_MASTER'] as const;

function isAdminRole(role: string | undefined | null): boolean {
  return !!(role && (ADMIN_ROLES as readonly string[]).includes(role));
}

function formatPeriodRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const sMonth = s.toLocaleDateString('en-PH', { month: 'long' });
  const eMonth = e.toLocaleDateString('en-PH', { month: 'long' });
  const sDay   = s.getDate();
  const eDay   = e.getDate();
  const year   = e.getFullYear();
  if (sMonth === eMonth) {
    return `${sMonth} ${sDay} – ${eDay}, ${year}`;
  }
  return `${sMonth} ${sDay} – ${eMonth} ${eDay}, ${year}`;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

// ── Payslip Detail Modal ──────────────────────────────────────────────────────

function PayslipModal({
  slip,
  onClose,
}: {
  slip: PayslipDto;
  onClose: () => void;
}) {
  function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
    return (
      <div className={`flex items-center justify-between py-1.5 ${bold ? 'font-semibold' : ''}`}>
        <span className={`text-sm ${bold ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
        <span className={`text-sm tabular-nums ${bold ? 'text-foreground' : 'text-foreground'}`}>
          {formatPeso(value)}
        </span>
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{slip.employeeName}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {slip.position} · {slip.department}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatPeriodRange(slip.periodStart, slip.periodEnd)}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Earnings */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Earnings</p>
            <div className="border border-border rounded-lg px-4 py-1 divide-y divide-border">
              <Row label="Basic Pay"     value={slip.basicPay}    />
              <Row label="Overtime Pay"  value={slip.overtimePay} />
              <Row label="Allowances"    value={slip.allowances}  />
              <Row label="GROSS PAY"     value={slip.grossPay}    bold />
            </div>
          </div>

          {/* Deductions */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Deductions</p>
            <div className="border border-border rounded-lg px-4 py-1 divide-y divide-border">
              <Row label="SSS"              value={slip.sssContrib}        />
              <Row label="PhilHealth"       value={slip.philhealthContrib} />
              <Row label="Pag-IBIG"         value={slip.pagibigContrib}    />
              <Row label="Withholding Tax"  value={slip.withholdingTax}    />
              <Row label="Other"            value={slip.otherDeductions}   />
              <Row label="TOTAL DEDUCTIONS" value={slip.totalDeductions}   bold />
            </div>
          </div>

          {/* Net Pay */}
          <div className="rounded-lg px-4 py-3 flex items-center justify-between bg-[var(--accent-soft)]">
            <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>NET PAY</span>
            <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
              {formatPeso(slip.netPay)}
            </span>
          </div>

          {/* Hours */}
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Regular: <strong className="text-foreground">{slip.regularHours}h</strong></span>
            <span>Overtime: <strong className="text-foreground">{slip.overtimeHours}h</strong></span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PayslipsPage() {
  const { user }       = useAuthStore();
  const searchParams   = useSearchParams();
  const initialRunId   = searchParams.get('payRunId') ?? '';

  const isAdmin = isAdminRole(user?.role);
  const [selectedRunId, setSelectedRunId] = useState<string>(initialRunId);
  const [viewSlip, setViewSlip]           = useState<PayslipDto | null>(null);

  // Admin: fetch all pay runs for filter dropdown
  const { data: runs = [] } = useQuery<PayRunOption[]>({
    queryKey: ['payroll-runs'],
    queryFn: () => api.get('/payroll/runs').then((r) => r.data),
    enabled: isAdmin && !!user,
    staleTime: 60_000,
  });

  // Fetch payslips — admin uses ?payRunId=, employee uses /mine
  const { data: payslips = [], isLoading } = useQuery<PayslipDto[]>({
    queryKey: ['payslips', isAdmin ? selectedRunId : 'mine'],
    queryFn: () => {
      if (!isAdmin) return api.get('/payroll/payslips/mine').then((r) => r.data);
      const params = selectedRunId ? `?payRunId=${selectedRunId}` : '';
      return api.get(`/payroll/payslips${params}`).then((r) => r.data);
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Payslips</h1>
              {!isAdmin && (
                <p className="text-xs text-muted-foreground mt-0.5">Your payslip history</p>
              )}
            </div>
          </div>

          {/* Admin: Pay Run filter */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Pay Run:</label>
              <select
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1"
                value={selectedRunId}
                onChange={(e) => setSelectedRunId(e.target.value)}
              >
                <option value="">All Runs</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 p-4 sm:p-6">
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between gap-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : payslips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No payslips found.</p>
              {isAdmin && (
                <p className="text-xs mt-1">Process a pay run to generate payslips.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {isAdmin && (
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                    )}
                    {isAdmin && (
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Department</th>
                    )}
                    {!isAdmin && (
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pay Run</th>
                    )}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Period</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reg. Hrs</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">OT Hrs</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Basic Pay</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gross Pay</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Deductions</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net Pay</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payslips.map((slip) => (
                    <tr key={slip.id} className="hover:bg-muted/20 transition-colors">
                      {isAdmin && (
                        <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{slip.employeeName}</td>
                      )}
                      {isAdmin && (
                        <td className="px-4 py-3 text-muted-foreground">{slip.department}</td>
                      )}
                      {!isAdmin && (
                        <td className="px-4 py-3 text-muted-foreground">{slip.payRunLabel}</td>
                      )}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatPeriodRange(slip.periodStart, slip.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{slip.regularHours}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{slip.overtimeHours}</td>
                      <td className="px-4 py-3 text-right text-foreground">{formatPeso(slip.basicPay)}</td>
                      <td className="px-4 py-3 text-right text-foreground">{formatPeso(slip.grossPay)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatPeso(slip.totalDeductions)}</td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--accent)' }}>
                        {formatPeso(slip.netPay)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setViewSlip(slip)}
                          className="px-2.5 py-1 rounded text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {viewSlip && <PayslipModal slip={viewSlip} onClose={() => setViewSlip(null)} />}
    </div>
  );
}
