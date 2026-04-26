'use client';

import { useState, useEffect, type ElementType } from 'react';
import {
  Eye, EyeOff, ArrowRight,
  ShoppingCart, BookOpen, Users, Wifi, WifiOff, Check,
  Sun, Moon,
} from 'lucide-react';

/* ─── Product registry ─────────────────────────────────────────────────── */

export type AppProduct = 'pos' | 'ledger' | 'payroll';

interface ProductConfig {
  name: string;
  Icon: ElementType;
  accent: string;
  accentDark: string;
  heroWords: [string, string];
  sub: string;
  features: string[];
  showOffline: boolean;
  shadowClass: string;
}

const PRODUCTS: Record<AppProduct, ProductConfig> = {
  pos: {
    name: 'Counter',
    Icon: ShoppingCart,
    accent: 'hsl(217 91% 55%)',
    accentDark: 'hsl(217 91% 65%)',
    heroWords: ['Sell faster.', 'Close the till.'],
    sub: 'Clerque Counter — point-of-sale for retail, F&B, and services. Built to keep the line moving.',
    features: [
      'Fast checkout with barcode + hotkeys',
      'Works offline, syncs when back',
      'Runs on tablet or desktop terminal',
    ],
    showOffline: true,
    shadowClass: 'shadow-blue-500/20',
  },
  ledger: {
    name: 'Ledger',
    Icon: BookOpen,
    accent: 'hsl(173 70% 40%)',
    accentDark: 'hsl(173 70% 50%)',
    heroWords: ['Books in order.', 'Reports on time.'],
    sub: 'Clerque Ledger — double-entry accounting with invoices, reports, and tax-ready exports.',
    features: [
      'Chart of accounts + journal entries',
      'Invoices, bills, and reconciliation',
      'Monthly, quarterly, year-end reports',
    ],
    showOffline: false,
    shadowClass: 'shadow-teal-500/20',
  },
  payroll: {
    name: 'Sync',
    Icon: Users,
    accent: 'hsl(262 70% 58%)',
    accentDark: 'hsl(262 70% 68%)',
    heroWords: ['Your team,', 'in sync.'],
    sub: 'Staff time tracking and attendance — clock in, review timesheets, stay on top of hours.',
    features: [
      'Clock in / out from any device',
      'Weekly timesheet + approval flow',
      'Attendance calendar per employee',
    ],
    showOffline: false,
    shadowClass: 'shadow-violet-500/20',
  },
};

/* ─── Props ─────────────────────────────────────────────────────────────── */

export interface LoginValues {
  tenantId: string;
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface AppLoginPageProps {
  product: AppProduct;
  onSubmit: (values: LoginValues) => void;
  loading?: boolean;
  error?: string;
  siblingUrls?: Partial<Record<AppProduct, string>>;
}

/* ─── Theme toggle (reused by AppShell) ─────────────────────────────────── */
export function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  if (isDark) {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  }
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function AppLoginPage({
  product,
  onSubmit,
  loading = false,
  error,
  siblingUrls = {},
}: AppLoginPageProps) {
  const p = PRODUCTS[product];
  const { Icon } = p;

  const [tenantId,   setTenantId]   = useState('');
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isOnline,   setIsOnline]   = useState(true);
  const [isDark,     setIsDark]     = useState(false);

