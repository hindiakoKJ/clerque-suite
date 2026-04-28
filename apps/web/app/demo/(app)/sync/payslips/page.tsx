'use client';

/**
 * Demo Sync — Payslips.  Last month's payslips for the demo employees,
 * showing gross pay, SSS / PhilHealth / Pag-IBIG / Withholding Tax
 * deductions, and net pay.
 */

import { useState } from 'react';
import { useDemoStore } from '@/lib/demo/store';
import type { DemoPayslip } from '@/lib/demo/types';
import { ChevronDown, ChevronRight } from 'lucide-react';

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DemoPayslipsPage() {
  const payslips = useDemoStore((s) => s.payslips);
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalNetPay = payslips.reduce((s, p) => s + p.netPay, 0);
  const totalDeductions = payslips.reduce((s, p) => s + p.totalDeductions, 0);

  if (payslips.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="text-xl font-semibold text-stone-900">Payslips</h1>
        <p className="text-sm text-stone-500 mt-1">No payslips to display.</p>
      </div>
    );
  }

  const period = payslips[0];
  const periodStart = new Date(period.periodStart);
  const periodEnd = new Date(period.periodEnd);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Payslips</h1>
        <p className="text-sm text-stone-500">
          Period: {periodStart.toLocaleDateString('en-PH', { month: 'long', day: 'numeric' })} —
          {' '}{periodEnd.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="Employees paid" value={String(payslips.length)} />
        <SummaryCard label="Total net pay" value={peso(totalNetPay)} />
        <SummaryCard label="Total deductions" value={peso(totalDeductions)} />
      </div>

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <ul className="divide-y divide-stone-100">
          {payslips.map((slip) => (
            <PayslipRow
              key={slip.id}
              slip={slip}
              isExpanded={expanded === slip.id}
              onToggle={() => setExpanded((cur) => (cur === slip.id ? null : slip.id))}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-wider text-stone-500">{label}</p>
      <p className="text-xl font-bold text-stone-900 mt-1">{value}</p>
    </div>
  );
}

function PayslipRow({
  slip,
  isExpanded,
  onToggle,
}: {
  slip: DemoPayslip;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-stone-50 text-left"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-stone-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-stone-400 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-stone-900">{slip.employeeName}</p>
          <p className="text-xs text-stone-500">
            {slip.daysWorked} days · {slip.hoursWorked.toFixed(0)} hours
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-stone-900">{peso(slip.netPay)}</p>
          <p className="text-[10px] text-stone-500 uppercase">Net Pay</p>
        </div>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 ml-7 mr-4 mb-2 bg-stone-50 rounded-lg overflow-hidden border border-stone-200">
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

            <div className="border-t border-stone-300 pt-2 mt-2">
              <Row label="NET PAY" value={slip.netPay} bold large />
            </div>

            <p className="text-[10px] text-stone-400 italic mt-2 text-center">
              {slip.isPaid ? `Paid on ${new Date(slip.paidAt!).toLocaleDateString('en-PH')}` : 'Pending'}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold border-b border-stone-200 pb-1 mt-3 first:mt-0">
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
      <span className={negative ? 'text-stone-600' : 'text-stone-700'}>
        {label}
      </span>
      <span className={negative && value > 0 ? 'text-rose-600' : 'text-stone-900'}>
        {negative && value > 0 ? '-' : ''}{peso(value)}
      </span>
    </div>
  );
}
