'use client';
/**
 * Sprint 19 — Sync kiosk fullscreen UI (UNAUTHENTICATED).
 *
 * Four states:
 *   1. DASHBOARD (default, idle) — live clock + "Currently clocked in"
 *      roster filling the screen, with a single "Time Clock" CTA at the
 *      bottom. Public-friendly: a passing customer sees a tidy in-out
 *      board, not a numeric keypad waiting to be tampered with.
 *   2. ACTION CHOICE — two giant buttons: "Clock In" (green, for arrivals)
 *      and "Clock Out" (blue, for departures). Picking one carries the
 *      intent through to the punch endpoint, which validates state and
 *      rejects mismatches ("you're already clocked in — tap Clock Out").
 *   3. PIN ENTRY — keypad with a header showing the chosen action.
 *      Cancel / back returns to the action choice.
 *   4. CONFIRMATION — green/blue "Clocked in/out, Maria, 7:54am" flash
 *      for 3 seconds, then auto-returns to the dashboard.
 *
 * Authentication: the kiosk's apiKey (from ?key=) authenticates the
 * device; each punch authenticates the staff member by User.kioskPin.
 */
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Delete, ArrowRight, CheckCircle2, AlertCircle, Loader2, Users, Clock, X,
  LogIn, LogOut,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type View = 'dashboard' | 'choice' | 'pin';
type Intent = 'IN' | 'OUT';

type Result =
  | { kind: 'ok'; action: 'CLOCKED_IN' | 'CLOCKED_OUT'; userName: string; at: string }
  | { kind: 'err'; message: string }
  | null;

interface RosterEntry {
  userId:      string;
  name:        string;
  role:        string;
  clockedInAt: string;
}

