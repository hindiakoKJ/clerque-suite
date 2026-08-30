import { NextResponse, type NextRequest } from 'next/server';
import { DEVICE_TOKEN_SURFACES } from './lib/device-surfaces';
import { jwtDecode } from 'jwt-decode';
import type { JwtPayload } from '@repo/shared-types';
import { levelValue } from '@repo/shared-types';
import { POS_ROLES, LEDGER_ROLES, PROCURE_ROLES } from '@/lib/app-roles';

/**
 * Multi-tenant + multi-domain routing middleware.
 *
 * Hostname-based gating:
 *   • console.* hostnames  → ONLY /admin/* and /login allowed.
 *                            All tenant apps (/pos, /ledger, /payroll) are
 *                            blocked → redirected to /admin (or /login).
 *   • everything else      → Tenant apps allowed. /admin is BLOCKED →
 *                            redirected to /select (so customers visiting
 *                            clerque.cc never see Console).
 *
 * Detection: if the hostname starts with `console.` we treat it as the
 * platform-admin entrypoint. Local dev (`localhost`, `127.0.0.1`) is
 * treated as the tenant domain unless an explicit ?host=console query is
 * supplied (kept simple — devs can hit /admin directly without DNS).
 */

const APP_RULES: Array<{
  prefix: string;
  app: 'POS' | 'LEDGER' | 'PAYROLL';
  minLevel: Parameters<typeof levelValue>[0];
  clockOnlyRedirect?: string;
}> = [
  { prefix: '/pos',     app: 'POS',     minLevel: 'OPERATOR' },
  { prefix: '/ledger',  app: 'LEDGER',  minLevel: 'READ_ONLY' },
  { prefix: '/payroll', app: 'PAYROLL', minLevel: 'CLOCK_ONLY', clockOnlyRedirect: '/payroll/clock' },
];

// Public paths — accessible without authentication.
// /legal/* (privacy policy, terms of service) must be reachable from the
// unauthenticated login page footer for Data Privacy Act compliance.
// /offline is the service worker's fallback page. It must be public and
// redirect-free: the worker precaches it, and a cached auth redirect would
// send an offline cashier to a login screen that cannot possibly load.
const PUBLIC_PATHS = ['/', '/login', '/select', '/offline'];
// /stub/* — laundry public claim ticket. /stamps/* — Sprint 19 public
// loyalty stamp card pull-up (QR on printed receipts, SMS links).
// /payroll/kiosk — Sprint 19 shared clock-in tablet (PIN-based punch);
//   the device authenticates via apiKey in the URL, no JWT involved.
const PUBLIC_PREFIXES = [
  '/legal', '/forgot-password', '/reset-password',
  '/stub', '/stamps', '/payroll/kiosk',
  // Sprint 24 — subscription payment instructions (customer-facing, public).
  // Access controlled by the 5-char reference code in the URL.
  '/pay',
  // Sprint 24 — marketing/welcome + signup pages
  '/welcome', '/signup',
  // Sprint 25 — Counter design preview (static HTML mockup under /public)
  '/design-preview',
  // Sprint 25 — Paired display surfaces. Access controlled by device token
  // in localStorage (verified against the API on every poll), not JWT.
  // Lets a TV / second tablet show the customer screen or KDS without
  // ever logging into a tenant account.
  // Paired display surfaces — see lib/device-surfaces.ts. Spread rather than
  // restated so the edge guard and the 401 handler cannot drift apart.
  ...DEVICE_TOKEN_SURFACES,
];

function getToken(req: NextRequest): string | null {
  return req.cookies.get('app-session')?.value ?? null;
}

