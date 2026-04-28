'use client';

/**
 * Demo Sync — Payslips.
 *
 * Two view modes:
 *   - PERSONNEL VIEW: just the logged-in user's own payslip(s).  In demo
 *     mode the "logged-in user" is the demo owner.  This is what the
 *     average employee sees in the real app.
 *   - HR VIEW: all employees' payslips with summary cards.  This is
 *     what BUSINESS_OWNER / PAYROLL_MASTER sees in the real app.
 *
 * The badge at the top makes the active view explicit.
 */

import { useState } from 'react';
import { useDemoStore } from '@/lib/demo/store';
import type { DemoPayslip } from '@/lib/demo/types';
import { ChevronDown, ChevronRight, User, Users } from 'lucide-react';

const DEMO_OWNER_ID = 'demo-employee-owner';

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ViewMode = 'personnel' | 'hr';

export default function DemoPayslipsPage() {
  const payslips = useDemoStore((s) => s.payslips);
  const [view, setView] = useState<ViewMode>('personnel');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Personnel view: only the demo owner's payslip
  const myPayslips = payslips.filter((p) => p.employeeId === DEMO_OWNER_ID);
  // HR view: all payslips
  const allPayslips = payslips;

  const visiblePayslips = view === 'personnel' ? myPayslips : allPayslips;

  if (payslips.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Payslips</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">No payslips to display.</p>
      </div>
    );
  }

  const period = payslips[0];
  const periodStart = new Date(period.periodStart);
  const periodEnd = new Date(period.periodEnd);

  // Auto-expand the only payslip in personnel view for instant detail
  const shouldAutoExpand = view === 'personnel' && visiblePayslips.length === 1;

  // HR view stats
  const totalNetPay = allPayslips.reduce((s, p) => s + p.netPay, 0);
  const totalDeductions = allPayslips.reduce((s, p) => s + p.totalDeductions, 0);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Payslips</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Period: {periodStart.toLocaleDateString('en-PH', { month: 'long', day: 'numeric' })} —
            {' '}{periodEnd.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>

        {/* View mode toggle */}
        <div className="inline-flex rounded-lg p-1 bg-stone-100 dark:bg-stone-800 text-sm">
          <button
            onClick={() => {
              setView('personnel');
              setExpanded(null);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
              view === 'personnel'
                ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
            }`}
          >
            <User className="w-4 h-4" />
            Personnel
          </button>
          <button
            onClick={() => {
              setView('hr');
              setExpanded(null);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
              view === 'hr'
                ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
            }`}
          >
            <Users className="w-4 h-4" />
            HR
          </button>
        </div>
      </div>

      {/* View mode badge */}
      {view === 'personnel' ? (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold uppercase tracking-wide">
          <User className="w-3.5 h-3.5" />
          Personnel View — your own payslip only
        </div>
      ) : (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-semibold uppercase tracking-wide">
          <Users className="w-3.5 h-3.5" />
          HR View — all employee payslips
        </div>
      )}

      {/* HR-only summary cards */}
      {view === 'hr' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard label="Employees paid" value={String(allPayslips.length)} />
          <SummaryCard label="Total net pay" value={peso(totalNetPay)} />
          <SummaryCard label="Total deductions" value={peso(totalDeductions)} />
        </div>
      )}

      {/* Personnel view: maybe just one payslip — or nothing if owner has none */}
      {view === 'personnel' && visiblePayslips.length === 0 ? (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-6 text-center text-sm text-stone-500 dark:text-stone-400">
          You don't have a payslip for this period.
        </div>
      ) : (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {visiblePayslips.map((slip) => (
              <PayslipRow
                key={slip.id}
                slip={slip}
                isExpanded={shouldAutoExpand || expanded === slip.id}
                onToggle={() =>
                  setExpanded((cur) => (cur === slip.id ? null : slip.id))
                }
                showName={view === 'hr'}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</p>
      <p className="text-xl font-bold text-stone-900 dark:text-stone-100 mt-1">{value}</p>
    </div>
  );
}

function PayslipRow({
  slip,
  isExpanded,
  onToggle,
  showName,
}: {
  slip: DemoPayslip;
  isExpanded: boolean;
  onToggle: () => void;
  showName: boolean;
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-stone-50 dark:hover:bg-stone-800/50 text-left"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-stone-400 dark:text-stone-500 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          {showName ? (
            <>
              <p className="font-medium text-stone-900 dark:text-stone-100">{slip.employeeName}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {slip.daysWorked} days · {slip.hoursWorked.toFixed(0)} hours
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-stone-900 dark:text-stone-100">
                {new Date(slip.periodStart).toLocaleDateString('en-PH', { month: 'long' })}{' '}
                {new Date(slip.periodEnd).getFullYear()}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {slip.daysWorked} days · {slip.hoursWorked.toFixed(0)} hours · {slip.employeeName}
              </p>
            </>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-stone-900 dark:text-stone-100">{peso(slip.netPay)}</p>
          <p className="text-[10px] text-stone-500 dark:text-stone-400 uppercase">Net Pay</p>
        </div>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 ml-7 mr-4 mb-2 bg-stone-50 dark:bg-stone-800/40 rounded-lg overflow-hidden border border-stone-200 dark:border-stone-700">
          <div className="p-4 space-y-2 text-sm">
            <SectionHeader>Earnings</SectionHeader>
            <Row label="Basic pay" value={slip.basicPay} />
            <Row label="Overtime" value={slip.overtimePay} />
            <Row label="Allowances" value={slip.allowances} />
            <Row label="Gross pay" value={slip.grossPay} bold />

            <SectionHeader>Deductions</SectionHeader>
            <Row label="SSS contribution" value={slip.sssContribution} negative />
            <Row label="PhilHealth contribution" value={slip.philhealthContribution} negative />
            <Row label="Pag-IBIG contribution" value={slip.pagibigContribution} negative />
            <Row label="Withholding tax" value={slip.withholdingTax} negative />
            <Row label="Total deductions" value={slip.totalDeductions} negative bold />

            <div className="border-t border-stone-300 dark:border-stone-600 pt-2 mt-2">
              <Row label="NET PAY" value={slip.netPay} bold large />
            </div>

            <p className="text-[10px] text-stone-400 dark:text-stone-500 italic mt-2 text-center">
              {slip.isPaid && slip.paidAt
                ? `Paid on ${new Date(slip.paidAt).toLocaleDateString('en-PH')}`
                : 'Pending'}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 font-semibold border-b border-stone-200 dark:border-stone-700 pb-1 mt-3 first:mt-0">
      {children}
    </p>
  );
}

function Row({
  label,
  value,
  bold = false,
  negative = false,
  large = false,
}: {
  label: string;
  value: number;
  bold?: boolean;
  negative?: boolean;
  large?: boolean;
}) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''} ${large ? 'text-base' : ''}`}>
      <span className={negative ? 'text-stone-600 dark:text-stone-400' : 'text-stone-700 dark:text-stone-300'}>
        {label}
      </span>
      <span
        className={
          negative && value > 0
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-stone-900 dark:text-stone-100'
        }
      >
        {negative && value > 0 ? '-' : ''}
        {peso(value)}
      </span>
    </div>
  );
}
