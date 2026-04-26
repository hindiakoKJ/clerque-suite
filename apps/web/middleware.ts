import { NextResponse, type NextRequest } from 'next/server';
import { jwtDecode } from 'jwt-decode';
import type { JwtPayload } from '@repo/shared-types';
import { levelValue } from '@repo/shared-types';

/* ─── Route → required access ────────────────────────────────────────────── */
const APP_RULES: Array<{
  prefix: string;
  app: 'POS' | 'LEDGER' | 'PAYROLL';
  minLevel: Parameters<typeof levelValue>[0];
  clockOnlyRedirect?: string; // redirect clock-only users here instead of /select
}> = [
  { prefix: '/pos',     app: 'POS',     minLevel: 'OPERATOR' },
  { prefix: '/ledger',  app: 'LEDGER',  minLevel: 'READ_ONLY' },
  { prefix: '/payroll', app: 'PAYROLL', minLevel: 'CLOCK_ONLY', clockOnlyRedirect: '/payroll/clock' },
];

const PUBLIC_PATHS = ['/', '/login', '/select'];

function getToken(req: NextRequest): string | null {
  // Tokens live in Zustand's persisted localStorage key `app-auth`.
  // Middleware runs on the edge and cannot read localStorage, so we use
  // a lightweight cookie mirror: on login, the client sets a `app-session`
  // cookie containing just the access token (httpOnly=false so JS can set it).
  return req.cookies.get('app-session')?.value ?? null;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow public paths and Next.js internals
  if (PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith('/_next') || pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const token = getToken(req);

  // Not authenticated → redirect to login, preserving intended destination
  if (!token) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Decode token (no verification — API handles that; middleware just checks access)
  let user: JwtPayload;
  try {
    user = jwtDecode<JwtPayload>(token);
  } catch {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // Super admin bypasses all app checks
  if (user.isSuperAdmin) return NextResponse.next();

  // Check app-specific access rules
  for (const rule of APP_RULES) {
    if (!pathname.startsWith(rule.prefix)) continue;

    const entry = user.appAccess?.find((a) => a.app === rule.app);
    const level = entry?.level ?? 'NONE';
    const userValue = levelValue(level);
    const requiredValue = levelValue(rule.minLevel);

    if (userValue < requiredValue) {
      // No access at all → app selector
      return NextResponse.redirect(new URL('/select', req.url));
    }

    // CLOCK_ONLY users in payroll: only allow clock, payslips, and attendance pages
    const CLOCK_ONLY_ALLOWED = ['/payroll/clock', '/payroll/payslips', '/payroll/attendance'];
    if (rule.clockOnlyRedirect && level === 'CLOCK_ONLY' && !CLOCK_ONLY_ALLOWED.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL(rule.clockOnlyRedirect, req.url));
    }

    break;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
