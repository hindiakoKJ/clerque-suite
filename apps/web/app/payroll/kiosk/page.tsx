'use client';
/**
 * Sprint 19 — Sync kiosk fullscreen keypad (UNAUTHENTICATED).
 *
 * The shared on-site tablet visits this URL with ?key=<apiKey>. Staff type
 * their User.kioskPin → backend authenticates the kiosk + finds the user
 * by PIN within the tenant + records a clock-in or clock-out punch. The
 * device never holds a JWT.
 *
 * Idle behavior: after a confirmation flashes for 3 seconds, the page
 * resets to an empty keypad. There is no logout — the kiosk is shared.
 */
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Delete, ArrowRight, CheckCircle2, AlertCircle, Loader2, Users } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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

  const [pin,    setPin]    = useState('');
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [now,    setNow]    = useState(() => new Date());
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  // Live "currently clocked in" roster — refreshes every 10s and immediately
  // after a successful punch so the just-clocked-in person appears at once.
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

  // Auto-clear the result after 3 seconds and reset the keypad.
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => { setResult(null); setPin(''); }, 3000);
    return () => clearTimeout(t);
  }, [result]);

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

  async function submit() {
    if (busy || pin.length < 4) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/payroll/kiosk/punch`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ apiKey, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ kind: 'err', message: data?.message ?? 'Punch failed.' });
        return;
      }
      setResult({
        kind:     'ok',
        action:   data.action,
        userName: data.user?.name ?? 'Welcome',
        at:       data.at,
      });
      // Refresh the roster panel so the just-punched user appears (or
      // disappears, on clock-out) without waiting 10 seconds.
      fetchRoster();
    } catch (err: any) {
      setResult({ kind: 'err', message: err?.message ?? 'Network error.' });
    } finally {
      setBusy(false);
    }
  }

  // Confirmation overlay
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
          <div className="mt-8 text-xs opacity-70">Returning to keypad…</div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-rose-600 text-white text-center p-8">
        <AlertCircle className="h-20 w-20 mb-4" />
        <div className="text-2xl font-semibold mb-1">{result.message}</div>
        <div className="mt-8 text-xs opacity-70">Try again…</div>
      </div>
    );
  }

  // ── Idle keypad ────────────────────────────────────────────────────────
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white">
      {/* Top: clock */}
      <div className="text-center py-6">
        <div className="text-5xl font-bold tabular-nums">{time}</div>
        <div className="text-sm text-slate-300 mt-1">{date}</div>
      </div>

      {/* Two-column on landscape tablets: keypad + roster.
          Stacks to single column on portrait/small. */}
      <div className="flex-1 flex flex-col lg:flex-row lg:items-stretch gap-6 px-4 pb-4 max-w-6xl mx-auto w-full">
        {/* Keypad (left) */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-base text-slate-300 mb-4">Enter your PIN to clock in or out</div>

          <div className="flex gap-2 mb-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={`h-4 w-4 rounded-full border-2 transition-colors ${
                  i < pin.length
                    ? 'bg-emerald-400 border-emerald-400'
                    : i === pin.length
                      ? 'border-emerald-400/60'
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
              className="h-20 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center transition-colors"
              aria-label="Submit"
            >
              {busy
                ? <Loader2 className="h-7 w-7 animate-spin" />
                : <ArrowRight className="h-7 w-7" />}
            </button>
          </div>
        </div>

        {/* Roster (right) — currently clocked-in staff visible from this kiosk */}
        <div className="lg:w-80 lg:shrink-0">
          <div className="bg-slate-800/60 rounded-2xl p-4 h-full flex flex-col">
            <div className="flex items-center gap-2 text-slate-300 mb-3">
              <Users className="h-4 w-4" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                Currently clocked in · {roster.length}
              </span>
            </div>

            {roster.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                No one is clocked in yet.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {roster.map((r) => {
                  const since = new Date(r.clockedInAt);
                  const ago = Math.max(1, Math.floor((Date.now() - since.getTime()) / 60_000));
                  const agoLabel = ago < 60 ? `${ago}m` : `${Math.floor(ago / 60)}h ${ago % 60}m`;
                  return (
                    <div
                      key={r.userId}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-700/40 px-3 py-2"
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
      </div>

      {/* Bottom: branding */}
      <div className="text-center pb-4 text-[11px] text-slate-500">
        Clerque Sync · Kiosk
      </div>
    </div>
  );
}
