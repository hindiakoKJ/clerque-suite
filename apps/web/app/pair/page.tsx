'use client';
/**
 * Sprint 25 — Public device-pairing landing.
 *
 * URL contract: /pair?code=4729&tenant=demo
 *
 * Two modes:
 *   1. Auto-redeem — both query params present → POST /display-pairing/redeem
 *      and bounce to the right surface (customer-display or KDS station).
 *   2. Manual — render a friendly form with tenant slug + 4-digit code.
 *
 * Already-paired short-circuit: if localStorage holds a deviceToken AND it
 * validates against /whoami, offer Continue / Unpair without re-pairing.
 *
 * This route is in PUBLIC_PREFIXES — no JWT required. We use a raw axios call
 * instead of the shared api.ts client so the bearer-token interceptor doesn't
 * attach a stale cashier JWT (harmless but noisy).
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { Loader2, Monitor, ChefHat, RefreshCw } from 'lucide-react';
import {
  clearDeviceToken,
  readDeviceToken,
  verifyDeviceToken,
  writeDeviceToken,
  type PairedDeviceRole,
  type StoredDeviceToken,
} from '@/lib/pos/device-token';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface RedeemResponse {
  deviceToken: string;
  tenantId:    string;
  tenantName:  string;
  cashierId:   string;
  role:        PairedDeviceRole;
  stationId:   string | null;
  label:       string | null;
}

function destinationForRole(role: PairedDeviceRole, stationId: string | null): string {
  if (role === 'CUSTOMER_DISPLAY') return '/pos/customer-display';
  // KDS_* — needs a station. Fall back to a generic listing path if absent.
  if (stationId) return `/pos/station/${stationId}`;
  return '/pos/station/generic';
}

export default function PairPage() {
  // Suspense-wrap so useSearchParams() doesn't break static analysis.
  return (
    <Suspense fallback={<FullscreenSpinner label="Loading…" />}>
      <PairPageInner />
    </Suspense>
  );
}

function PairPageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const queryCode    = searchParams.get('code') ?? '';
  const queryTenant  = searchParams.get('tenant') ?? '';

  const [phase, setPhase]     = useState<'init' | 'auto' | 'manual' | 'paired' | 'error'>('init');
  const [errorMsg, setError]  = useState<string>('');
  const [existing, setExisting] = useState<StoredDeviceToken | null>(null);

  // On boot: if we already have a token, see if it's still valid. If yes,
  // offer Continue/Unpair. If no, fall through to auto / manual.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = readDeviceToken();
      if (stored) {
        const ok = await verifyDeviceToken(stored.deviceToken);
        if (!cancelled && ok) {
          setExisting(stored);
          setPhase('paired');
          return;
        }
        if (!cancelled) {
          // Token revoked — clear it silently so the manual form is clean.
          clearDeviceToken();
        }
      }
      if (cancelled) return;
      if (queryCode && queryTenant) {
        setPhase('auto');
      } else {
        setPhase('manual');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redeem = useCallback(async (tenantSlug: string, code: string) => {
    setError('');
    try {
      const { data } = await axios.post<RedeemResponse>(
        `${API_URL}/display-pairing/redeem`,
        { tenantSlug: tenantSlug.trim().toLowerCase(), code: code.trim() },
      );
      const bundle: StoredDeviceToken = {
        deviceToken: data.deviceToken,
        tenantId:    data.tenantId,
        tenantName:  data.tenantName,
        cashierId:   data.cashierId,
        role:        data.role,
        stationId:   data.stationId,
        label:       data.label,
      };
      writeDeviceToken(bundle);
      router.replace(destinationForRole(data.role, data.stationId));
      return true;
    } catch (err: unknown) {
      const rawMsg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      const msg = Array.isArray(rawMsg) ? rawMsg.join(' ') : (rawMsg ?? 'Pairing failed — check the code and try again.');
      setError(msg);
      setPhase('manual');
      return false;
    }
  }, [router]);

  // Auto-redeem path.
  const autoFired = useRef(false);
  useEffect(() => {
    if (phase !== 'auto' || autoFired.current) return;
    autoFired.current = true;
    void redeem(queryTenant, queryCode);
  }, [phase, queryTenant, queryCode, redeem]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 text-white"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}
    >
      {phase === 'init' && <FullscreenSpinner label="Loading…" />}

      {phase === 'auto' && (
        <FullscreenSpinner label={`Pairing as ${queryTenant} · ${queryCode}…`} />
      )}

      {phase === 'paired' && existing && (
        <PairedCard
          bundle={existing}
          onContinue={() => router.replace(destinationForRole(existing.role, existing.stationId))}
          onUnpair={() => {
            clearDeviceToken();
            setExisting(null);
            setPhase('manual');
          }}
        />
      )}

      {phase === 'manual' && (
        <ManualForm
          initialTenant={queryTenant}
          initialCode={queryCode}
          errorMsg={errorMsg}
          onSubmit={redeem}
        />
      )}
    </div>
  );
}

/* ─── Already-paired short-circuit ────────────────────────────────────────── */
function PairedCard({
  bundle,
  onContinue,
  onUnpair,
}: {
  bundle: StoredDeviceToken;
  onContinue: () => void;
  onUnpair: () => void;
}) {
  const Icon = bundle.role === 'CUSTOMER_DISPLAY' ? Monitor : ChefHat;
  const roleLabel =
    bundle.role === 'CUSTOMER_DISPLAY' ? 'Customer Display' :
    bundle.role === 'KDS_KITCHEN'      ? 'Kitchen Display'  :
    bundle.role === 'KDS_BAR'          ? 'Bar Display'      :
    bundle.role === 'KDS_COLD_BAR'     ? 'Cold Bar'         :
    bundle.role === 'KDS_HOT_BAR'      ? 'Hot Bar'          :
    bundle.role === 'KDS_PASTRY_PASS'  ? 'Pastry Pass'      :
                                         'Station Display';
  return (
    <div className="w-full max-w-md rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-8 shadow-2xl text-center">
      <Icon className="h-12 w-12 mx-auto mb-3 text-sky-400" />
      <h1
        className="text-2xl font-bold mb-1 tracking-tight"
        style={{ fontFamily: 'var(--font-display, "Plus Jakarta Sans"), system-ui, sans-serif' }}
      >
        Already paired
      </h1>
      <p className="text-slate-400 text-sm mb-6">
        This device is paired as <span className="text-white font-medium">{roleLabel}</span>
        {bundle.label ? <> · <span className="text-white">{bundle.label}</span></> : null}
      </p>
      <button
        onClick={onContinue}
        className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 transition-colors text-white font-semibold mb-2"
      >
        Continue to display
      </button>
      <button
        onClick={onUnpair}
        className="w-full py-2.5 rounded-xl text-slate-400 hover:text-red-400 transition-colors text-sm"
      >
        Unpair this device
      </button>
    </div>
  );
}

