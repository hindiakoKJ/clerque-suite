'use client';
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { reportReturnedUnsold } from '@/lib/inventory/tag-api';
import { apiErrorText, cleanCode, isTagCode, manilaTime, type ReturnedUnsoldResult } from '@/lib/inventory/tags';

/**
 * A customer brings a part back: scan its label first.
 *
 * If the tag was sold, it is a normal return, refunded from Orders by the
 * owner. If it was never sold, someone sold it off the books: the owner is
 * told at once, with when the part was last found at a roll call and whose
 * drawers were open since. This is how the shop first found its theft; here
 * it is a rule, not luck.
 */
type Outcome =
  | { kind: 'SOLD'; message: string }
  | { kind: 'UNSOLD'; number: string; result: ReturnedUnsoldResult };

export default function ReturnPartPage() {
  const [code, setCode]       = useState('');
  const [note, setNote]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function check() {
    const c = cleanCode(code);
    if (!isTagCode(c)) { setError('Type the 6 digits on the part\'s label.'); return; }
    setBusy(true);
    setError('');
    setOutcome(null);
    try {
      const result = await reportReturnedUnsold(c, note);
      setOutcome({ kind: 'UNSOLD', number: c, result });
      setCode('');
      setNote('');
    } catch (e) {
      const r = (e as { response?: { status?: number; data?: { code?: string } } })?.response;
      if (r?.status === 409 && r.data?.code === 'TAG_WAS_SOLD') {
        setOutcome({ kind: 'SOLD', message: apiErrorText(e, 'This part was sold.') });
        setCode('');
        setNote('');
      } else {
        setError(apiErrorText(e, 'Could not check that tag.'));
      }
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Return a part</h2>
        <p className="text-sm text-muted-foreground">
          A customer brought a part back? Scan its label before anything else.
        </p>
      </div>

      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(''); }}
              autoComplete="off"
              inputMode="numeric"
              placeholder="e.g. 000457"
              aria-label="Tag number on the part"
              className="h-14 pl-10 font-mono text-xl font-semibold"
            />
          </div>
          <Button type="submit" disabled={busy || !code.trim()} className="h-14 px-6 text-base">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Check'}
          </Button>
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">What the customer said (optional)</span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. bought last week, does not fit"
            className="h-11"
          />
        </label>
      </form>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm font-medium text-red-700 dark:text-red-300" role="alert">{error}</p>
      )}

      {outcome?.kind === 'SOLD' && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4" role="status">
          <p className="flex items-center gap-2 text-base font-semibold text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5" /> A normal return
          </p>
          <p className="mt-1 text-sm">{outcome.message}</p>
        </div>
      )}

      {outcome?.kind === 'UNSOLD' && (
        <div className="space-y-2 rounded-2xl border border-red-500/50 bg-red-500/10 p-4" role="alert">
          <p className="flex items-center gap-2 text-base font-semibold text-red-800 dark:text-red-300">
            <AlertTriangle className="h-5 w-5" /> Tag {outcome.number} was never sold
          </p>
          <p className="text-sm">
            Clerque has no sale of this part. The owner has been told. Keep the part aside, with any receipt the customer shows, and do not refund it yourself.
          </p>
          <p className="text-sm text-muted-foreground">
            {outcome.result.lastSeen ? `Last found at the roll call of ${manilaTime(outcome.result.lastSeen)}.` : 'Not found at any recent roll call.'}
          </p>
        </div>
      )}
    </div>
  );
}
