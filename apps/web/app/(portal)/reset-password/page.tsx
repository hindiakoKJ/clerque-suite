'use client';

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, Eye, EyeOff, Sun, Moon, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { AppProduct } from '@/components/portal/AppLoginPage';
import { toggleTheme } from '@/components/portal/AppLoginPage';

const ACCENT: Record<AppProduct, string> = {
  pos:     'hsl(217 91% 55%)',
  ledger:  'hsl(173 70% 40%)',
  payroll: 'hsl(262 70% 58%)',
};

/** Simple password strength: 0–3 */
function strength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8)  return 0;
  if (pw.length < 10) return 1;
  const hasUpper  = /[A-Z]/.test(pw);
  const hasNum    = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const extras    = [hasUpper, hasNum, hasSymbol].filter(Boolean).length;
  if (extras >= 2) return 3;
  if (extras === 1) return 2;
  return 1;
}
const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Strong'];
const STRENGTH_COLORS = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-500'];

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const token        = searchParams.get('token') ?? '';
  const slug         = searchParams.get('slug')  ?? '';
  const product      = (searchParams.get('app')  ?? 'pos') as AppProduct;
  const accent       = ACCENT[product] ?? ACCENT.pos;

  const [newPassword, setNewPassword] = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [showPw,      setShowPw]      = useState(false);
  const [showCf,      setShowCf]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [done,        setDone]        = useState(false);
  const [error,       setError]       = useState<string | undefined>();
  const [isDark,      setIsDark]      = useState(false);

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // If no token in URL, this link is invalid
  const isInvalidLink = !token.trim();

  const pwStrength  = strength(newPassword);
  const mismatch    = confirm.length > 0 && newPassword !== confirm;
  const canSubmit   = !loading && newPassword.length >= 8 && newPassword === confirm && !!token;

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
    if (!canSubmit) return;
    setLoading(true);
    setError(undefined);
    try {
      await api.post('/auth/reset-password', { token, newPassword });
      setDone(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      setError(Array.isArray(msg) ? (msg[0] ?? 'Something went wrong.') : (msg ?? 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
  }

  const loginUrl = slug
    ? `/login?app=${product}&slug=${slug}`
    : `/login?app=${product}`;

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
          href={loginUrl}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sign in
        </a>

        {/* ── Invalid link ── */}
        {isInvalidLink && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">Invalid reset link</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                This link is missing a reset token. Please use the link from your email, or
                request a new one.
              </p>
              <a
                href={`/forgot-password?app=${product}`}
                className="mt-2 inline-block text-sm font-medium hover:underline"
                style={{ color: accent }}
              >
                Request a new link
              </a>
            </div>
          </div>
        )}

        {/* ── Success screen ── */}
        {!isInvalidLink && done && (
          <div className="space-y-6 text-center">
            <div
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: `color-mix(in oklab, ${accent} 15%, transparent)` }}
            >
              <CheckCircle2 className="h-8 w-8" style={{ color: accent }} />
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl font-bold text-foreground">Password updated</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Your password has been reset successfully. All other sessions have been
                signed out for your security.
              </p>
              <button
                type="button"
                className="mt-2 flex w-full items-center justify-center rounded-lg py-3.5 font-semibold text-white shadow-lg hover:brightness-110 transition-all"
                style={{ background: accent }}
                onClick={() => router.push(loginUrl)}
              >
                Sign in with new password
              </button>
            </div>
          </div>
        )}

        {/* ── Reset form ── */}
        {!isInvalidLink && !done && (
          <>
            <div className="space-y-2">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ background: `color-mix(in oklab, ${accent} 15%, transparent)` }}
              >
                <KeyRound className="h-6 w-6" style={{ color: accent }} />
              </div>
              <h2 className="text-3xl font-bold text-foreground">Choose a new password</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Must be at least 8 characters. All your active sessions will be signed out
                after the reset.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>

              {/* New password */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">New password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className={`${inputCls} pr-11`}
                    onFocus={onInputFocus}
                    onBlur={onInputBlur}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Strength meter */}
                {newPassword.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3].map((bar) => (
                        <div
                          key={bar}
                          className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                            pwStrength >= bar ? STRENGTH_COLORS[pwStrength] : 'bg-muted'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {STRENGTH_LABELS[pwStrength]}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">Confirm password</label>
                <div className="relative">
                  <input
                    type={showCf ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    className={`${inputCls} pr-11 ${mismatch ? 'border-red-400' : ''}`}
                    onFocus={onInputFocus}
                    onBlur={onInputBlur}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCf(!showCf)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showCf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {mismatch && (
                  <p className="text-xs text-red-500">Passwords don&apos;t match.</p>
                )}
              </div>

              {/* API error */}
              {error && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-3">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="group flex w-full items-center justify-center gap-2 rounded-lg py-3.5 font-semibold text-white shadow-lg hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: accent }}
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Reset password'
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordInner />
    </Suspense>
  );
}
