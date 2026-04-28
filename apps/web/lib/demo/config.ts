/**
 * Demo Mode — Configuration & Detection
 *
 * The demo runs entirely client-side.  No backend calls are made; no DB
 * writes ever occur.  This file centralises the detection logic so every
 * other demo file (and the modified api.ts) reads from one source.
 *
 * Detection priority:
 *   1. Cookie `clerque-demo=1` (set by /demo route, readable by middleware
 *      and SSR pages so initial render matches client hydration)
 *   2. sessionStorage `clerque-demo=1` (set client-side as backup; lets
 *      demo survive a page refresh within a session)
 *
 * Both are set together at /demo entry; both must be cleared together
 * when the visitor clicks "Reset" or "Sign Up".
 */

export const DEMO_COOKIE_NAME = 'clerque-demo';
export const DEMO_SESSION_KEY = 'clerque-demo';

/** Check if the current session is in demo mode.  Safe on both server and client. */
export function isDemoMode(): boolean {
  // Server-side: only the cookie is available.
  if (typeof window === 'undefined') {
    // Next.js doesn't expose cookies here without explicit `cookies()` call;
    // server components that need this should call isDemoModeFromHeaders().
    return false;
  }

  // Client-side: check both cookie and sessionStorage.
  const cookieMatch = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${DEMO_COOKIE_NAME}=`));
  if (cookieMatch?.includes('=1')) return true;

  try {
    if (window.sessionStorage.getItem(DEMO_SESSION_KEY) === '1') return true;
  } catch {
    // sessionStorage may be unavailable (private browsing, etc.)
  }

  return false;
}

/** For server-side detection in middleware or route handlers. */
export function isDemoFromCookieHeader(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((c) => c.trim() === `${DEMO_COOKIE_NAME}=1`);
}

/** Activate demo mode in the current session. */
export function activateDemo(): void {
  if (typeof window === 'undefined') return;
  // Cookie expires in 24h; sessionStorage clears on tab close.
  const oneDay = 60 * 60 * 24;
  document.cookie = `${DEMO_COOKIE_NAME}=1; path=/; max-age=${oneDay}; SameSite=Lax`;
  try {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, '1');
  } catch {
    // ignore
  }
}

/** Deactivate demo mode and clear all stored demo state. */
export function deactivateDemo(): void {
  if (typeof window === 'undefined') return;
  document.cookie = `${DEMO_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  try {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY);
    // Also wipe the demo store's persisted state.
    window.sessionStorage.removeItem('clerque-demo-store');
    // And the demo auth flag.
    window.sessionStorage.removeItem('clerque-demo-auth');
  } catch {
    // ignore
  }
}
