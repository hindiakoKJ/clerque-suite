'use client';

/**
 * "Request what's running low" on the kitchen or bar screen.
 *
 * One tap: Clerque works out what the branch needs for the next day (the same
 * weekdays' use, the preps that will need making, the owner's reorder levels,
 * less what is on the shelf and already coming), puts it on the branch's one
 * buy list and sends it to the owner. The kitchen's and the bar's taps land on
 * the same list, and a tap with nothing new tells nobody, so tapping twice is
 * safe. The panel then says what was sent and takes anything Clerque cannot
 * see with "+".
 *
 * Self-contained: the station page only mounts it (contract 3).
 */
import { useState } from 'react';
import type { JSX } from 'react';
import { toast } from 'sonner';
import { Loader2, ShoppingCart } from 'lucide-react';
import { api } from '@/lib/api';
import { StationRequestPanel, requestErrorMessage, requestLowPath, type RequestResult } from './StationRequestPanel';

export function StationRequestButton({ stationId, enabled }: { stationId: string; enabled: boolean }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RequestResult | null>(null);

  async function tap() {
    if (!enabled || busy) return;
    setBusy(true);
    try {
      const res = await api.post<RequestResult>(requestLowPath(stationId), {});
      setResult(res.data);
    } catch (e) {
      // A refusal is said in the server's words (wrong station, the pairer left); a dropped connection plainly.
      toast.error(requestErrorMessage(e, 'Could not check what is running low.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void tap()}
        disabled={!enabled || busy}
        title="Put what is running low on the buy list and send it to the owner"
        className="flex min-h-12 items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-stone-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
        {busy
          ? <span>Checking stock…</span>
          : <span className="hidden sm:inline">Request what&apos;s running low</span>}
        {!busy && <span className="sr-only sm:hidden">Request what&apos;s running low</span>}
      </button>

      {result && (
        <StationRequestPanel
          stationId={stationId}
          result={result}
          onResult={setResult}
          onClose={() => setResult(null)}
        />
      )}
    </>
  );
}
