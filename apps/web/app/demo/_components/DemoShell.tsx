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

import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShoppingCart,
  BookOpen,
  Users,
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
  navItems: Array<{ label: string; path: string }>;
}

const APPS: AppDef[] = [
  {
    id: 'pos',
    name: 'Counter',
    tagline: 'Point of sale',
    Icon: ShoppingCart,
    basePath: '/demo/pos',
    accent: 'text-blue-700',
    accentBg: 'bg-blue-100',
    navItems: [
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
    accent: 'text-emerald-700',
    accentBg: 'bg-emerald-100',
    navItems: [
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
    accent: 'text-purple-700',
    accentBg: 'bg-purple-100',
    navItems: [
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
    <div className="min-h-[calc(100vh-44px)] bg-stone-50 flex flex-col">
      {/* ── Top app switcher ────────────────────────────────────────── */}
      <div className="bg-white border-b border-stone-200 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2 sm:gap-4">
        <span className="text-stone-400 text-xs font-semibold uppercase tracking-wider mr-2">
          Bambu Coffee
        </span>
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
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
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>Clerque {app.name}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Body: sidebar + content ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row">
        {/* Left sidebar */}
        <aside className="w-full md:w-56 lg:w-64 bg-white border-b md:border-b-0 md:border-r border-stone-200 px-3 sm:px-4 py-4 md:py-6 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
          <div className="hidden md:block mb-3 px-2">
            <p className={`text-xs font-semibold uppercase tracking-wider ${currentApp.accent}`}>
              {currentApp.name}
            </p>
            <p className="text-xs text-stone-500">{currentApp.tagline}</p>
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
                    : 'text-stone-600 hover:bg-stone-100'
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
