'use client';

/**
 * Sprint 24 — Customer payment-instructions page.
 *
 * Public URL: /pay/<refCode>
 *
 * Customer lands here after signup or from a renewal email. Shows:
 *   - Plan + amount due + reference code
 *   - Owner's configured payment methods (Maya / BDO / Maribank / etc.)
 *   - Form to submit proof of payment (transaction ID + screenshot URL + method)
 *
 * No authentication — the 5-character reference code is the access control.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, AlertCircle, Loader2, Copy } from 'lucide-react';

const ACCENT      = '#8B5E3C';
const ACCENT_SOFT = '#EEE9DF';

interface PendingPaymentView {
  referenceCode:  string;
  planCode:       string;
  amountPhpCents: number;
  periodStart:    string;
  periodEnd:      string;
  reason:         'NEW_SIGNUP' | 'MONTHLY_RENEWAL' | 'PLAN_UPGRADE';
  status:         'AWAITING_PROOF' | 'PROOF_SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';
  submittedAt:    string | null;
  expiresAt:      string;
  tenantName:     string;
}

interface PaymentMethod {
  type:           string;
  label:          string;
  accountDisplay: string;
  instructions?:  string;
  qrImageUrl?:    string;
}

const PLAN_LABELS: Record<string, string> = {
  SOLO_PRO:      'Solo',
  SOLO_BOOKS:    'Solo Books',
  SOLO_LITE:     'Solo Lite',
  SOLO_STANDARD: 'Solo Standard',
};

function fmtPhp(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function PaymentInstructionsPage() {
  const params = useParams<{ refCode: string }>();
  const refCode = params.refCode;
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

  const [payment, setPayment] = useState<PendingPaymentView | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Proof submission state
  const [submitting,    setSubmitting]    = useState(false);
  const [submitMethod,  setSubmitMethod]  = useState<'MAYA' | 'BDO' | 'MARIBANK' | 'GCASH'>('MAYA');
  const [submitRefId,   setSubmitRefId]   = useState('');
  const [submitNotes,   setSubmitNotes]   = useState('');
  const [submitProofUrl, setSubmitProofUrl] = useState('');
  const [submitResult,  setSubmitResult]  = useState<string | null>(null);

  useEffect(() => {
    if (!refCode) return;
    let cancelled = false;
    Promise.all([
      fetch(`${apiBase}/subscription-payments/public/${refCode}`).then((r) => r.ok ? r.json() : Promise.reject(r)),
      fetch(`${apiBase}/subscription-payments/public/payment-methods`).then((r) => r.ok ? r.json() : { methods: [] }),
    ])
      .then(([paymentData, methodsData]) => {
        if (cancelled) return;
        setPayment(paymentData);
        setMethods(methodsData.methods ?? []);
      })
      .catch(async (resOrErr) => {
        if (cancelled) return;
        if (resOrErr instanceof Response) {
          const body = await resOrErr.text();
          setError(`We couldn't find a payment for reference ${refCode}. ${body}`);
        } else {
          setError(String(resOrErr));
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refCode, apiBase]);

  async function handleCopyRef() {
    if (!payment) return;
    await navigator.clipboard.writeText(payment.referenceCode);
  }

  async function handleSubmitProof(e: React.FormEvent) {
    e.preventDefault();
    if (!submitRefId.trim()) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await fetch(`${apiBase}/subscription-payments/public/${refCode}/submit-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submittedRefId:    submitRefId.trim(),
          submittedNotes:    submitNotes.trim() || undefined,
          submittedMethod:   submitMethod,
          submittedProofUrl: submitProofUrl.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || 'Submission failed.');
      }
      const data = await res.json();
      setSubmitResult(data.message ?? 'Submitted!');
      // Refresh payment status
      const fresh = await fetch(`${apiBase}/subscription-payments/public/${refCode}`).then((r) => r.json());
      setPayment(fresh);
    } catch (err) {
      setSubmitResult(`Error: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-zinc-900 mb-2">Payment not found</h1>
          <p className="text-sm text-zinc-600">{error ?? `No payment matches reference ${refCode}.`}</p>
        </div>
      </div>
    );
  }

  const planLabel = PLAN_LABELS[payment.planCode] ?? payment.planCode;

  // ──────────────────── State: CONFIRMED ────────────────────
  if (payment.status === 'CONFIRMED') {
    return (
      <PageShell>
        <div className="bg-emerald-500 text-white rounded-lg p-6 mb-6">
          <CheckCircle2 className="h-10 w-10 mb-3" />
          <h1 className="text-2xl font-bold mb-1">Payment confirmed!</h1>
          <p className="text-sm opacity-95">
            Your <strong>{planLabel}</strong> subscription is now active. Check your email for the BIR Official Receipt.
          </p>
        </div>
        <p className="text-sm text-zinc-600 mb-4">
          You can now sign in to Clerque and start using your subscription.
        </p>
        <a href="/login" className="inline-block px-6 py-3 rounded-lg text-white font-semibold text-sm" style={{ background: ACCENT }}>
          Sign in to Clerque →
        </a>
      </PageShell>
    );
  }

  // ──────────────────── State: REJECTED ────────────────────
  if (payment.status === 'REJECTED') {
    return (
      <PageShell>
        <div className="bg-amber-500 text-white rounded-lg p-6 mb-6">
          <AlertCircle className="h-10 w-10 mb-3" />
          <h1 className="text-2xl font-bold mb-1">Payment couldn&apos;t be verified</h1>
          <p className="text-sm opacity-95">
            Check your email for the specific reason and instructions to re-submit.
          </p>
        </div>
        <p className="text-sm text-zinc-600">
          If you believe this is a mistake, reply to the email we sent you.
        </p>
      </PageShell>
    );
  }

  // ──────────────────── State: EXPIRED ────────────────────
  if (payment.status === 'EXPIRED') {
    return (
      <PageShell>
        <div className="bg-zinc-700 text-white rounded-lg p-6 mb-6">
          <AlertCircle className="h-10 w-10 mb-3" />
          <h1 className="text-2xl font-bold mb-1">This payment link expired</h1>
          <p className="text-sm opacity-95">
            Payment instructions are only valid for 30 days. Please start a fresh signup.
          </p>
        </div>
        <a href="/welcome/pos" className="inline-block px-6 py-3 rounded-lg text-white font-semibold text-sm" style={{ background: ACCENT }}>
          Start a new signup →
        </a>
      </PageShell>
    );
  }

  // ──────────────────── State: AWAITING_PROOF or PROOF_SUBMITTED ────────────────────
  const submitted = payment.status === 'PROOF_SUBMITTED';

  return (
    <PageShell>
      {submitted && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4 mb-6 text-sm">
          <strong>Proof received.</strong> We&apos;ll verify within 4 business hours and confirm by email. You can still re-submit if you need to.
        </div>
      )}

      <h1 className="text-2xl font-bold text-zinc-900 mb-2">Activate your Clerque subscription</h1>
      <p className="text-sm text-zinc-600 mb-6">
        Hi <strong>{payment.tenantName}</strong>, send{' '}
        <strong className="font-mono">{fmtPhp(payment.amountPhpCents)}</strong> for your{' '}
        <strong>{planLabel}</strong> {payment.reason === 'NEW_SIGNUP' ? 'subscription' : 'renewal'} using any of the methods below.
      </p>

      {/* Summary card */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reference code</span>
          <button onClick={handleCopyRef} className="text-xs text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-1">
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
        <div className="font-mono text-2xl font-bold mb-3" style={{ color: ACCENT }}>{payment.referenceCode}</div>
        <p className="text-xs text-zinc-600 mb-3">
          <strong>Include this in your transfer remarks/notes</strong> so we can match your deposit.
        </p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-zinc-500 mb-0.5">Amount</div>
            <div className="font-mono font-semibold text-zinc-900">{fmtPhp(payment.amountPhpCents)}</div>
          </div>
          <div>
            <div className="text-zinc-500 mb-0.5">Plan</div>
            <div className="font-semibold text-zinc-900">{planLabel}</div>
          </div>
          <div>
            <div className="text-zinc-500 mb-0.5">Expires</div>
            <div className="text-zinc-900">{fmtDate(payment.expiresAt)}</div>
          </div>
          <div>
            <div className="text-zinc-500 mb-0.5">Period</div>
            <div className="text-zinc-900 text-[11px]">{fmtDate(payment.periodStart)} – {fmtDate(payment.periodEnd)}</div>
          </div>
        </div>
      </div>

      {/* Payment methods */}
      <h2 className="text-lg font-semibold text-zinc-900 mb-3">Pay via</h2>
      {methods.length === 0 ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 mb-6 text-sm text-amber-900">
          No payment methods configured yet. Please contact support.
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {methods.map((m) => (
            <div key={m.label} className="rounded-lg border border-zinc-200 p-4">
              <div className="font-semibold text-zinc-900 mb-1">{m.label}</div>
              <div className="font-mono text-base mb-2" style={{ color: ACCENT }}>{m.accountDisplay}</div>
              {m.instructions && (
                <div className="text-xs text-zinc-600 mb-2">{m.instructions}</div>
              )}
              {m.qrImageUrl && (
                <img src={m.qrImageUrl} alt={`${m.label} QR code`} className="mt-2 w-32 h-32 rounded border border-zinc-200" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Proof submission */}
      <h2 className="text-lg font-semibold text-zinc-900 mb-3">After paying, submit your proof</h2>
      <form onSubmit={handleSubmitProof} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-zinc-700 mb-1">Payment method used</label>
          <select
            value={submitMethod}
            onChange={(e) => setSubmitMethod(e.target.value as 'MAYA' | 'BDO' | 'MARIBANK' | 'GCASH')}
            className="w-full h-10 px-3 rounded-lg border border-zinc-300 bg-white text-sm"
          >
            <option value="MAYA">Maya</option>
            <option value="MARIBANK">Maribank</option>
            <option value="BDO">BDO</option>
            <option value="GCASH">GCash</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-700 mb-1">
            Transaction reference / ID <span className="text-red-500">*</span>
          </label>
          <input
            value={submitRefId}
            onChange={(e) => setSubmitRefId(e.target.value)}
            required
            placeholder="e.g., your Maya transaction ID or InstaPay reference"
            className="w-full h-10 px-3 rounded-lg border border-zinc-300 bg-white text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-700 mb-1">
            Screenshot URL (optional)
          </label>
          <input
            value={submitProofUrl}
            onChange={(e) => setSubmitProofUrl(e.target.value)}
            type="url"
            placeholder="Upload your receipt to Google Drive / imgur and paste the link"
            className="w-full h-10 px-3 rounded-lg border border-zinc-300 bg-white text-sm"
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            For faster verification. Direct upload coming soon.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-700 mb-1">
            Notes (optional)
          </label>
          <textarea
            value={submitNotes}
            onChange={(e) => setSubmitNotes(e.target.value)}
            rows={2}
            placeholder="Anything we should know — e.g., 'paid from a different account'"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !submitRefId.trim()}
          className="w-full py-3 rounded-lg text-white font-semibold text-sm disabled:opacity-50"
          style={{ background: ACCENT }}
        >
          {submitting ? 'Submitting…' : submitted ? 'Re-submit proof' : 'Submit proof of payment'}
        </button>

        {submitResult && (
          <div className={`rounded-lg p-3 text-sm ${submitResult.startsWith('Error') ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
            {submitResult}
          </div>
        )}
      </form>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-zinc-200 py-4 px-6" style={{ background: ACCENT_SOFT }}>
        <div className="max-w-2xl mx-auto">
          <a href="/" className="font-bold text-xl" style={{ color: ACCENT }}>Clerque</a>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-10">
        {children}
      </main>
      <footer className="text-center py-6 text-xs text-zinc-500 border-t border-zinc-200">
        Questions? Reply to your welcome email or contact{' '}
        <a href="mailto:support@clerque.ph" className="underline">support@clerque.ph</a>
      </footer>
    </div>
  );
}
