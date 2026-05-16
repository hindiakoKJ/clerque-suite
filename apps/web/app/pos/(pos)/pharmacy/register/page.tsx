'use client';
/**
 * Pharmacy → Controlled Substance Register (DDB)
 *
 * RA 9165 Dangerous Drugs Act compliance — read-only audit view of every
 * controlled-drug dispense. Each row = one OrderItem dispense, captured
 * with patient ID, prescribing doctor PRC + S2 license, and dispensing
 * pharmacist's PRC license.
 *
 * Write access restricted server-side to BUSINESS_OWNER / BRANCH_MANAGER /
 * SALES_LEAD / CASHIER. View access here is BUSINESS_OWNER /
 * BRANCH_MANAGER only.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, ArrowLeft, Calendar } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface RegisterEntry {
  id:                string;
  orderItemId:       string;
  prescriptionId:    string | null;
  patientName:       string;
  patientIdType:     string;
  patientIdNumber:   string;
  doctorName:        string;
  doctorPrcLicense:  string;
  doctorS2License:   string;
  pharmacistPrc:     string;
  drugName:          string;
  drugStrength:      string | null;
  quantityDispensed: string;
  dispensedAt:       string;
}

function defaultRange() {
  const to   = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), 1);
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  };
}

export default function ControlledRegisterPage() {
  const router = useRouter();
  const [range, setRange] = useState(defaultRange());

  const { data: entries = [], isFetching } = useQuery<RegisterEntry[]>({
    queryKey: ['pharmacy-controlled-register', range.from, range.to],
    queryFn:  () => api.get('/pharmacy/controlled-register', {
      params: {
        from: new Date(range.from).toISOString(),
        to:   new Date(range.to + 'T23:59:59').toISOString(),
      },
    }).then((r) => r.data),
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-card border-b border-border px-4 sm:px-6 py-5 shrink-0 flex items-center gap-3 flex-wrap">
        <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <ShieldAlert className="h-5 w-5 text-[var(--counter-error)]" />
        <h1 className="font-display text-xl font-bold tracking-tight">DDB Controlled-Substance Register</h1>
        <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase font-mono-counter bg-[var(--counter-error-soft)] text-[var(--counter-error-deep)]">
          RA 9165
        </span>
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 overflow-auto">
        <div className="rounded-lg bg-[var(--counter-warning-soft)] border border-[var(--counter-warning)]/40 px-4 py-3 text-xs text-[var(--counter-warning-deep)] flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <strong>RA 9165 Dangerous Drugs Act register.</strong> This log is required by the Philippine
            Dangerous Drugs Board. Records here cannot be deleted or modified after creation. Any
            discrepancies must be reported to your DDB inspector.
          </div>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">From</span>
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm block">
            <span className="text-xs text-muted-foreground">To</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </label>
        </div>

        {/* Register table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {isFetching ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading register…</div>
          ) : entries.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No controlled-substance dispenses in this date range.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b-2 border-border bg-muted/50">
                    <th className="px-3 py-3 font-bold whitespace-nowrap">Dispensed</th>
                    <th className="px-3 py-3 font-bold">Drug</th>
                    <th className="px-3 py-3 font-bold text-right">Qty</th>
                    <th className="px-3 py-3 font-bold">Patient</th>
                    <th className="px-3 py-3 font-bold">Patient ID</th>
                    <th className="px-3 py-3 font-bold">Doctor</th>
                    <th className="px-3 py-3 font-bold">PRC / S2</th>
                    <th className="px-3 py-3 font-bold">Pharmacist PRC</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-border/60 last:border-b-0">
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap tnum">
                        <Calendar className="h-3 w-3 inline mr-1 text-muted-foreground" />
                        {new Date(e.dispensedAt).toLocaleString('en-PH', {
                          dateStyle: 'medium', timeStyle: 'short',
                        })}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold">{e.drugName}</div>
                        {e.drugStrength && <div className="text-[10px] text-muted-foreground">{e.drugStrength}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-counter tnum">{Number(e.quantityDispensed).toFixed(2)}</td>
                      <td className="px-3 py-2.5">{e.patientName}</td>
                      <td className="px-3 py-2.5 text-xs">
                        <div>{e.patientIdType}</div>
                        <div className="text-[10px] font-mono-counter text-muted-foreground">{e.patientIdNumber}</div>
                      </td>
                      <td className="px-3 py-2.5">{e.doctorName}</td>
                      <td className="px-3 py-2.5 font-mono-counter text-[10px]">
                        <div>PRC: {e.doctorPrcLicense}</div>
                        <div className="text-muted-foreground">S2: {e.doctorS2License}</div>
                      </td>
                      <td className="px-3 py-2.5 font-mono-counter text-xs">{e.pharmacistPrc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Showing {entries.length} record{entries.length === 1 ? '' : 's'}.
          {entries.length >= 100 && ' Increase date range — listing capped at 500 most recent.'}
        </p>
      </div>
    </div>
  );
}
