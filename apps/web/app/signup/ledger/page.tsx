'use client';

/**
 * Sprint 21 — Ledger-only self-signup wizard.
 *
 * Public route. Three logical steps presented as one scrollable form to keep
 * cognitive overhead low (every step fits on a 13" laptop screen).
 *
 *   1. Business basics: name, business type
 *   2. Owner: name, email, password
 *   3. Tax status: VAT / NON_VAT / UNREGISTERED — pick once, change later in Settings
 *
 * Submits to POST /auth/signup-ledger (public). On success, lands on
 * /login?app=ledger&tenant=<slug> with a toast confirming the trial start.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, ArrowRight, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

const ACCENT      = '#8B5E3C';
const ACCENT_SOFT = '#EEE9DF';

interface SignupResponse {
  tenantId:    string;
  tenantSlug:  string;
  ownerUserId: string;
}

const BUSINESS_TYPES = [
  { value: 'SERVICE',       label: 'Service business', desc: 'Consultancy, agency, salon, IT shop, lawyer, freelancer' },
  { value: 'RETAIL',        label: 'Retail',           desc: 'Sells goods (without our POS for now — just track AR/AP)' },
  { value: 'RESTAURANT',    label: 'F&B',              desc: 'Restaurant, café, food stall — accounting only' },
  { value: 'MANUFACTURING', label: 'Manufacturing',    desc: 'Light manufacturing or job-shop' },
] as const;

const TAX_STATUSES = [
  { value: 'NON_VAT',      label: 'NON-VAT (≤ ₱3M annual gross)', desc: 'Files BIR 2551Q (3%) + 1701Q. Most common SME.' },
  { value: 'VAT',          label: 'VAT-registered',                desc: 'Files BIR 2550Q (12%) + 1701Q. > ₱3M annual gross or voluntarily registered.' },
  { value: 'UNREGISTERED', label: 'Unregistered (not yet with BIR)', desc: 'Just starting out. No tax forms generated until you register.' },
] as const;

export default function LedgerSignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    businessName:  '',
    businessType:  'SERVICE' as typeof BUSINESS_TYPES[number]['value'],
    ownerName:     '',
    ownerEmail:    '',
    ownerPassword: '',
    taxStatus:     'NON_VAT' as typeof TAX_STATUSES[number]['value'],
    agree:         false,
  });
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<SignupResponse | null>(null);

  function set<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  // Password strength hint — mirrors backend policy without re-implementing it
  // (server still enforces; this is just user-facing feedback).
  const pwHint = (() => {
    if (!form.ownerPassword) return null;
    if (form.ownerPassword.length < 12) return { ok: false, msg: 'At least 12 characters' };
    if (form.ownerPassword.toLowerCase() === form.ownerEmail.toLowerCase()) return { ok: false, msg: 'Cannot match your email' };
    return { ok: true, msg: 'Looks good' };
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.agree) { setError('Please accept the terms to continue.'); return; }
    setBusy(true);
    try {
      const { data } = await api.post<SignupResponse>('/auth/signup-ledger', {
        businessName:  form.businessName.trim(),
        ownerName:     form.ownerName.trim(),
        ownerEmail:    form.ownerEmail.trim(),
        ownerPassword: form.ownerPassword,
        taxStatus:     form.taxStatus,
        businessType:  form.businessType,
      });
      setSuccess(data);
      // Brief pause so the success state is visible, then redirect to login
      // pre-filled with the tenant slug + email.
      setTimeout(() => {
        router.push(`/login?app=ledger&tenant=${encodeURIComponent(data.tenantSlug)}&email=${encodeURIComponent(form.ownerEmail.trim())}`);
      }, 2500);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setError(Array.isArray(msg) ? (msg[0] ?? 'Signup failed.') : (msg ?? 'Signup failed. Please try again or contact support.'));
      setBusy(false);
    }
  }

  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: ACCENT_SOFT }}>
        <div className="bg-white rounded-xl shadow-xl border border-zinc-200 max-w-md w-full p-8 text-center">
          <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: ACCENT }}>
            <CheckCircle2 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-zinc-900 mb-2">Your books are ready</h1>
          <p className="text-sm text-zinc-600 mb-4">
            Tenant <span className="font-mono font-semibold">{success.tenantSlug}</span> created.
            We sent a welcome email to <span className="font-semibold">{form.ownerEmail}</span>.
          </p>
          <p className="text-xs text-zinc-500">Redirecting you to sign in…</p>
          <Loader2 className="h-4 w-4 mx-auto mt-3 animate-spin text-zinc-400" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: ACCENT_SOFT }}>
      {/* Top bar */}
      <header className="px-6 py-4 bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/welcome/ledger" className="flex items-center gap-2 text-zinc-900 font-semibold">
            <BookOpen className="h-5 w-5" style={{ color: ACCENT }} />
            Clerque Books
          </Link>
          <Link href="/login?app=ledger" className="text-sm text-zinc-600 hover:text-zinc-900">
            Already have an account? <span style={{ color: ACCENT }} className="font-medium">Sign in</span>
          </Link>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold text-zinc-900 mb-2">Start your 90-day free trial</h1>
        <p className="text-sm text-zinc-600 mb-8">
          Ledger-only access. No POS, no credit card, no contract. Cancel anytime by emailing support.
        </p>

        <form onSubmit={submit} className="space-y-6 bg-white rounded-xl border border-zinc-200 p-6">

          {/* ── Step 1: Business ──────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-900 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold" style={{ background: ACCENT }}>1</span>
              About your business
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Business name *</label>
                <input required
                  value={form.businessName}
                  onChange={(e) => set('businessName', e.target.value)}
                  placeholder="e.g. Acme Consulting Services"
                  className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  style={{ '--accent': ACCENT } as React.CSSProperties} />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Business type *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {BUSINESS_TYPES.map((b) => (
                    <label key={b.value}
                      className={`p-2.5 rounded-md border cursor-pointer ${
                        form.businessType === b.value ? 'border-2' : 'border-zinc-300 hover:border-zinc-400'
                      }`}
                      style={form.businessType === b.value ? { borderColor: ACCENT, background: ACCENT_SOFT } : {}}>
                      <input type="radio" name="businessType" checked={form.businessType === b.value}
                        onChange={() => set('businessType', b.value)} className="sr-only" />
                      <div className="text-sm font-medium text-zinc-900">{b.label}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{b.desc}</div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── Step 2: Owner ─────────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-900 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold" style={{ background: ACCENT }}>2</span>
              About you
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">Your name *</label>
                  <input required
                    value={form.ownerName}
                    onChange={(e) => set('ownerName', e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">Email *</label>
                  <input required type="email"
                    value={form.ownerEmail}
                    onChange={(e) => set('ownerEmail', e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Password *</label>
                <input required type="password" minLength={12}
                  value={form.ownerPassword}
                  onChange={(e) => set('ownerPassword', e.target.value)}
                  placeholder="At least 12 characters"
                  className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm" />
                {pwHint && (
                  <p className={`text-[11px] mt-1 flex items-center gap-1 ${pwHint.ok ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {pwHint.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                    {pwHint.msg}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ── Step 3: Tax status ────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-900 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold" style={{ background: ACCENT }}>3</span>
              BIR tax status
            </h2>
            <p className="text-xs text-zinc-500 mb-3">Drives which BIR forms we generate. You can change this in Settings later.</p>
            <div className="space-y-2">
              {TAX_STATUSES.map((t) => (
                <label key={t.value}
                  className={`block p-3 rounded-md border cursor-pointer ${
                    form.taxStatus === t.value ? 'border-2' : 'border-zinc-300 hover:border-zinc-400'
                  }`}
                  style={form.taxStatus === t.value ? { borderColor: ACCENT, background: ACCENT_SOFT } : {}}>
                  <input type="radio" name="taxStatus" checked={form.taxStatus === t.value}
                    onChange={() => set('taxStatus', t.value)} className="sr-only" />
                  <div className="text-sm font-medium text-zinc-900">{t.label}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{t.desc}</div>
                </label>
              ))}
            </div>
          </section>

          {/* ── Agreement + submit ────────────────────────────────────────── */}
          <section className="border-t border-zinc-200 pt-4">
            <label className="flex items-start gap-2 cursor-pointer mb-4">
              <input type="checkbox" checked={form.agree}
                onChange={(e) => set('agree', e.target.checked)}
                className="mt-1" />
              <span className="text-xs text-zinc-600">
                I agree to the <Link href="/legal/terms" className="underline">Terms of Service</Link> and{' '}
                <Link href="/legal/privacy" className="underline">Privacy Policy</Link> (RA 10173 compliant).
              </span>
            </label>
            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3 mb-3 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={busy || !form.agree}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-white font-semibold text-sm disabled:opacity-50"
              style={{ background: ACCENT }}>
              {busy ? (<><Loader2 className="h-4 w-4 animate-spin" /> Setting up your books…</>) : (<>Start free trial <ArrowRight className="h-4 w-4" /></>)}
            </button>
            <p className="text-[11px] text-zinc-500 text-center mt-3">
              90 days free. No card on file. Email <a href="mailto:support@clerque.ph" className="underline">support@clerque.ph</a> to cancel.
            </p>
          </section>
        </form>
      </div>
    </main>
  );
}
