'use client';
import { useEffect, useRef, useState } from 'react';
import { Lock, LogOut, Loader2 } from 'lucide-react';
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

      unlock();
      if (sameUser) {
        toast.success('Welcome back.');
      } else {
        toast.success(
          `Now ringing as ${data.switchedTo.name ?? 'relief cashier'}.` +
            (activeShift ? ' The drawer stays with the shift that opened it.' : ''),
          { duration: 6_000 },
        );
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Wrong PIN — try again.');
      setPin('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
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
