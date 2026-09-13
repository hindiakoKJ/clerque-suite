'use client';
/**
 * "Please double-check before saving."
 *
 * The server judges every cost, selling price and recipe before it saves one.
 * When a number looks out of character — milk that has cost ₱85 to ₱90 for
 * months, typed as ₱190 — it refuses with the reason instead of saving. The API
 * client (lib/api.ts) catches that refusal, opens this dialog, and if the person
 * says the number is right, sends the very same request again with their
 * answer attached. Nothing is written until then.
 *
 * Going back is the easy choice on purpose: it has the focus, so Enter and Esc
 * both return to the form with everything still typed in. Saving anyway takes a
 * deliberate click — the one habit worth breaking is pressing Enter through a
 * question without reading it.
 *
 * Mounted once, in app/providers.tsx.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface SanityWarning {
  key: string;
  kind: 'INGREDIENT_COST' | 'SELL_PRICE' | 'MARGIN';
  severity: 'unusual' | 'magnitude';
  name: string;
  value: string;
  message: string;
}

type Pending = { warnings: SanityWarning[]; resolve: (yes: boolean) => void };

let pending: Pending | null = null;
let listeners: Array<() => void> = [];
const emit = () => listeners.forEach((fn) => fn());

/** Ask the person about these numbers. Resolves true when they say they are correct. */
export function requestSanityConfirmation(warnings: SanityWarning[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (pending) pending.resolve(false);
    pending = { warnings, resolve };
    emit();
  });
}

const TITLE: Record<SanityWarning['kind'], string> = {
  INGREDIENT_COST: 'Is this the correct cost?',
  SELL_PRICE: 'Is this the correct selling price?',
  MARGIN: 'Does this cost and price make sense?',
};

export function SanityConfirmModal() {
  const [, setTick] = useState(0);
  const goBack = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.push(fn);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  }, []);

  const current = pending;
  const close = (yes: boolean) => {
    const p = pending;
    pending = null;
    emit();
    p?.resolve(yes);
  };

  const warnings = current?.warnings ?? [];
  const kinds = new Set(warnings.map((w) => w.kind));
  const title = warnings.length === 1 ? TITLE[warnings[0]!.kind] : 'Please double-check before saving';
  const anyMagnitude = warnings.some((w) => w.severity === 'magnitude');

  return (
    <Dialog open={!!current} onOpenChange={(open) => { if (!open) close(false); }}>
      <DialogContent
        className="max-w-lg"
        onOpenAutoFocus={(e) => { e.preventDefault(); goBack.current?.focus(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {anyMagnitude
              ? 'Something here is about ten times off, which is usually the wrong unit or pack size.'
              : 'Nothing has been saved yet.'}
            {' '}If it is right, save it. If not, go back and fix it — what you typed is still there.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
          {warnings.map((w) => (
            <li
              key={w.key}
              className={`rounded-lg border px-3 py-2 text-sm leading-relaxed ${
                w.severity === 'magnitude'
                  ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
                  : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
              }`}
            >
              {w.message}
            </li>
          ))}
        </ul>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            ref={goBack}
            type="button"
            onClick={() => close(false)}
            className="inline-flex items-center justify-center rounded-lg bg-[var(--accent,theme(colors.slate.900))] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Go back and fix
          </button>
          <button
            type="button"
            // A deliberate click, never the default: Enter goes back.
            onClick={() => close(true)}
            className="inline-flex items-center justify-center rounded-lg border border-amber-400 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          >
            {kinds.size === 1 && warnings.length === 1 ? 'Yes, it is correct — save' : 'Yes, these are correct — save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
