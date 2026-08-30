'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpCircle, ArrowDownCircle, PlusCircle, MinusCircle, ArrowRightLeft, Loader2,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso, currencySymbol } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';
import { todayIso } from '@/lib/today';

type EntryType =
  | 'EXPENSE' | 'OTHER_INCOME' | 'OWNER_CONTRIBUTION'
  | 'OWNER_DRAWING' | 'DEPOSIT_TO_BANK' | 'WITHDRAW_TO_CASH';

const TYPES: { key: EntryType; label: string; hint: string; Icon: React.ElementType }[] = [
  { key: 'EXPENSE',            label: 'Expense',          hint: 'Money out for a cost',        Icon: ArrowUpCircle },
  { key: 'OTHER_INCOME',       label: 'Other income',     hint: 'Money in (not a sale)',       Icon: ArrowDownCircle },
  { key: 'OWNER_CONTRIBUTION', label: 'Owner put in',     hint: 'Owner added money',           Icon: PlusCircle },
  { key: 'OWNER_DRAWING',      label: 'Owner took out',   hint: 'Owner took money',            Icon: MinusCircle },
  { key: 'DEPOSIT_TO_BANK',    label: 'Cash → Bank',      hint: 'Deposited till cash',         Icon: ArrowRightLeft },
  { key: 'WITHDRAW_TO_CASH',   label: 'Bank → Cash',      hint: 'Took cash from bank',         Icon: ArrowRightLeft },
];

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'RENT', label: 'Rent' }, { key: 'UTILITIES', label: 'Utilities' },
  { key: 'SUPPLIES', label: 'Supplies' }, { key: 'REPAIRS', label: 'Repairs' },
  { key: 'TRANSPORT', label: 'Transport' }, { key: 'OTHER', label: 'Other' },
];

interface RecentEntry {
  id: string; entryNumber: string; date: string; description: string; amount: number;
  reversed: boolean; reversedByNumber: string | null;
}

interface ProfitSummary {
  from: string; to: string; moneyIn: number; moneyOut: number; profit: number; currency: string;
}

function today(): string {
  return todayIso();
}

