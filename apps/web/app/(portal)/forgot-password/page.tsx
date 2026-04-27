'use client';

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Mail, Sun, Moon, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { AppProduct } from '@/components/portal/AppLoginPage';
import { toggleTheme } from '@/components/portal/AppLoginPage';

const ACCENT: Record<AppProduct, string> = {
  pos:     'hsl(217 91% 55%)',
  ledger:  'hsl(173 70% 40%)',
  payroll: 'hsl(262 70% 58%)',
};

function ForgotPasswordInner() {
  const searchParams = useSearchParams();
  const product = (searchParams.get('app') ?? 'pos') as AppProduct;
  const accent   = ACCENT[product] ?? ACCENT.pos;

  const [tenantSlug, setTenantSlug] = useState('');
  const [email,      setEmail]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [sent,       setSent]       = useState(false);
  const [isDark,     setIsDark]     = useState(false);

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const inputCls =
    'w-full rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 py-3 outline-none transition-all text-sm';

  function onInputFocus(e: React.FocusEvent<HTMLInputElement>) {
    const dark = document.documentElement.classList.contains('dark');
    e.currentTarget.style.borderColor     = accent;
    e.currentTarget.style.backgroundColor = dark ? '#1e293b' : '#ffffff';
    e.currentTarget.style.color           = dark ? '#f1f5f9' : '#0f172a';
    e.currentTarget.style.boxShadow       = `0 0 0 3px color-mix(in oklab, ${accent} 18%, transparent)`;
  }
  function onInputBlur(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor     = '';
    e.currentTarget.style.backgroundColor = '';
    e.currentTarget.style.color           = '';
    e.currentTarget.style.boxShadow       = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Always POST — backend never reveals whether the email exists
      await api.post('/auth/forgot-password', {
        email:      email.trim().toLowerCase(),
        tenantSlug: tenantSlug.trim().toLowerCase(),
      });
    } catch {
      // Intentionally swallowed — we always show the success screen
    }
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8 antialiased">

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle dark mode"
        className="absolute top-6 left-6 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="w-full max-w-sm space-y-8">

        {/* Back link */}
        <a
          href={`/login?app=${product}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sign in
        </a>

        {sent ? (
          /* ── Success screen ── */
          <div className="space-y-6 text-center">
            <div
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: `color-mix(in oklab, ${accent} 15%, transparent)` }}
            >
              <CheckCircle2 className="h-8 w-8" style={{ color: accent }} />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">Check your inbox</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                If an account matching <strong>{email}</strong> exists for company&nbsp;
                <strong className="font-mono">{tenantSlug}</strong>, you&apos;ll receive a
                password reset link within a few minutes.
              </p>
              <p className="text-muted-foreground text-xs">
                Didn&apos;t receive it? Check your spam folder or{' '}
                <button
                  type="button"
                  className="font-medium underline"
                  style={{ color: accent }}
                  onClick={() => setSent(false)}
                >
                  try again
                </button>
                .
              </p>
            </div>
          </div>
        ) : (
          /* ── Form ── */
          <>
            <div className="space-y-2">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ background: `color-mix(in oklab, ${accent} 15%, transparent)` }}
              >
                <Mail className="h-6 w-6" style={{ color: accent }} />
              </div>
              <h2 className="text-3xl font-bold text-foreground">Reset your password</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Enter your company code and email address and we&apos;ll send you a link to
                reset your password.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">Company code</label>
                <input
                  type="text"
                  placeholder="acme-01"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  required
                  autoCapitalize="none"
                  autoComplete="organization"
                  className={`${inputCls} font-mono`}
                  onFocus={onInputFocus}
                  onBlur={onInputBlur}
                />
                <p className="text-[11px] text-muted-foreground">
                  The same company code you use to sign in.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">Email address</label>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className={inputCls}
                  onFocus={onInputFocus}
                  onBlur={onInputBlur}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !tenantSlug.trim() || !email.trim()}
                className="group flex w-full items-center justify-center gap-2 rounded-lg py-3.5 font-semibold text-white shadow-lg hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: accent }}
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Send reset link'
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordInner />
    </Suspense>
  );
}
