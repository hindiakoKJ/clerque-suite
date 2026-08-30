'use client';
import { ShoppingCart, BookOpen, Users, ShieldCheck, ShoppingBasket } from 'lucide-react';
import type { AccessLevel } from '@repo/shared-types';
import { canEnterApp } from './app-roles';

/**
 * The Clerque ecosystem, in one place.
 *
 * This used to live inside the /select page, which meant /select was the only
 * screen that knew which apps a user could open — so once you were inside
 * Counter, the only way to reach Ledger was to sign out. Moving the registry
 * here lets the shell offer a switcher that agrees with the launcher by
 * construction rather than by someone remembering to update both.
 */

export interface AppCard {
  id: 'pos' | 'ledger' | 'payroll' | 'procure';
  name: string;
  description: string;
  Icon: React.ElementType;
  accent: string;
  accentDark: string;
  route: string;
  minLevel: AccessLevel;
}

// Role gates come from lib/app-roles.ts, the same table the edge middleware
// enforces. This file used to keep its own copy and check only the ACCESS
// LEVEL, so it offered cards the edge then rejected -- see the note there.
export { PROCURE_ROLES } from './app-roles';

export const APPS: AppCard[] = [
  {
    id: 'pos',
    name: 'Counter',
    description: 'Point-of-sale for retail, F&B, and services — keep the line moving.',
    Icon: ShoppingCart,
    accent: 'hsl(217 91% 55%)',
    accentDark: 'hsl(217 91% 60%)',
    route: '/pos',
    minLevel: 'OPERATOR',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    description: 'Double-entry accounting with invoices, journals, and reports.',
    Icon: BookOpen,
    accent: 'hsl(173 70% 40%)',
    accentDark: 'hsl(173 70% 45%)',
    route: '/ledger',
    minLevel: 'READ_ONLY',
  },
  {
    id: 'procure',
    name: 'Procure',
    description: 'Stock, ingredient requests, receiving, and transfers between rooms.',
    Icon: ShoppingBasket,
    accent: 'hsl(28 80% 48%)',
    accentDark: 'hsl(28 80% 58%)',
    route: '/procure',
    // Unused for Procure -- it is gated on role, not on an AppAccess row. See
    // accessibleApps below.
    minLevel: 'NONE',
  },
  {
    id: 'payroll',
    name: 'Sync',
    description: 'Staff time tracking, attendance, and payroll management.',
    Icon: Users,
    accent: 'hsl(262 70% 58%)',
    accentDark: 'hsl(262 70% 65%)',
    route: '/payroll/clock',
    minLevel: 'CLOCK_ONLY',
  },
];

export const CONSOLE_CARD: AppCard = {
  id:          'pos', // unused; routing is handled by resolvedRoute
  name:        'Console',
  description: 'Platform-wide admin: tenants, metrics, failed events, AI overrides.',
  Icon:        ShieldCheck,
  accent:      'hsl(330 70% 45%)',
  accentDark:  'hsl(330 70% 55%)',
  route:       '/admin',
  minLevel:    'NONE',
};

export type AppCardWithRoute = AppCard & { resolvedRoute: string };

/**
 * Where to land each role inside an app. Important for Sync because
 * CLOCK_ONLY (CASHIER, GENERAL_EMPLOYEE etc.) lands on /payroll/clock,
 * while OPERATOR / FULL (PAYROLL_MASTER, BUSINESS_OWNER) lands on the HR
 * dashboard.
 */
export function routeForApp(
  app: AppCard,
  level: AccessLevel | 'NONE' | undefined,
  role?: string,
): string {
  // Console (SUPER_ADMIN) → always /admin regardless of `id` shim
  if (app.name === 'Console') return '/admin';
  // KIOSK_DISPLAY accounts skip the cashier terminal and go straight to a
  // station picker — these tablets only run KDS or customer display, never
  // the till. (Defense in depth: the terminal also enforces TERMINAL_ROLES.)
  if (role === 'KIOSK_DISPLAY' && app.id === 'pos') return '/pos/select-display';
  if (app.id === 'payroll') {
    if (level === 'CLOCK_ONLY' || level === 'READ_ONLY') return '/payroll/clock';
    return '/payroll/dashboard';
  }
  return app.route;
}

/** Minimal shape this needs off the auth store's decoded JWT. */
interface AppUser {
  role:          string;
  isSuperAdmin?: boolean;
  appAccess:     Array<{ app: string; level: AccessLevel }>;
  modulePos?:     boolean;
  moduleLedger?:  boolean;
  modulePayroll?: boolean;
}

/**
 * Every app this user can actually open, already routed.
 *
 * `hasAccess` is passed in rather than read from the store so this stays a
 * pure function — the launcher and the switcher call it with the same store
 * method and cannot disagree.
 */
export function accessibleApps(
  user: AppUser | null | undefined,
  hasAccess: (code: 'POS' | 'LEDGER' | 'PAYROLL', min: AccessLevel) => boolean,
): AppCardWithRoute[] {
  if (!user) return [];

  const isSuper = user.isSuperAdmin === true || user.role === 'SUPER_ADMIN';
  const baseApps = isSuper ? [CONSOLE_CARD, ...APPS] : APPS;

  // Tenant module entitlement (modular pricing, 2026-05-08). When a flag is
  // explicitly false, hide the card even if the user has a non-NONE app access
  // level. Undefined defaults to true for backward compat.
  function moduleEnabled(code: 'POS' | 'LEDGER' | 'PAYROLL'): boolean {
    if (code === 'POS')    return user!.modulePos    !== false;
    if (code === 'LEDGER') return user!.moduleLedger !== false;
    return user!.modulePayroll !== false;
  }

  return baseApps
    .filter((app) => {
      // Console card always visible to super admins
      if (app.name === 'Console') return isSuper;
      // Procure is gated on ROLE rather than on an AppAccess row. Copying
      // the other three would have hidden it from everyone: no user has a
      // PROCURE row, and there is no tenant flag for it, so both gates
      // would fail for a card that should simply be there.
      if (app.id === 'procure') return canEnterApp('procure', user.role);
      const code = app.id.toUpperCase() as 'POS' | 'LEDGER' | 'PAYROLL';
      // First gate: tenant plan must include the module.
      if (!moduleEnabled(code)) return false;
      // Second gate: user's per-app access level.
      if (!hasAccess(code, app.minLevel)) return false;
      // Third gate, and the one that was missing: the role gate the EDGE
      // applies. Without it this offered Counter to MDM and WAREHOUSE_STAFF
      // on their POS:OPERATOR level, and middleware ejected them the moment
      // they clicked -- out of whatever app they were in.
      return canEnterApp(app.id, user.role);
    })
    .map((app) => {
      if (app.name === 'Console') return { ...app, resolvedRoute: app.route };
      if (app.id === 'procure')   return { ...app, resolvedRoute: app.route };
      const code  = app.id.toUpperCase() as 'POS' | 'LEDGER' | 'PAYROLL';
      const level = user.appAccess.find((a) => a.app === code)?.level;
      return { ...app, resolvedRoute: routeForApp(app, level, user.role) };
    });
}

/** Which app a path belongs to, so the switcher can mark the current one. */
export function appForPath(pathname: string): AppCardWithRoute['name'] | null {
  if (pathname.startsWith('/admin'))   return 'Console';
  if (pathname.startsWith('/pos'))     return 'Counter';
  if (pathname.startsWith('/ledger'))  return 'Ledger';
  if (pathname.startsWith('/procure')) return 'Procure';
  if (pathname.startsWith('/payroll')) return 'Sync';
  return null;
}