/* ─── Manual entry form (used when query params are missing or after errors) ─ */
function ManualForm({
  initialTenant,
  initialCode,
  errorMsg,
  onSubmit,
}: {
  initialTenant: string;
  initialCode:   string;
  errorMsg:      string;
  onSubmit:      (tenant: string, code: string) => Promise<boolean>;
}) {
  const [tenant, setTenant] = useState(initialTenant);
  const [digits, setDigits] = useState<string[]>(() => {
    const padded = (initialCode || '').padEnd(4, ' ').slice(0, 4).split('');
    return padded.map((c) => /\d/.test(c) ? c : '');
  });
  const [submitting, setSubmitting] = useState(false);

  const inputsRef = useRef<Array<HTMLInputElement | null>>([null, null, null, null]);

  function setDigit(idx: number, value: string) {
    const cleaned = value.replace(/\D/g, '');

    // Paste support — user pastes "4729" anywhere, distribute it.
    if (cleaned.length > 1) {
      const next = [...digits];
      for (let i = 0; i < 4; i++) next[i] = cleaned[i] ?? '';
      setDigits(next);
      const target = Math.min(cleaned.length, 3);
      inputsRef.current[target]?.focus();
      return;
    }

    const next = [...digits];
    next[idx] = cleaned;
    setDigits(next);
    if (cleaned && idx < 3) inputsRef.current[idx + 1]?.focus();
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && idx > 0) inputsRef.current[idx - 1]?.focus();
    if (e.key === 'ArrowRight' && idx < 3) inputsRef.current[idx + 1]?.focus();
  }

  const code = digits.join('');
  const ready = tenant.trim().length > 0 && code.length === 4;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!ready || submitting) return;
    setSubmitting(true);
    const ok = await onSubmit(tenant, code);
    setSubmitting(false);
    if (!ok) {
      // Refocus the first digit so the user can re-enter quickly.
      setDigits(['', '', '', '']);
      setTimeout(() => inputsRef.current[0]?.focus(), 0);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-md rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-8 shadow-2xl"
    >
      <h1
        className="text-3xl font-bold mb-2 tracking-tight text-center"
        style={{ fontFamily: 'var(--font-display, "Plus Jakarta Sans"), system-ui, sans-serif' }}
      >
        Pair this device
      </h1>
      <p className="text-slate-400 text-sm text-center mb-7">
        Enter the 4-digit code from your cashier&apos;s tablet.
      </p>

      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">
        Tenant slug
      </label>
      <input
        type="text"
        value={tenant}
        onChange={(e) => setTenant(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="acme-coffee"
        className="w-full rounded-xl bg-slate-800 border border-slate-700 text-white px-4 py-3 mb-6 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent placeholder:text-slate-500"
      />

      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">
        Pairing code
      </label>
      <div className="flex justify-center gap-3 mb-7">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { inputsRef.current[i] = el; }}
            inputMode="numeric"
            pattern="\d*"
            maxLength={4 /* allow paste */}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onFocus={(e) => e.currentTarget.select()}
            autoComplete="off"
            className="w-16 h-20 rounded-xl bg-slate-800 border border-slate-700 text-center text-4xl font-bold tabular-nums text-white focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent"
            style={{ fontFamily: 'var(--font-display, "Plus Jakarta Sans"), system-ui, sans-serif' }}
          />
        ))}
      </div>

      {errorMsg && (
        <p className="text-red-400 text-sm text-center mb-4">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={!ready || submitting}
        className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 transition-colors text-white font-semibold flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {submitting ? 'Pairing…' : 'Pair device'}
      </button>

      <p className="text-xs text-slate-500 text-center mt-6 leading-relaxed">
        No login needed. Your cashier generates the code from Settings → Displays.
      </p>
    </form>
  );
}

/* ─── Shared spinner ──────────────────────────────────────────────────────── */
function FullscreenSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-slate-300">
      <RefreshCw className="h-6 w-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