/** First/last day of a month as YYYY-MM-DD (month is 0-based, local calendar). */
function monthRange(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(lastDay)}` };
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

const INPUT =
  'w-full rounded-lg border border-border bg-input text-foreground px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent)_25%,transparent)]';

export default function SimpleEntriesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [type, setType]         = useState<EntryType>('EXPENSE');
  const [amount, setAmount]     = useState('');
  const [date, setDate]         = useState(today());
  const [source, setSource]     = useState<'CASH' | 'BANK'>('CASH');
  const [category, setCategory] = useState('OTHER');
  const [note, setNote]         = useState('');

  const isTransfer = type === 'DEPOSIT_TO_BANK' || type === 'WITHDRAW_TO_CASH';
  const isExpense  = type === 'EXPENSE';
  const sourceLabel = isExpense || type === 'OWNER_DRAWING' ? 'Paid from' : 'Received in';

  const now = new Date();
  const [month, setMonth]       = useState<{ year: number; month: number }>({ year: now.getFullYear(), month: now.getMonth() });
  const isCurrentMonth = month.year === now.getFullYear() && month.month === now.getMonth();
  const range = monthRange(month.year, month.month);

  const { data: recent = [], isLoading } = useQuery<RecentEntry[]>({
    queryKey: ['simple-entries'],
    queryFn:  () => api.get('/simple-entries').then((r) => r.data),
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<ProfitSummary>({
    queryKey: ['simple-entries-summary', range.from, range.to],
    queryFn:  () => api.get('/simple-entries/summary', { params: range }).then((r) => r.data),
  });

  function shiftMonth(delta: number) {
    setMonth((m) => {
      const d = new Date(m.year, m.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      api.post('/simple-entries', {
        type,
        amount: Number(amount),
        date,
        ...(isTransfer ? {} : { source }),
        ...(isExpense ? { category } : {}),
        note: note.trim() || undefined,
      }).then((r) => r.data),
    onSuccess: (d: { description: string; amount: number }) => {
      toast.success(`Recorded: ${d.description} · ${formatPeso(d.amount)}`);
      setAmount(''); setNote('');
      qc.invalidateQueries({ queryKey: ['simple-entries'] });
      qc.invalidateQueries({ queryKey: ['simple-entries-summary'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e?.response?.data?.message ?? 'Could not save. Please try again.'),
  });

  const { mutate: reverse, isPending: reversing } = useMutation({
    mutationFn: (id: string) => api.post(`/simple-entries/${id}/reverse`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Entry reversed.');
      qc.invalidateQueries({ queryKey: ['simple-entries'] });
      qc.invalidateQueries({ queryKey: ['simple-entries-summary'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e?.response?.data?.message ?? 'Could not reverse. Please try again.'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error('Enter an amount greater than zero.'); return; }
    mutate();
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Record Entry</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Log money in and out that doesn&apos;t go through the till — rent, utilities, owner cash, deposits.
          Every entry is saved to your books automatically.
        </p>
      </div>

      {/* Profit card */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-foreground">
            {isCurrentMonth ? 'This month' : monthLabel(month.year, month.month)}
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month"
              className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted/40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-muted-foreground min-w-[7.5rem] text-center">
              {monthLabel(month.year, month.month)}
            </span>
            <button
              type="button" onClick={() => shiftMonth(1)} disabled={isCurrentMonth} aria-label="Next month"
              className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Money in</div>
            <div className="font-mono font-semibold text-foreground text-sm sm:text-base">
              {summaryLoading || !summary ? '—' : formatPeso(summary.moneyIn)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Money out</div>
            <div className="font-mono font-semibold text-foreground text-sm sm:text-base">
              {summaryLoading || !summary ? '—' : formatPeso(summary.moneyOut)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Profit</div>
            <div className={`font-mono font-semibold text-sm sm:text-base ${
              !summary ? 'text-foreground' : summary.profit >= 0 ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {summaryLoading || !summary ? '—' : formatPeso(summary.profit)}
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Sales and expenses only — money you put in or take out yourself, and cash↔bank transfers, don&rsquo;t change profit.
        </p>
      </div>

      <form onSubmit={submit} className="bg-card border border-border rounded-xl p-4 sm:p-5 space-y-5">
        {/* Type picker */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">What happened?</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TYPES.map((t) => {
              const active = type === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setType(t.key)}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]'
                      : 'border-border bg-background hover:bg-muted/40'
                  }`}
                >
                  <t.Icon className={`w-5 h-5 ${active ? 'text-[var(--accent)]' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium text-foreground">{t.label}</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">{t.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount + date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Amount ({currencySymbol(user?.currency ?? 'PHP')})</label>
            <input
              type="number" inputMode="decimal" min="0.01" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={INPUT} autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </div>
        </div>

        {/* Expense category */}
        {isExpense && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT}>
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        )}

        {/* Funding source (hidden for transfers — those are fixed Cash↔Bank) */}
        {!isTransfer && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{sourceLabel}</label>
            <div className="grid grid-cols-2 gap-2">
              {(['CASH', 'BANK'] as const).map((s) => (
                <button
                  key={s} type="button" onClick={() => setSource(s)}
                  className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                    source === s
                      ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  {s === 'CASH' ? 'Cash on hand' : 'Bank / GCash / Maya'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Note */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Note (optional)</label>
          <input
            type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. June rent, Meralco bill, supplier deposit" className={INPUT}
          />
        </div>

        <button
          type="submit" disabled={isPending}
          className="w-full rounded-lg bg-[var(--accent)] text-white font-semibold py-3 text-sm hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Save entry
        </button>
      </form>

      {/* Recent entries */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Recent entries</h2>
        </div>
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No entries yet. Your first one will show here.</div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className={`font-medium truncate ${r.reversed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{r.description}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{new Date(r.date).toLocaleDateString('en-PH')} · {r.entryNumber}</span>
                    {r.reversed && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Reversed</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`font-mono font-semibold ${r.reversed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{formatPeso(r.amount)}</span>
                  {!r.reversed && (
                    <button
                      type="button"
                      onClick={() => { if (window.confirm('Reverse this entry? This posts an offsetting entry to undo it. The original stays for your records.')) reverse(r.id); }}
                      disabled={reversing}
                      className="text-xs text-muted-foreground hover:text-red-500 underline disabled:opacity-50"
                    >
                      Reverse
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
