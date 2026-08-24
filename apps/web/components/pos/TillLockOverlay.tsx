'use client';
import { useEffect, useRef, useState } from 'react';
import { Lock, LogOut, Loader2, Calculator } from 'lucide-react';
import { jwtDecode } from 'jwt-decode';
import type { JwtPayload } from '@repo/shared-types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useShiftStore } from '@/store/pos/shift';
import { useTillLockStore } from '@/store/pos/tillLock';
import { toast } from 'sonner';

/**
 * The lock screen a cashier leaves behind on a quick break.
 *
 * One tap locks the till; any staff PIN unlocks it. If the PIN belongs to
 * someone else, the session SWITCHES to them — their name on every sale from
 * here on — while the open shift, its float and its eventual variance stay
 * with the cashier who opened the drawer. That split is the whole point:
 * a break moves WHO IS RINGING, it does not move drawer accountability, so
 * none of the count-close-signout ceremony applies.
 *
 * The switch swaps tokens in place, no navigation — so the cart, the open
 * shift and the customer display all carry straight on.
 */
export function TillLockOverlay() {
  const { locked, lockedByName, unlock } = useTillLockStore();
  const { user, setTokens, setUser, clear } = useAuthStore();
  const activeShift = useShiftStore((s) => s.activeShift);

  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handover count step — offered when a DIFFERENT cashier takes over. The
  // relief cashier counts the drawer and the declared amount is recorded
  // against expected cash at that instant, so a later shortage can be placed
  // before or after the handover. Optional: skipping leaves the variance
  // question with the drawer owner, exactly as before.
  const [countStep, setCountStep] = useState<null | { takingOver: string }>(null);
  const [declared, setDeclared] = useState('');

  useEffect(() => {
    if (locked) {
      setPin('');
      // Focus after the overlay paints, so the tablet keyboard opens.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [locked]);

  if (!locked) return null;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || pin.trim().length < 4) return;
    setBusy(true);
    try {
      const { data } = await api.post<{
        accessToken: string;
        refreshToken: string;
        switchedTo: { id: string; name: string | null; role: string };
      }>('/auth/switch-cashier', { pin: pin.trim() });

      const sameUser = data.switchedTo.id === user?.sub;

      // Adopt the new session exactly the way the login page does — token
      // store plus the web-origin mirror cookie the middleware reads.
      setTokens(data.accessToken, data.refreshToken);
      setUser(jwtDecode<JwtPayload>(data.accessToken));
      const isProd = window.location.protocol === 'https:';
      document.cookie =
        `app-session=${data.accessToken}; path=/; SameSite=Lax` + (isProd ? '; Secure' : '');

      if (sameUser) {
        unlock();
        toast.success('Welcome back.');
      } else {
        toast.success(
          `Now ringing as ${data.switchedTo.name ?? 'relief cashier'}.` +
            (activeShift ? ' The drawer stays with the shift that opened it.' : ''),
          { duration: 6_000 },
        );
        // A takeover with an open drawer gets the optional count step; without
        // a shift there is no drawer to count, so just unlock.
        if (activeShift) {
          setCountStep({ takingOver: data.switchedTo.name ?? 'Relief' });
          setDeclared('');
        } else {
          unlock();
        }
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Wrong PIN — try again.');
      setPin('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function recordCount() {
    if (!activeShift || busy) return;
    const amount = Number(declared);
    if (!Number.isFinite(amount) || amount < 0) return;
    setBusy(true);
    try {
      const { data } = await api.post<{ declaredCash: number; expectedCash: number; variance: number }>(
        `/shifts/${activeShift.id}/handover`,
        { declaredCash: amount },
      );
      const v = data.variance;
      toast.success(
        v === 0
          ? `Drawer counted: ₱${data.declaredCash.toFixed(2)} — spot on.`
          : `Drawer counted: ₱${data.declaredCash.toFixed(2)} vs expected ₱${data.expectedCash.toFixed(2)} ` +
            `(${v > 0 ? 'over' : 'short'} ₱${Math.abs(v).toFixed(2)}). Recorded.`,
        { duration: 8_000 },
      );
      setCountStep(null);
      unlock();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Could not record the count.');
    } finally {
      setBusy(false);
    }
  }

  if (countStep) {
    return (
      <div className="fixed inset-0 z-[200] bg-stone-950/97 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-white">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-stone-800 flex items-center justify-center">
            <Calculator className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">Count the drawer?</h1>
          <p className="text-stone-400 text-sm mb-6">
            Optional, but it protects both of you: if the drawer is short, this records whether it
            happened before or after {countStep.takingOver} took over.
          </p>

          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={declared}
            onChange={(e) => setDeclared(e.target.value)}
            placeholder="Cash in drawer (₱)"
            autoFocus
            className="w-full rounded-2xl bg-stone-900 border border-stone-700 text-center text-3xl font-bold tabular-nums text-white px-4 py-5 mb-4 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent placeholder:text-stone-600 placeholder:text-base"
          />
          <button
            onClick={() => void recordCount()}
            disabled={busy || declared.trim() === '' || Number(declared) < 0}
            className="w-full rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-stone-950 font-bold text-lg py-4 transition-colors flex items-center justify-center gap-2 mb-3"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Calculator className="h-5 w-5" />}
            Record count
          </button>
          <button
            onClick={() => { setCountStep(null); unlock(); }}
            className="text-sm text-stone-500 hover:text-stone-300 transition-colors"
          >
            Skip — start selling
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] bg-stone-950/97 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-white">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-stone-800 flex items-center justify-center">
          <Lock className="h-8 w-8 text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Till locked</h1>
        <p className="text-stone-400 text-sm mb-1">
          {lockedByName ? `Locked by ${lockedByName}.` : 'Enter your PIN to continue.'}
        </p>
        {activeShift && (
          <p className="text-stone-500 text-xs mb-6">
            The shift stays open — taking over rings sales under your name on the same drawer.
          </p>
        )}

        <form onSubmit={submit} className="space-y-4">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            autoComplete="off"
            className="w-full rounded-2xl bg-stone-900 border border-stone-700 text-center text-4xl tracking-[0.5em] font-bold tabular-nums text-white px-4 py-5 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-stone-600"
          />
          <button
            type="submit"
            disabled={busy || pin.length < 4}
            className="w-full rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-stone-950 font-bold text-lg py-4 transition-colors flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-5 w-5" />}
            Unlock
          </button>
        </form>

        {/* The full door stays available — a relief cashier without a PIN, or
            an account that needs its second factor, signs in properly. */}
        <button
          onClick={() => {
            unlock();          // the login page is its own gate
            clear();
            window.location.href = '/login';
          }}
          className="mt-6 inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign in as someone else instead
        </button>
      </div>
    </div>
  );
}
