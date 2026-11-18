'use client';
/**
 * Sync → My cash advance (CA).
 *
 * A staff member asks for part of their pay ahead of payday and sees what is
 * still owed. The owner or payroll master hands over the money; each payday
 * then takes the agreed amount back off the payslip.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Advance {
  id:              string;
  status:          'REQUESTED' | 'OPEN' | 'PAID' | 'REJECTED' | 'CANCELLED';
  amount:          number;
  perPayday:       number;
  balance:         number;
  reason:          string | null;
  givenAt:         string | null;
  rejectionReason: string | null;
  createdAt:       string;
  deductions:      { payRunLabel: string; amount: number; date: string }[];
}

const STATUS: Record<Advance['status'], { label: string; tint: string }> = {
  REQUESTED: { label: 'Waiting',          tint: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  OPEN:      { label: 'Paying back',      tint: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  PAID:      { label: 'Paid off',         tint: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  REJECTED:  { label: 'Not approved',     tint: 'bg-red-500/15 text-red-600' },
  CANCELLED: { label: 'Withdrawn',        tint: 'bg-muted text-muted-foreground' },
};

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day  = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium' });

export default function MyCashAdvancePage() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery<Advance[]>({
    queryKey: ['payroll-me-cash-advances'],
    queryFn:  () => api.get('/payroll/me/cash-advances').then((r) => r.data),
  });

  const owed    = rows.filter((r) => r.status === 'OPEN').reduce((s, r) => s + r.balance, 0);
  const waiting = rows.some((r) => r.status === 'REQUESTED');

  const [showForm,  setShowForm]  = useState(false);
  const [amount,    setAmount]    = useState('');
  const [perPayday, setPerPayday] = useState('');
  const [reason,    setReason]    = useState('');
  const amt = Number(amount);
  const per = Number(perPayday || amount);
  const paydays = amt > 0 && per > 0 ? Math.ceil(amt / per) : 0;

  const ask = useMutation({
    mutationFn: () => api.post('/payroll/me/cash-advances', { amount: amt, perPayday: per, reason }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-me-cash-advances'] });
      toast.success('Request sent. You will see here when it is approved.');
      setShowForm(false); setAmount(''); setPerPayday(''); setReason('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not send the request.'),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/me/cash-advances/${id}/withdraw`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payroll-me-cash-advances'] }); toast.success('Request withdrawn.'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not withdraw.'),
  });

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href="/payroll/me/requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Wallet className="h-6 w-6 text-[var(--accent)]" />
            Cash advance
          </h1>
          <p className="text-sm text-muted-foreground">Get part of your pay early. It comes off your payslips until it is paid back.</p>
        </div>
        {!waiting && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 shrink-0"
          >
            <Plus className="h-4 w-4" /> Ask
          </button>
        )}
      </header>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs text-muted-foreground">Still to pay back</div>
        <div className="text-2xl font-semibold tabular-nums">{peso(owed)}</div>
      </section>

      {showForm && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Ask for a cash advance</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">How much (₱)</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Take back each payday (₱)</span>
              <input inputMode="decimal" value={perPayday} onChange={(e) => setPerPayday(e.target.value)} placeholder={amount || 'all on the next payday'}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </label>
          </div>
          {paydays > 0 && (
            <p className="text-xs text-muted-foreground">
              Paid back over {paydays} payday{paydays > 1 ? 's' : ''}, {peso(Math.min(per, amt))} each.
            </p>
          )}
          <label className="text-sm block">
            <span className="block text-xs text-muted-foreground mb-1">What is it for?</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. rent, school fees, medicine"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
            <button
              onClick={() => ask.mutate()}
              disabled={ask.isPending || !(amt > 0) || !(per > 0) || per > amt || reason.trim().length < 3}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {ask.isPending ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">History</h2>
        </header>
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No cash advances yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium tabular-nums">{peso(r.amount)}</div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${STATUS[r.status].tint}`}>{STATUS[r.status].label}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.givenAt ? `Given ${day(r.givenAt)}` : `Asked ${day(r.createdAt)}`}
                  {' · '}{peso(r.perPayday)} each payday
                  {r.status === 'OPEN' && <> · <span className="text-foreground">{peso(r.balance)} left</span></>}
                </div>
                {r.reason && <div className="text-xs text-muted-foreground">For: {r.reason}</div>}
                {r.rejectionReason && <div className="text-xs text-red-600">Reason: {r.rejectionReason}</div>}
                {r.deductions.length > 0 && (
                  <ul className="text-xs text-muted-foreground pl-3 list-disc">
                    {r.deductions.map((d, i) => <li key={i}>{d.payRunLabel}: {peso(d.amount)}</li>)}
                  </ul>
                )}
                {r.status === 'REQUESTED' && (
                  <button onClick={() => withdraw.mutate(r.id)} disabled={withdraw.isPending}
                    className="text-xs text-muted-foreground underline hover:text-foreground">
                    Withdraw request
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
