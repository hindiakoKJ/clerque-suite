'use client';
/**
 * Sync → Cash advances (owner and payroll master).
 *
 * Staff requests wait here. Handing over the money records where it came
 * from and posts DR 1034 Advances to Employees / CR that cash or bank
 * account. Each processed pay run then takes the agreed amount back off the
 * payslip, never more than the pay left after SSS, PhilHealth, Pag-IBIG and
 * tax.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Advance {
  id:              string;
  userId:          string;
  employeeName:    string;
  status:          'REQUESTED' | 'OPEN' | 'PAID' | 'REJECTED' | 'CANCELLED';
  amount:          number;
  perPayday:       number;
  balance:         number;
  reason:          string | null;
  paidFrom:        string | null;
  givenAt:         string | null;
  rejectionReason: string | null;
  createdAt:       string;
  deductions:      { payRunLabel: string; amount: number; date: string }[];
}
interface Employee { id: string; name: string; status?: string }

const PAID_FROM: { code: string; label: string }[] = [
  { code: '1010', label: 'Cash on hand' },
  { code: '1011', label: 'Petty cash' },
  { code: '1020', label: 'Bank (current account)' },
  { code: '1022', label: 'Bank (payroll account)' },
];

const STATUS: Record<Advance['status'], { label: string; tint: string }> = {
  REQUESTED: { label: 'Waiting',      tint: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  OPEN:      { label: 'Paying back',  tint: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  PAID:      { label: 'Paid off',     tint: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  REJECTED:  { label: 'Not approved', tint: 'bg-red-500/15 text-red-600' },
  CANCELLED: { label: 'Cancelled',    tint: 'bg-muted text-muted-foreground' },
};

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day  = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });
const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const errMsg = (e: any, fallback: string) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m ?? fallback;
};

export default function CashAdvancesPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['payroll-cash-advances'] });

  const { data: rows = [], isLoading } = useQuery<Advance[]>({
    queryKey: ['payroll-cash-advances'],
    queryFn:  () => api.get('/payroll/cash-advances').then((r) => r.data),
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['payroll-employees'],
    queryFn:  () => api.get('/payroll/employees').then((r) => r.data),
  });

  const waiting = rows.filter((r) => r.status === 'REQUESTED');
  const open    = rows.filter((r) => r.status === 'OPEN');
  const done    = rows.filter((r) => r.status !== 'REQUESTED' && r.status !== 'OPEN');
  const owed    = open.reduce((s, r) => s + r.balance, 0);

  // ── Give one directly ──
  const [showGive, setShowGive] = useState(false);
  const [g, setG] = useState({ userId: '', amount: '', perPayday: '', paidFrom: '1010', reason: '', givenOn: '' });
  const give = useMutation({
    mutationFn: () => api.post('/payroll/cash-advances', {
      userId: g.userId, amount: Number(g.amount), perPayday: Number(g.perPayday || g.amount),
      paidFrom: g.paidFrom, reason: g.reason || undefined, givenOn: g.givenOn || undefined,
    }).then((r) => r.data),
    onSuccess: () => {
      refresh(); toast.success('Cash advance recorded.');
      setShowGive(false); setG({ userId: '', amount: '', perPayday: '', paidFrom: '1010', reason: '', givenOn: '' });
    },
    onError: (e: any) => toast.error(errMsg(e, 'Could not record the advance.')),
  });

  // ── Decide a request ──
  const [deciding, setDeciding] = useState<string | null>(null);
  const [d, setD] = useState({ amount: '', perPayday: '', paidFrom: '1010', rejectReason: '' });
  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/cash-advances/${id}/approve`, {
      paidFrom: d.paidFrom,
      amount:    d.amount    ? Number(d.amount)    : undefined,
      perPayday: d.perPayday ? Number(d.perPayday) : undefined,
    }).then((r) => r.data),
    onSuccess: () => { refresh(); setDeciding(null); toast.success('Approved. The money is recorded as handed over.'); },
    onError: (e: any) => toast.error(errMsg(e, 'Could not approve.')),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/cash-advances/${id}/reject`, { reason: d.rejectReason }).then((r) => r.data),
    onSuccess: () => { refresh(); setDeciding(null); toast.success('Request turned down.'); },
    onError: (e: any) => toast.error(errMsg(e, 'Could not turn it down.')),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/cash-advances/${id}/cancel`).then((r) => r.data),
    onSuccess: () => { refresh(); toast.success('Advance cancelled and its entry reversed.'); },
    onError: (e: any) => toast.error(errMsg(e, 'Could not cancel.')),
  });

  const openDecide = (r: Advance) => {
    setDeciding(r.id);
    setD({ amount: String(r.amount), perPayday: String(r.perPayday), paidFrom: '1010', rejectReason: '' });
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Wallet className="h-6 w-6 text-[var(--accent)]" />
            Cash advances
          </h1>
          <p className="text-sm text-muted-foreground">
            Pay staff part of their salary early. Each pay run takes the agreed amount back off the payslip.
          </p>
        </div>
        <button onClick={() => setShowGive(!showGive)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 shrink-0">
          <Plus className="h-4 w-4" /> Record one
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Staff still owe</div>
          <div className="text-2xl font-semibold tabular-nums">{peso(owed)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Requests waiting</div>
          <div className="text-2xl font-semibold tabular-nums">{waiting.length}</div>
        </div>
      </section>

      {showGive && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Record a cash advance you handed over</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Staff member</span>
              <select value={g.userId} onChange={(e) => setG({ ...g, userId: e.target.value })} className={input}>
                <option value="">Choose…</option>
                {employees.filter((e) => e.status !== 'INACTIVE').map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Paid from</span>
              <select value={g.paidFrom} onChange={(e) => setG({ ...g, paidFrom: e.target.value })} className={input}>
                {PAID_FROM.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Amount (₱)</span>
              <input inputMode="decimal" value={g.amount} onChange={(e) => setG({ ...g, amount: e.target.value })} className={input} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Take back each payday (₱)</span>
              <input inputMode="decimal" value={g.perPayday} onChange={(e) => setG({ ...g, perPayday: e.target.value })}
                placeholder={g.amount || 'all on the next payday'} className={input} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Date given</span>
              <input type="date" value={g.givenOn} onChange={(e) => setG({ ...g, givenOn: e.target.value })} className={input} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">What it is for (optional)</span>
              <input value={g.reason} onChange={(e) => setG({ ...g, reason: e.target.value })} className={input} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Cash taken out of a till during a shift is not covered here yet; the shift would count it as short.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowGive(false)} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
            <button onClick={() => give.mutate()} disabled={give.isPending || !g.userId || !(Number(g.amount) > 0)}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {give.isPending ? 'Saving…' : 'Record advance'}
            </button>
          </div>
        </section>
      )}

      {/* Waiting requests */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border"><h2 className="text-sm font-semibold">Requests waiting</h2></header>
        {waiting.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{isLoading ? 'Loading…' : 'No requests waiting.'}</p>
        ) : (
          <ul className="divide-y divide-border">
            {waiting.map((r) => (
              <li key={r.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{r.employeeName}</div>
                    <div className="text-xs text-muted-foreground">
                      Asked {day(r.createdAt)} · {peso(r.amount)}, {peso(r.perPayday)} each payday
                      {r.reason && <> · For: {r.reason}</>}
                    </div>
                  </div>
                  {deciding !== r.id && (
                    <button onClick={() => openDecide(r)} className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted shrink-0">Decide</button>
                  )}
                </div>
                {deciding === r.id && (
                  <div className="rounded-lg bg-muted/40 p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="text-sm">
                        <span className="block text-xs text-muted-foreground mb-1">Amount (₱)</span>
                        <input inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} className={input} />
                      </label>
                      <label className="text-sm">
                        <span className="block text-xs text-muted-foreground mb-1">Each payday (₱)</span>
                        <input inputMode="decimal" value={d.perPayday} onChange={(e) => setD({ ...d, perPayday: e.target.value })} className={input} />
                      </label>
                      <label className="text-sm">
                        <span className="block text-xs text-muted-foreground mb-1">Paid from</span>
                        <select value={d.paidFrom} onChange={(e) => setD({ ...d, paidFrom: e.target.value })} className={input}>
                          {PAID_FROM.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button onClick={() => setDeciding(null)} className="px-3 py-1.5 rounded-lg text-sm hover:bg-muted">Close</button>
                      <button onClick={() => approve.mutate(r.id)} disabled={approve.isPending}
                        className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
                        {approve.isPending ? 'Saving…' : 'Approve and hand over'}
                      </button>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 pt-1 border-t border-border">
                      <input value={d.rejectReason} onChange={(e) => setD({ ...d, rejectReason: e.target.value })}
                        placeholder="Reason, if turning it down" className={input} />
                      <button onClick={() => reject.mutate(r.id)} disabled={reject.isPending || d.rejectReason.trim().length < 3}
                        className="px-3 py-1.5 rounded-lg text-sm text-red-600 border border-red-500/40 hover:bg-red-500/10 disabled:opacity-50 shrink-0">
                        Turn down
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Being paid back + history */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border"><h2 className="text-sm font-semibold">Advances</h2></header>
        {open.length + done.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{isLoading ? 'Loading…' : 'No advances yet.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Staff</th>
                  <th className="px-4 py-2 font-medium">Given</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium text-right">Each payday</th>
                  <th className="px-4 py-2 font-medium text-right">Left</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...open, ...done].map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <div>{r.employeeName}</div>
                      {r.paidFrom && <div className="text-xs text-muted-foreground">from {r.paidFrom.toLowerCase()}</div>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{r.givenAt ? day(r.givenAt) : '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{peso(r.amount)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{peso(r.perPayday)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{peso(r.balance)}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${STATUS[r.status].tint}`}>{STATUS[r.status].label}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.status === 'OPEN' && r.deductions.length === 0 && (
                        <button
                          onClick={() => { if (confirm(`Cancel ${r.employeeName}'s ${peso(r.amount)} advance and reverse its entry?`)) cancel.mutate(r.id); }}
                          className="text-xs text-muted-foreground underline hover:text-foreground">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
