'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpCircle, ArrowDownCircle, PlusCircle, MinusCircle, ArrowRightLeft, Loader2,
  ChevronLeft, ChevronRight, Wrench, Banknote,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso, currencySymbol } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { toast } from 'sonner';
import { todayIso } from '@/lib/today';
import {
  type EntryType, type PaidFrom, type EntryForm,
  isTransfer as isTransferType, paidFromOptions, paidFromFor, pocketLabel,
  entryProblem, buildEntryPayload, reverseQuestion,
} from './entry-payload';

// What the payload looks like, and which kinds may be paid by the owner, live in
// ./entry-payload.ts where they are tested. This file is only the form.

const TYPES: { key: EntryType; label: string; hint: string; Icon: React.ElementType }[] = [
  { key: 'EXPENSE',            label: 'Expense',          hint: 'Money out for a cost',        Icon: ArrowUpCircle },
  { key: 'OTHER_INCOME',       label: 'Other income',     hint: 'Money in (not a sale)',       Icon: ArrowDownCircle },
  { key: 'EQUIPMENT_PURCHASE', label: 'Bought equipment', hint: 'Machine, fridge, furniture',  Icon: Wrench },
  { key: 'WAGES_PAID',         label: 'Paid wages',       hint: 'Staff pay handed out',        Icon: Banknote },
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

const PAID_FROM_LABEL: Record<PaidFrom, string> = {
  CASH:  'Cash on hand',
  BANK:  'Bank / GCash / Maya',
  OWNER: 'Owner paid (own money)',
};

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
  const [type, setType]           = useState<EntryType>('EXPENSE');
  const [amount, setAmount]       = useState('');
  const [date, setDate]           = useState(today());
  const [paidFrom, setPaidFrom]   = useState<PaidFrom>('CASH');
  const [category, setCategory]   = useState('OTHER');
  const [note, setNote]           = useState('');
  const [assetName, setAssetName] = useState('');

  const isTransfer  = isTransferType(type);
  const isExpense   = type === 'EXPENSE';
  const isEquipment = type === 'EQUIPMENT_PURCHASE';
  const pockets     = paidFromOptions(type);

  function pickType(next: EntryType) {
    setType(next);
    // "Owner paid" only exists for equipment and wages; fall back to cash elsewhere.
    setPaidFrom((p) => paidFromFor(next, p));
  }

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

  const form: EntryForm = { type, amount, date, paidFrom, category, note, assetName };

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post('/simple-entries', buildEntryPayload(form)).then((r) => r.data),
    onSuccess: (d: { description: string; amount: number }) => {
      toast.success(`Recorded: ${d.description} · ${formatPeso(d.amount)}`);
      setAmount(''); setNote(''); setAssetName('');
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
    const problem = entryProblem(form);
    if (problem) { toast.error(problem); return; }
    mutate();
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Record Entry</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Log money in and out that doesn&apos;t go through the till — rent, utilities, wages, equipment, owner cash, deposits.
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
          Sales and costs only — money you put in or take out yourself, cash↔bank transfers, and equipment you bought
          (something the shop owns, not a cost) don&rsquo;t change profit.
        </p>
      </div>

      <form onSubmit={submit} className="bg-card border border-border rounded-xl p-4 sm:p-5 space-y-5">
        {/* Type picker */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">What happened?</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TYPES.map((t) => {
              const active = type === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => pickType(t.key)}
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

        {/* What was bought (equipment only) */}
        {isEquipment && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">What was bought</label>
            <input
              type="text" maxLength={120} value={assetName} onChange={(e) => setAssetName(e.target.value)}
              placeholder="e.g. Espresso machine, chest freezer, 4 tables" className={INPUT}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Equipment is recorded as something the shop owns, not as this month&rsquo;s cost.
            </p>
          </div>
        )}

        {/* Where the money came from (hidden for transfers — those are fixed Cash↔Bank) */}
        {!isTransfer && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{pocketLabel(type)}</label>
            <div className={`grid gap-2 ${pockets.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
              {pockets.map((s) => (
                <button
                  key={s} type="button" onClick={() => setPaidFrom(s)}
                  className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                    paidFrom === s
                      ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  {PAID_FROM_LABEL[s]}
                </button>
              ))}
            </div>
            {paidFrom === 'OWNER' && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                The shop&rsquo;s cash and bank do not move. This counts as money the owner put into the business.
              </p>
            )}
          </div>
        )}

        {/* Note */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Note (optional)</label>
          <input
            type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. June rent, Meralco bill, Saturday pay for 2 baristas" className={INPUT}
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
                      onClick={() => { if (window.confirm(reverseQuestion(r, formatPeso(r.amount)))) reverse(r.id); }}
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