function isConsoleHost(hostname: string): boolean {
  // Production: `console.clerque.cc` (or any `console.<anything>`)
  // Vercel preview: `console-<branch>-<team>.vercel.app` not auto-detected
  //   (use ?host=console query to force Console mode in previews)
  return hostname.toLowerCase().startsWith('console.');
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hostname = req.headers.get('host') ?? req.nextUrl.hostname;
  const consoleMode =
    isConsoleHost(hostname) ||
    req.nextUrl.searchParams.get('host') === 'console';

  // Public + Next.js internals always allowed
  if (
    PUBLIC_PATHS.some((p) => pathname === p) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api')
  ) {
    return NextResponse.next();
  }

  // Demo path public (test-demo, sessionStorage-only)
  if (pathname.startsWith('/demo')) {
    return NextResponse.next();
  }

  const token = getToken(req);

  // Not authenticated → login. On console subdomain, after login, super-admins
  // land on /admin. On main domain, regular users land on /select per the
  // existing flow.
  if (!token) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  let user: JwtPayload;
  try {
    user = jwtDecode<JwtPayload>(token);
  } catch {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // Treat role=SUPER_ADMIN as super-admin even if `isSuperAdmin` flag wasn't
  // populated (older JWTs minted before the auth.service fix). This makes
  // the middleware resilient to schema/token version drift.
  const isSuper = user.isSuperAdmin === true || user.role === 'SUPER_ADMIN';

  // ── Hostname-based hard gating ──────────────────────────────────────────
  if (consoleMode) {
    // On the console subdomain, only /admin/* is permitted.
    if (!pathname.startsWith('/admin')) {
      // Super-admin: silently send them to the Console dashboard.
      // Anyone else: send to /login (they shouldn't be on this subdomain).
      const dest = req.nextUrl.clone();
      dest.pathname = isSuper ? '/admin/dashboard' : '/login';
      dest.search = '';
      return NextResponse.redirect(dest);
    }
    // /admin requires super-admin (defence-in-depth — backend also enforces).
    if (!isSuper) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.search = '';
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  } else {
    // On the main (tenant) domain, /admin/* is hidden — even from super-admins.
    // Super-admins must use the console subdomain to reach Console.
    // (We allow them to land on /select on the main domain so they can
    //  optionally view tenant apps as themselves.)
    if (pathname.startsWith('/admin')) {
      const dest = req.nextUrl.clone();
      dest.pathname = '/select';
      dest.search = '';
      return NextResponse.redirect(dest);
    }
  }

  // Super admin (on tenant domain) bypasses tenant app checks too
  if (isSuper) return NextResponse.next();

  // Sprint 19 — Per-app role hard-gates. appAccess gives granular
  // OPERATOR/READ_ONLY levels, but the practical role-to-app mapping is
  // simpler than that:
  //
  //   POS     = till floor — Owner + Manager + Cashier only
  //   LEDGER  = back-office accounting — Owner, accounting roles, auditor
  //   PAYROLL = HR + employee self-service — anyone with a tenant
  //   PROCURE = stock — the roles that own inventory, plus the till roles
  //             who notice a shortage first and put it on the buy list
  //
  // These hard gates run BEFORE the appAccess check below so a stale
  // legacy appAccess record can't smuggle a wrong-role user past.
  // Role gates live in lib/app-roles.ts so the launcher, the in-app switcher
  // and this edge check can never disagree. They used to: /select offered
  // Counter on access level alone, and this gate threw those users straight
  // back out -- an infinite loop for any account whose only app was one it
  // was not allowed to enter.
  // Sync (/payroll) is unrestricted by role — every employee uses it for
  // self-service (clock-in, payslips, leave requests). Specific HR pages
  // are gated client-side via the layout role lists.

  if (pathname.startsWith('/pos') && !POS_ROLES.has(user.role)) {
    return NextResponse.redirect(new URL('/select?reason=pos-restricted', req.url));
  }
  if (pathname.startsWith('/procure') && !PROCURE_ROLES.has(user.role)) {
    return NextResponse.redirect(new URL('/select?reason=procure-restricted', req.url));
  }
  if (pathname.startsWith('/ledger') && !LEDGER_ROLES.has(user.role)) {
    return NextResponse.redirect(new URL('/select?reason=ledger-restricted', req.url));
  }

  // Tenant app access checks
  for (const rule of APP_RULES) {
    if (!pathname.startsWith(rule.prefix)) continue;

    const entry = user.appAccess?.find((a) => a.app === rule.app);
    const level = entry?.level ?? 'NONE';
    const userValue = levelValue(level);
    const requiredValue = levelValue(rule.minLevel);

    if (userValue < requiredValue) {
      return NextResponse.redirect(new URL('/select', req.url));
    }

    const CLOCK_ONLY_ALLOWED = ['/payroll/clock', '/payroll/payslips', '/payroll/attendance'];
    if (rule.clockOnlyRedirect && level === 'CLOCK_ONLY' && !CLOCK_ONLY_ALLOWED.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL(rule.clockOnlyRedirect, req.url));
    }

    break;
  }

  return NextResponse.next();
}

export const config = {
  // `manifest.webmanifest` and `sw.js` must stay public: the auth redirect
  // was swallowing both, so the install metadata never loaded and the service
  // worker could not be fetched (a redirected script fails registration).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
