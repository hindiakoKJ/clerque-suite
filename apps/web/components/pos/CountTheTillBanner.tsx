'use client';
import { useEffect, useState } from 'react';
import { Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useShiftStore } from '@/store/pos/shift';

/**
 * The till asking to be counted.
 *
 * A soft control, and the softest one there is. Nothing is blocked, nothing is
 * reported to anyone, and the cashier can wave it away and carry on serving.
 * What it buys is time: a drawer counted every couple of hours narrows a
 * shortage to a couple of hours of trading, instead of to a whole day and
 * everyone who touched the money in it.
 *
 * The clock comes from the server and runs from the last count, or from the
 * drawer opening when there has not been one — so a cashier who counts often
 * is never nagged for it. Nothing here polls: the moment it is due is a fixed
 * time the shift already carries, so a local tick is enough to notice it
 * passing, and the banner re-arms by itself after a count.
 */

const SNOOZE_MINUTES = 15;
const TICK_MS = 30_000;
const snoozeKey = (shiftId: string, dueAt: string) => `pos-count-snooze:${shiftId}:${dueAt}`;

export function CountTheTillBanner({ onCounted }: { onCounted?: () => void }) {
  const activeShift = useShiftStore((s) => s.activeShift);
  const check = activeShift?.countCheck ?? null;

  const [now, setNow] = useState(() => Date.now());
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [counting, setCounting] = useState(false);
  const [declared, setDeclared] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // A snooze survives a reload, so a refreshed tab does not ask again at once.
  useEffect(() => {
    if (!activeShift || !check) return;
    try {
      const saved = window.localStorage.getItem(snoozeKey(activeShift.id, check.dueAt));
      setSnoozedUntil(saved ? Number(saved) || 0 : 0);
    } catch {
      setSnoozedUntil(0);
    }
    setCounting(false);
    setDeclared('');
  }, [activeShift?.id, check?.dueAt]);

  if (!activeShift || !check) return null;
  const due = new Date(check.dueAt).getTime();
  if (now < due || now < snoozedUntil) return null;

  const hours = Math.floor((now - new Date(check.since).getTime()) / 3_600_000);
  const sinceWhat = check.lastCountedAt ? 'since the last count' : 'since the drawer was opened';
  const howLong = hours >= 1 ? `It has been about ${hours} hour${hours === 1 ? '' : 's'} ${sinceWhat}.` : '';

  function snooze() {
    const until = Date.now() + SNOOZE_MINUTES * 60_000;
    setSnoozedUntil(until);
    try { window.localStorage.setItem(snoozeKey(activeShift!.id, check!.dueAt), String(until)); } catch { /* a private tab just asks again */ }
  }

  async function record() {
    const amount = Number(declared);
    if (!Number.isFinite(amount) || amount < 0) { toast.error('Enter what is in the drawer.'); return; }
    setBusy(true);
    try {
      const { data } = await api.post<{ declaredCash: number; expectedCash: number; variance: number }>(
        `/shifts/${activeShift!.id}/handover`, { declaredCash: amount },
      );
      const v = data.variance;
      toast.success(
        v === 0
          ? `Counted: ₱${data.declaredCash.toFixed(2)} — spot on.`
          : `Counted: ₱${data.declaredCash.toFixed(2)} against ₱${data.expectedCash.toFixed(2)} expected ` +
            `(${v > 0 ? 'over' : 'short'} ₱${Math.abs(v).toFixed(2)}). Written down.`,
        { duration: 8_000 },
      );
      setCounting(false);
      setDeclared('');
      onCounted?.();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? 'Could not record the count.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" className="bg-sky-600 text-white text-xs px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
      <Wallet className="h-3.5 w-3.5 shrink-0" />
      {counting ? (
        <>
          <span className="font-medium">What is in the drawer right now?</span>
          <input
            autoFocus
            inputMode="decimal"
            value={declared}
            onChange={(e) => setDeclared(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void record(); }}
            placeholder="0.00"
            className="w-28 rounded bg-white/15 px-2 py-1 text-white placeholder-white/60 outline-none ring-1 ring-white/30 focus:ring-white"
          />
          <button onClick={() => void record()} disabled={busy}
            className="rounded bg-white px-2.5 py-1 font-semibold text-sky-700 disabled:opacity-60">
            {busy ? 'Saving…' : 'Save the count'}
          </button>
          <button onClick={() => setCounting(false)} className="underline underline-offset-2 opacity-90">Cancel</button>
        </>
      ) : (
        <>
          <span className="font-medium">Time to count the till.</span>
          <span className="opacity-90">{howLong} Nothing stops while you do it.</span>
          <button onClick={() => setCounting(true)}
            className="rounded bg-white px-2.5 py-1 font-semibold text-sky-700">
            Count it now
          </button>
          <button onClick={snooze} aria-label="Remind me later"
            className="ml-auto inline-flex items-center gap-1 underline underline-offset-2 opacity-90">
            Later <X className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}