export default function KioskPage() {
  const params = useSearchParams();
  const apiKey = params.get('key') ?? '';

  const [view,   setView]   = useState<View>('dashboard');
  const [intent, setIntent] = useState<Intent>('IN');
  const [pin,    setPin]    = useState('');
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [now,    setNow]    = useState(() => new Date());
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  // Live "currently clocked in" roster — refreshes every 10s and
  // immediately after a successful punch so the just-punched person
  // appears or disappears without waiting.
  const fetchRoster = useCallback(async () => {
    if (!apiKey) return;
    try {
      const res = await fetch(`${API_URL}/payroll/kiosk/roster?apiKey=${encodeURIComponent(apiKey)}`);
      if (res.ok) setRoster(await res.json());
    } catch { /* network blip — try again next tick */ }
  }, [apiKey]);

  useEffect(() => {
    fetchRoster();
    const t = setInterval(fetchRoster, 10_000);
    return () => clearInterval(t);
  }, [fetchRoster]);

  // Live clock — keeps the kiosk feeling alive even when idle.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-clear the result and return to the dashboard after 3 seconds.
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => {
      setResult(null);
      setPin('');
      setView('dashboard');
    }, 3000);
    return () => clearTimeout(t);
  }, [result]);

  // Auto-return to dashboard after 30 seconds of inactivity on the
  // intermediate views (choice or empty pin), so a half-typed PIN or an
  // open menu doesn't sit on screen forever.
  useEffect(() => {
    if (view === 'dashboard' || busy || result) return;
    if (view === 'pin' && pin.length > 0) return;
    const t = setTimeout(() => {
      setView('dashboard');
      setPin('');
    }, 30_000);
    return () => clearTimeout(t);
  }, [view, pin, busy, result]);

  if (!apiKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-6">
        <div className="max-w-md text-center space-y-3">
          <AlertCircle className="h-12 w-12 mx-auto text-amber-400" />
          <h1 className="text-xl font-semibold">Kiosk not configured</h1>
          <p className="text-sm text-slate-300">
            This kiosk is missing its enrollment key. Owner: open Settings → Kiosk Terminals,
            enroll a new device, and use the URL it gives you.
          </p>
        </div>
      </div>
    );
  }

  function press(d: string) {
    if (busy || result) return;
    if (pin.length >= 8) return;
    setPin((p) => p + d);
  }
  function backspace() {
    if (busy || result) return;
    setPin((p) => p.slice(0, -1));
  }
  function chooseIntent(i: Intent) {
    setIntent(i);
    setPin('');
    setView('pin');
  }
  function backToChoice() {
    setPin('');
    setView('choice');
  }

  async function submit() {
    if (busy || pin.length < 4) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/payroll/kiosk/punch`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ apiKey, pin, intent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Express-style errors come through as { message: "..." } or
        // sometimes as { message: ["..."] } via the global filter. Tolerate
        // both shapes so a future filter change doesn't silently regress.
        const raw = data?.message;
        const msg = Array.isArray(raw) ? raw[0] : (raw ?? 'Punch failed.');
        setResult({ kind: 'err', message: msg });
        return;
      }
      setResult({
        kind:     'ok',
        action:   data.action,
        userName: data.user?.name ?? 'Welcome',
        at:       data.at,
      });
      fetchRoster();
    } catch (err: any) {
      setResult({ kind: 'err', message: err?.message ?? 'Network error.' });
    } finally {
      setBusy(false);
    }
  }

  // ── Confirmation overlay (covers everything) ──────────────────────────
  if (result) {
    if (result.kind === 'ok') {
      const greeting = result.action === 'CLOCKED_IN' ? 'Clocked in' : 'Clocked out';
      const t = new Date(result.at);
      const at = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return (
        <div className={`min-h-screen flex flex-col items-center justify-center text-center p-8 ${
          result.action === 'CLOCKED_IN'
            ? 'bg-emerald-600 text-white'
            : 'bg-blue-600 text-white'
        }`}>
          <CheckCircle2 className="h-20 w-20 mb-4" />
          <div className="text-3xl font-semibold mb-1">{greeting}</div>
          <div className="text-5xl font-bold mb-3">{result.userName}</div>
          <div className="text-xl opacity-90">{at}</div>
          <div className="mt-8 text-xs opacity-70">Returning to dashboard…</div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-rose-600 text-white text-center p-8">
        <AlertCircle className="h-20 w-20 mb-4" />
        <div className="text-2xl font-semibold mb-1 max-w-md">{result.message}</div>
        <div className="mt-8 text-xs opacity-70">Try again…</div>
      </div>
    );
  }

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  // ── Action choice view ─────────────────────────────────────────────────
  if (view === 'choice') {
    return (
      <div className="min-h-screen flex flex-col bg-slate-900 text-white">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-3xl font-bold tabular-nums">{time}</div>
            <div className="text-xs text-slate-400 mt-0.5">{date}</div>
          </div>
          <button
            onClick={() => setView('dashboard')}
            className="rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 p-2 transition-colors"
            aria-label="Cancel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-4 gap-6 max-w-md mx-auto w-full">
          <div className="text-base text-slate-300">What are you doing?</div>

          <button
            onClick={() => chooseIntent('IN')}
            className="w-full h-32 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-3xl font-semibold flex items-center justify-center gap-4 shadow-lg shadow-emerald-900/40 transition-colors"
          >
            <LogIn className="h-9 w-9" />
            Clock In
          </button>

          <button
            onClick={() => chooseIntent('OUT')}
            className="w-full h-32 rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-3xl font-semibold flex items-center justify-center gap-4 shadow-lg shadow-blue-900/40 transition-colors"
          >
            <LogOut className="h-9 w-9" />
            Clock Out
          </button>
        </div>

        <div className="text-center pb-4 text-[11px] text-slate-500">
          Clerque Sync · Time Clock
        </div>
      </div>
    );
  }

  // ── PIN entry view ─────────────────────────────────────────────────────
  if (view === 'pin') {
    const isClockIn = intent === 'IN';
    const accentBg  = isClockIn ? 'bg-emerald-600' : 'bg-blue-600';
    const accentHov = isClockIn ? 'hover:bg-emerald-500' : 'hover:bg-blue-500';
    const accentAct = isClockIn ? 'active:bg-emerald-700' : 'active:bg-blue-700';
    const accentDot = isClockIn ? 'bg-emerald-400 border-emerald-400' : 'bg-blue-400 border-blue-400';
    const accentDotEmpty = isClockIn ? 'border-emerald-400/60' : 'border-blue-400/60';

    return (
      <div className="min-h-screen flex flex-col bg-slate-900 text-white">
        {/* Top: clock + cancel back to choice */}
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-3xl font-bold tabular-nums">{time}</div>
            <div className="text-xs text-slate-400 mt-0.5">{date}</div>
          </div>
          <button
            onClick={backToChoice}
            className="rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 p-2 transition-colors"
            aria-label="Back"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action banner — reminds the user what they tapped */}
        <div className={`mx-6 rounded-xl ${accentBg} px-4 py-3 flex items-center gap-3`}>
          {isClockIn ? <LogIn className="h-5 w-5" /> : <LogOut className="h-5 w-5" />}
          <span className="text-base font-semibold">
            {isClockIn ? 'Clock In' : 'Clock Out'} · Enter your PIN
          </span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="flex gap-2 mb-8 mt-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={`h-4 w-4 rounded-full border-2 transition-colors ${
                  i < pin.length
                    ? accentDot
                    : i === pin.length
                      ? accentDotEmpty
                      : 'border-slate-600'
                }`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 max-w-xs w-full">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                onClick={() => press(d)}
                className="h-20 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-3xl font-semibold transition-colors"
              >
                {d}
              </button>
            ))}
            <button
              onClick={backspace}
              className="h-20 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 flex items-center justify-center transition-colors"
              aria-label="Backspace"
            >
              <Delete className="h-7 w-7" />
            </button>
            <button
              onClick={() => press('0')}
              className="h-20 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-3xl font-semibold transition-colors"
            >
              0
            </button>
            <button
              onClick={submit}
              disabled={busy || pin.length < 4}
              className={`h-20 rounded-2xl ${accentBg} ${accentHov} ${accentAct} disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center transition-colors`}
              aria-label="Submit"
            >
              {busy
                ? <Loader2 className="h-7 w-7 animate-spin" />
                : <ArrowRight className="h-7 w-7" />}
            </button>
          </div>
        </div>

        <div className="text-center pb-4 text-[11px] text-slate-500">
          Clerque Sync · Time Clock
        </div>
      </div>
    );
  }

  // ── Dashboard view (default) ───────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white">
      {/* Top: live clock */}
      <div className="text-center pt-8 pb-6">
        <div className="text-7xl sm:text-8xl font-bold tabular-nums">{time}</div>
        <div className="text-base text-slate-300 mt-2">{date}</div>
      </div>

      {/* Middle: roster fills the available space */}
      <div className="flex-1 px-4 sm:px-6 max-w-3xl mx-auto w-full pb-4">
        <div className="bg-slate-800/60 rounded-2xl p-5 h-full flex flex-col">
          <div className="flex items-center gap-2 text-slate-300 mb-4">
            <Users className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wider">
              Currently clocked in · {roster.length}
            </span>
          </div>

          {roster.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
              <Clock className="h-12 w-12" />
              <div>No one is clocked in yet.</div>
              <div className="text-xs text-slate-600">Tap below to be the first.</div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 content-start">
              {roster.map((r) => {
                const since = new Date(r.clockedInAt);
                const ago = Math.max(1, Math.floor((Date.now() - since.getTime()) / 60_000));
                const agoLabel = ago < 60 ? `${ago}m` : `${Math.floor(ago / 60)}h ${ago % 60}m`;
                return (
                  <div
                    key={r.userId}
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-700/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        since {since.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="text-[11px] text-emerald-400 font-medium tabular-nums shrink-0">
                      {agoLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Time Clock entry button — opens the action choice. */}
      <div className="px-4 sm:px-6 pb-6 max-w-3xl mx-auto w-full">
        <button
          onClick={() => setView('choice')}
          className="w-full h-24 rounded-2xl bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white text-2xl font-semibold flex items-center justify-center gap-3 shadow-lg shadow-slate-950/40 transition-colors"
        >
          <Clock className="h-7 w-7" />
          Time Clock
        </button>
        <div className="text-center mt-3 text-[11px] text-slate-500">
          Tap to clock in or out · Clerque Sync
        </div>
      </div>
    </div>
  );
}
