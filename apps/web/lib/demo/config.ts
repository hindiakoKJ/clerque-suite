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

/** Check if the current session is in demo mode.  Safe on both server and client.
 *
 * IMPORTANT: demo mode is determined by URL pathname FIRST.  The cookie /
 * sessionStorage flags are secondary — they only enable demo behavior when
 * the user is actually on a /demo/* route.  This prevents the demo banner
 * (and any other demo-conditional UI) from leaking into real Clerque pages
 * when a user previously visited /demo and still has the cookie set.
 */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;

  // Pathname is the authoritative signal.  If we're not on a /demo route,
  // we are NOT in demo mode regardless of any stored flags.
  if (!window.location.pathname.startsWith('/demo')) {
    return false;
  }

  // On a /demo route — confirm via cookie / sessionStorage that demo was
  // actually activated (not just someone hitting /demo cold).  The /demo
  // welcome page is the only thing that calls activateDemo().
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

  // On /demo path but no flags set yet — we're on the welcome page itself
  // (or a stale URL).  Treat as demo so the banner is visible there too.
  return true;
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
