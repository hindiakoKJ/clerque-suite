'use client';

/**
 * Demo Shell — shared layout for all /demo/* pages.
 *
 * Three-region layout:
 *   - Top app switcher: POS / Ledger / Sync (mirrors real app's nav at /select)
 *   - Left sidebar: section nav within current app
 *   - Main content: page-specific
 *
 * Standalone — does NOT depend on real app's AppShell, MobileNavSheet,
 * or any auth-store hooks.  The DemoBanner is mounted by the root
 * layout (apps/web/app/layout.tsx) and appears above this shell.
 *
 * Foundation note: this shell is structured so it can be lifted into a
 * Capacitor-wrapped Android POS app with minimal changes — just remove
 * the Ledger / Sync nav items and keep the POS section.
 */

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShoppingCart,
  BookOpen,
  Users,
  Sun,
  Moon,
  type LucideIcon,
} from 'lucide-react';

interface AppDef {
  id: 'pos' | 'ledger' | 'sync';
  name: string;
  tagline: string;
  Icon: LucideIcon;
  basePath: string;
  accent: string;
  accentBg: string;
  accentRing: string;
  navItems: Array<{ label: string; path: string }>;
}

const APPS: AppDef[] = [
  {
    id: 'pos',
    name: 'Counter',
    tagline: 'Point of sale',
    Icon: ShoppingCart,
    basePath: '/demo/pos',
    accent: 'text-blue-700 dark:text-blue-300',
    accentBg: 'bg-blue-100 dark:bg-blue-900/40',
    accentRing: 'ring-blue-200 dark:ring-blue-800',
    navItems: [
      { label: 'Dashboard', path: '/demo/pos/dashboard' },
      { label: 'Terminal', path: '/demo/pos/terminal' },
      { label: 'Inventory', path: '/demo/pos/inventory' },
      { label: 'Products', path: '/demo/pos/products' },
    ],
  },
  {
    id: 'ledger',
    name: 'Ledger',
    tagline: 'Books & tax',
    Icon: BookOpen,
    basePath: '/demo/ledger',
    accent: 'text-emerald-700 dark:text-emerald-300',
    accentBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    accentRing: 'ring-emerald-200 dark:ring-emerald-800',
    navItems: [
      { label: 'Dashboard', path: '/demo/ledger/dashboard' },
      { label: 'Chart of Accounts', path: '/demo/ledger/coa' },
      { label: 'Trial Balance', path: '/demo/ledger/trial-balance' },
      { label: 'Journal Entries', path: '/demo/ledger/journal' },
    ],
  },
  {
    id: 'sync',
    name: 'Sync',
    tagline: 'Payroll & HR',
    Icon: Users,
    basePath: '/demo/sync',
    accent: 'text-purple-700 dark:text-purple-300',
    accentBg: 'bg-purple-100 dark:bg-purple-900/40',
    accentRing: 'ring-purple-200 dark:ring-purple-800',
    navItems: [
      { label: 'Dashboard', path: '/demo/sync/dashboard' },
      { label: 'Time Clock', path: '/demo/sync/clock' },
      { label: 'My Attendance', path: '/demo/sync/attendance' },
      { label: 'Timesheet', path: '/demo/sync/timesheet' },
      { label: 'Payslips', path: '/demo/sync/payslips' },
    ],
  },
];

interface DemoShellProps {
  children: ReactNode;
}

export function DemoShell({ children }: DemoShellProps) {
  const pathname = usePathname();
  const currentApp =
    APPS.find((a) => pathname.startsWith(a.basePath)) ?? APPS[0];

  return (
    <div className="min-h-[calc(100vh-44px)] bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col relative">
      {/* ── Background DEMO watermark (subtle, behind content) ──────── */}
      <DemoWatermark />

      {/* ── Top app switcher ────────────────────────────────────────── */}
      <div className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2 sm:gap-4 relative z-10">
        <span className="text-stone-400 dark:text-stone-500 text-xs font-semibold uppercase tracking-wider mr-2">
          Bambu Coffee
        </span>
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap flex-1">
          {APPS.map((app) => {
            const isActive = pathname.startsWith(app.basePath);
            const Icon = app.Icon;
            const defaultPath = app.navItems[0]?.path ?? app.basePath;
            return (
              <Link
                key={app.id}
                href={defaultPath}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? `${app.accentBg} ${app.accent}`
                    : 'text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>Clerque {app.name}</span>
              </Link>
            );
          })}
        </div>
        <ThemeToggle />
      </div>

      {/* ── Body: sidebar + content ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row relative z-10">
        {/* Left sidebar */}
        <aside className="w-full md:w-56 lg:w-64 bg-white dark:bg-stone-900 border-b md:border-b-0 md:border-r border-stone-200 dark:border-stone-800 px-3 sm:px-4 py-4 md:py-6 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
          <div className="hidden md:block mb-3 px-2">
            <p className={`text-xs font-semibold uppercase tracking-wider ${currentApp.accent}`}>
              {currentApp.name}
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-500">{currentApp.tagline}</p>
          </div>
          {currentApp.navItems.map((item) => {
            const isActive = pathname === item.path;
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? `${currentApp.accentBg} ${currentApp.accent}`
                    : 'text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-x-auto">{children}</main>
      </div>
    </div>
  );
}

// ── Dark mode toggle — shares localStorage 'theme' key with real app ────────

function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    if (typeof window === 'undefined') return;
    const next = !document.documentElement.classList.contains('dark');
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
    setIsDark(next);
  }

  return (
    <button
      onClick={toggle}
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

// ── Background watermark — subtle, fixed, never blocks interaction ──────────

function DemoWatermark() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden select-none z-0"
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-stone-200 dark:text-stone-800/60 text-[160px] sm:text-[220px] font-black tracking-widest -rotate-12 opacity-30 dark:opacity-40 whitespace-nowrap">
          DEMO
        </div>
      </div>
    </div>
  );
}
