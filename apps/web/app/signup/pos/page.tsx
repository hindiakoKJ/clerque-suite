'use client';

/**
 * Sprint 24 — POS self-signup with plan picker.
 *
 * Public route /signup/pos. Three steps on one page:
 *   1. Pick plan (Solo Lite / Standard / Pro card grid with comparison)
 *   2. Business + owner info
 *   3. Submit → backend creates tenant in GRACE + PendingPayment → redirect to /pay/<refCode>
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Coffee, ArrowRight, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { PLAN_CAPS } from '@repo/shared-types';

const ACCENT      = '#8B5E3C';
const ACCENT_SOFT = '#EEE9DF';

interface SignupResponse {
  tenantId:      string;
  tenantSlug:    string;
  ownerUserId:   string;
  referenceCode: string | null;
}

// Two-plan Solo lineup (Sprint-24 pricing overhaul):
//   Solo        = full-access POS                         (code SOLO_PRO,   ₱299)
//   Solo Books  = full-access POS + simple bookkeeping    (code SOLO_BOOKS, ₱399)
// Legacy codes SOLO_LITE / SOLO_STANDARD are retained for existing tenants but
// are no longer offered at signup.
type OfferedPlan = 'SOLO_PRO' | 'SOLO_BOOKS';

const PLANS: Array<{
  code: OfferedPlan;
  name: string;
  tagline: string;
  highlights: string[];
  recommended?: boolean;
}> = [
  {
    code: 'SOLO_PRO',
    name: 'Solo',
    tagline: 'Full-access point of sale',
    highlights: [
      'Up to 5 users / cashiers',
      'Full POS — unlimited products, recipes & FEFO inventory',
      'GCash + Maya + QR Ph + card tendering',
      'BIR-compliant Z-read & receipts',
      'Audit log, advanced reports & Loyalty Pro',
      'API read access + daily auto-backup',
    ],
  },
  {
    code: 'SOLO_BOOKS',
    name: 'Solo Books',
    tagline: 'Full POS + simple bookkeeping',
    highlights: [
      'Everything in Solo',
      'Simple bookkeeping — record income & expenses',
      'See money owed from charge sales',
      'Simple income-vs-expense summary',
      'Upgrade anytime for full accounting (journal, BIR, statements)',
    ],
    recommended: true,
  },
];

function priceLabel(code: OfferedPlan): string {
  const peso = Math.round(PLAN_CAPS[code].pricePhpMonthlyCents / 100);
  return `₱${peso.toLocaleString('en-PH')}`;
}

export default function PosSignupPage() {
  const router = useRouter();
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

  const [form, setForm] = useState({
    planCode:      'SOLO_BOOKS' as OfferedPlan,
    businessName:  '',
    businessType:  'COFFEE_SHOP' as
      | 'COFFEE_SHOP' | 'RESTAURANT' | 'BAKERY' | 'FOOD_STALL' | 'BAR_LOUNGE' | 'CATERING'
      | 'RETAIL' | 'SERVICE' | 'LAUNDRY' | 'MANUFACTURING'
      | 'PHARMACY' | 'TRUCKING' | 'CONSTRUCTION',
    ownerName:     '',
    ownerEmail:    '',
    ownerPassword: '',
    taxStatus:     'NON_VAT' as 'VAT' | 'NON_VAT' | 'UNREGISTERED',
    agree:         false,
  });
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

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
      const res = await fetch(`${apiBase}/auth/signup-pos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planCode:      form.planCode,
          businessName:  form.businessName.trim(),
          businessType:  form.businessType,
          ownerName:     form.ownerName.trim(),
          ownerEmail:    form.ownerEmail.trim().toLowerCase(),
          ownerPassword: form.ownerPassword,
          taxStatus:     form.taxStatus,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? 'Signup failed.');
      }
      const data: SignupResponse = await res.json();
      if (data.referenceCode) {
        router.push(`/pay/${data.referenceCode}`);
      } else {
        setError('Signup succeeded but no payment reference was created. Contact support.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-zinc-200 py-4 px-6" style={{ background: ACCENT_SOFT }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-bold text-xl" style={{ color: ACCENT }}>Clerque</Link>
          <Link href="/login" className="text-sm text-zinc-600 hover:text-zinc-900">Sign in</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full mb-4" style={{ background: ACCENT, color: 'white' }}>
            <Coffee className="h-3 w-3" /> Clerque Counter · Solo plans
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-zinc-900 leading-tight mb-3">
            Start your BIR-compliant POS
          </h1>
          <p className="text-zinc-600 max-w-xl mx-auto">
            Pick a plan, fill in your details, send payment. We&apos;ll activate your account within 4 business hours and email you the BIR Official Receipt.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-10">
          {/* Step 1: Plan picker */}
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-zinc-900">1. Pick your plan</h2>
              <p className="text-sm text-zinc-600">All plans are paid; you can upgrade or downgrade later.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PLANS.map((p) => {
                const selected = form.planCode === p.code;
                return (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => set('planCode', p.code)}
                    className={`text-left rounded-xl border-2 p-5 transition-colors ${
                      selected ? 'shadow-md' : 'border-zinc-200 hover:border-zinc-400'
                    }`}
                    style={selected ? { borderColor: ACCENT, background: ACCENT_SOFT } : {}}
                  >
                    {p.recommended && (
                      <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: ACCENT }}>
                        Most popular
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-bold text-lg text-zinc-900">{p.name}</h3>
                      {selected && <CheckCircle2 className="h-5 w-5" style={{ color: ACCENT }} />}
                    </div>
                    <p className="text-xs text-zinc-500 mb-3">{p.tagline}</p>
                    <div className="mb-4">
                      <span className="text-2xl font-bold text-zinc-900">{priceLabel(p.code)}</span>
                      <span className="text-sm text-zinc-500">/mo</span>
                    </div>
                    <ul className="space-y-1.5">
                      {p.highlights.map((h) => (
                        <li key={h} className="text-xs text-zinc-700 flex items-start gap-1.5">
                          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" style={{ color: ACCENT }} />
                          {h}
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Step 2: Business + owner info */}
          <section className="bg-zinc-50 rounded-xl border border-zinc-200 p-6">
            <h2 className="text-lg font-bold text-zinc-900 mb-4">2. Your details</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Business name <span className="text-red-500">*</span></label>
                <input
                  value={form.businessName}
                  onChange={(e) => set('businessName', e.target.value)}
                  required
                  placeholder="Marie's Café"
                  className="w-full h-10 px-3 rounded-lg border border-zinc-300 bg-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Business type</label>
                <select
                  value={form.businessType}
                  onChange={(e) => set('businessType', e.target.value as typeof form.businessType)}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-300 bg-white text-sm"
                >
                  <optgroup label="Food &amp; Beverage">
                    <option value="COFFEE_SHOP">Coffee shop / Milk tea</option>
                    <option value="RESTAURANT">Restaurant (dine-in / takeout)</option>
                    <option value="BAKERY">Bakery / Pastry shop</option>
                    <option value="FOOD_STALL">Food stall / Carinderia / Turo-turo</option>
                    <option value="BAR_LOUNGE">Bar / Lounge</option>
                    <option value="CATERING">Catering / Events</option>
                  </optgroup>
                  <optgroup label="Retail &amp; Services">
                    <option value="RETAIL">Retail / Convenience / Boutique</option>
                    <option value="SERVICE">Service business (salon, clinic, repair)</option>
                    <option value="LAUNDRY">Laundromat / Dry-cleaning</option>
                    <option value="MANUFACTURING">Manufacturing / Fabrication</option>
                  </optgroup>
                  <optgroup label="Specialized verticals (Solo Standard or Pro)">
                    <option value="PHARMACY">Pharmacy / Drugstore</option>
                    <option value="TRUCKING">Trucking / Hauling / Courier</option>
                    <option value="CONSTRUCTION">Construction / Civil works</option>
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Tax status</label>
                <select
                  value={form.taxStatus}
                  onChange={(e) => set('taxStatus', e.target.value as typeof form.taxStatus)}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-300 bg-white text-sm"
                >
                  <option value="NON_VAT">Non-VAT (Percentage Tax 3%)</option>
                  <option value="VAT">VAT-registered (12%)</option>
                  <option value="UNREGISTERED">Not yet BIR-registered</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Your name <span className="text-red-500">*</span></label>
                <input
                  value={form.ownerName}
                  onChange={(e) => set('ownerName', e.target.value)}
                  required
                  placeholder="Maria Dela Cruz"
                  className="w-full h-10 px-3 rounded-lg border border-zinc-300 bg-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Your email <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  value={form.ownerEmail}
                  onChange={(e) => set('ownerEmail', e.target.value)}
                  required
                  placeholder="maria@example.com"
                  className="w-full h-10 px-3 rounded-lg border border-zinc-300 bg-white text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Set a password <span className="text-red-500">*</span></label>
                <input
                  type="password"
                  value={form.ownerPassword}
                  onChange={(e) => set('ownerPassword', e.target.value)}
                  required
                  minLength={12}
                  placeholder="At least 12 characters"
                  className="w-full h-10 px-3 rounded-lg border border-zinc-300 bg-white text-sm"
                />
                {pwHint && (
                  <p className={`text-xs mt-1 ${pwHint.ok ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {pwHint.msg}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Submit */}
          <section>
            <label className="flex items-start gap-3 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={form.agree}
                onChange={(e) => set('agree', e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm text-zinc-700">
                I agree to the{' '}
                <Link href="/legal/terms" className="underline">Terms of Service</Link>{' '}
                and{' '}
                <Link href="/legal/privacy" className="underline">Privacy Policy</Link>.
                I understand this subscription is paid manually (Maya / Maribank / BDO) for the first month.
              </span>
            </label>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-4 text-sm text-red-800 flex gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-12 rounded-lg text-white font-semibold text-base disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: ACCENT }}
            >
              {busy
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating account…</>
                : <>Create account &amp; get payment instructions <ArrowRight className="h-4 w-4" /></>}
            </button>
            <p className="text-xs text-zinc-500 text-center mt-3">
              You&apos;ll be sent to a payment-instructions page next. Activation happens within 4 business hours after you submit proof of payment.
            </p>
          </section>
        </form>
      </main>
    </div>
  );
}