  /* Sync dark state — layout.tsx script sets class before paint */
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  /* Online / offline (POS only) */
  useEffect(() => {
    if (!p.showOffline) return;
    setIsOnline(navigator.onLine);
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online',  on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [p.showOffline]);

  const accent = isDark ? p.accentDark : p.accent;
  const heroBg = isDark
    ? `color-mix(in oklab, ${accent} 8%, #030712)`
    : `color-mix(in oklab, ${accent} 6%, #ffffff)`;

  const siblings = (Object.keys(PRODUCTS) as AppProduct[])
    .filter((id) => id !== product && siblingUrls[id])
    .map((id) => ({ ...PRODUCTS[id], id, url: siblingUrls[id]! }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ tenantId: tenantId.trim(), email, password, rememberMe });
  }

  /* Read dark state from DOM directly — avoids stale closure on focus */
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

  const inputCls =
    'w-full rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground px-3 py-3 outline-none transition-all text-sm';

  return (
    <div className="flex min-h-screen flex-col lg:flex-row bg-background text-foreground antialiased">

      {/* ════════════════ HERO — left panel ════ */}
      <div
        className="order-2 flex flex-1 flex-col justify-between p-8 lg:order-1 lg:p-16"
        style={{ backgroundColor: heroBg }}
      >
        <div className="flex items-center gap-2 font-bold text-xl" style={{ color: accent }}>
          <Icon className="w-6 h-6" />
          <span>Clerque · {p.name}</span>
        </div>

        <div className="max-w-md space-y-6">
          <h1 className="text-5xl font-extrabold tracking-tight text-foreground lg:text-6xl">
            {p.heroWords[0]}<br />
            <span style={{ color: accent }}>{p.heroWords[1]}</span>
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">{p.sub}</p>

          <ul className="space-y-4 pt-4">
            {p.features.map((f) => (
              <li key={f} className="flex items-center gap-3 text-foreground">
                <div className="rounded-full p-1 text-white shrink-0" style={{ background: accent }}>
                  <Check className="w-4 h-4" />
                </div>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Clerque {p.name} · v1.0.0</span>
          <span className="ml-auto flex gap-3">
            <a href="#" className="hover:underline">Terms</a>
            <a href="#" className="hover:underline">Privacy</a>
            <a href="#" className="hover:underline">Support</a>
          </span>
        </div>
      </div>

      {/* ════════════════ FORM — right panel ════ */}
      <div className="relative order-1 flex flex-1 flex-col items-center justify-center p-8 bg-card lg:order-2 lg:p-16">

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle dark mode"
          className="absolute top-6 left-6 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Online / offline badge */}
        {p.showOffline && (
          <div className={`absolute top-6 right-6 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border ${
            isOnline
              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800'
              : 'bg-amber-500/10 text-amber-600 border-amber-200 dark:text-amber-400 dark:border-amber-800'
          }`}>
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isOnline ? 'Online' : 'Offline · queued'}
          </div>
        )}

        <div className="w-full max-w-sm space-y-8">

          <div className="space-y-2">
            {siblings.length > 0 && (
              <div className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
                <span>or sign in to:</span>
                {siblings.map((s) => {
                  const SibIcon = s.Icon;
                  const sibAccent = isDark ? s.accentDark : s.accent;
                  return (
                    <a
                      key={s.id}
                      href={s.url}
                      className="font-medium hover:underline inline-flex items-center gap-1"
                      style={{ color: sibAccent }}
                    >
                      <SibIcon className="w-3 h-3" />
                      {s.name}
                    </a>
                  );
                })}
              </div>
            )}
            <h2 className="text-3xl font-bold text-foreground">
              Sign in to Clerque {p.name}
            </h2>
            <p className="text-muted-foreground">
              Enter your tenant ID, email, and password.
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">Tenant ID</label>
              <input
                type="text"
                placeholder="acme-01"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                required
                autoCapitalize="none"
                autoComplete="organization"
                className={`${inputCls} font-mono`}
                onFocus={onInputFocus}
                onBlur={onInputBlur}
              />
              <p className="text-[11px] text-muted-foreground">
                Your organisation ID (same across all apps).
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">Email</label>
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

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-foreground">Password</label>
                <a href="#" className="text-xs font-medium hover:underline" style={{ color: accent }}>
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
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
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-[var(--accent)]"
              />
              <label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer select-none">
                Remember me on this device
              </label>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-3">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`group flex w-full items-center justify-center gap-2 rounded-lg py-3.5 font-semibold text-white shadow-lg ${p.shadowClass} hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
              style={{ background: accent }}
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Sign in to Clerque {p.name}
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>

            <p className="pt-2 text-center text-xs text-muted-foreground">
              Need access?{' '}
              <a href="#" className="font-medium text-foreground hover:underline">
                Contact your admin
              </a>
            </p>
          </form>
        </div>
      </div>

    </div>
  );
}
