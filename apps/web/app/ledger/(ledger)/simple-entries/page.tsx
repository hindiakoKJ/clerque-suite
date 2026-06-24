'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpCircle, ArrowDownCircle, PlusCircle, MinusCircle, ArrowRightLeft, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

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
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const INPUT =
  'w-full rounded-lg border border-border bg-input text-foreground px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent)_25%,transparent)]';

export default function SimpleEntriesPage() {
  const qc = useQueryClient();
  const [type, setType]         = useState<EntryType>('EXPENSE');
  const [amount, setAmount]     = useState('');
  const [date, setDate]         = useState(today());
  const [source, setSource]     = useState<'CASH' | 'BANK'>('CASH');
  const [category, setCategory] = useState('OTHER');
  const [note, setNote]         = useState('');

  const isTransfer = type === 'DEPOSIT_TO_BANK' || type === 'WITHDRAW_TO_CASH';
  const isExpense  = type === 'EXPENSE';
  const sourceLabel = isExpense || type === 'OWNER_DRAWING' ? 'Paid from' : 'Received in';

  const { data: recent = [], isLoading } = useQuery<RecentEntry[]>({
    queryKey: ['simple-entries'],
    queryFn:  () => api.get('/simple-entries').then((r) => r.data),
  });

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
      toast.success(`Recorded: ${d.description} · ${formatPeso(d.amount * 100)}`);
      setAmount(''); setNote('');
      qc.invalidateQueries({ queryKey: ['simple-entries'] });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e?.response?.data?.message ?? 'Could not save. Please try again.'),
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
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Amount (₱)</label>
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
              <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{r.description}</div>
                  <div className="text-xs text-muted-foreground">{new Date(r.date).toLocaleDateString('en-PH')} · {r.entryNumber}</div>
                </div>
                <div className="font-mono font-semibold text-foreground shrink-0 ml-3">{formatPeso(r.amount * 100)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
