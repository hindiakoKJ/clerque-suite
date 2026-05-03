'use client';
import { useEffect, useState } from 'react';
import { jwtDecode } from 'jwt-decode';
import type { JwtPayload } from '@repo/shared-types';

/**
 * Detects when the auth state in `app-auth` localStorage was changed in
 * ANOTHER tab — typically because a different user logged in there.
 *
 * Why this exists: localStorage and cookies are shared across all tabs of
 * the same origin, so logging in as cashier@demo.com on Tab 2 overwrites
 * the admin session that's still rendered on Tab 1. The next API call in
 * Tab 1 will silently use the cashier's token. Without warning, the admin
 * doesn't know their session has been hijacked.
 *
 * The fix is detection, not prevention — the browser's same-origin model
 * doesn't allow truly isolated sessions in two tabs of the same browser.
 * For real isolation, use two browsers or two Chrome profiles.
 *
 * Returns:
 *   - hasChanged: true once the auth state was modified by another tab.
 *   - dismiss():  stop showing the banner (e.g. user clicked "OK, refresh").
 *   - originalUserId: the JWT sub that was active when this tab loaded.
 */
export function useSessionChangeDetector() {
  const [hasChanged, setHasChanged]   = useState(false);
  const [originalSub, setOriginalSub] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Capture the user id at hook-mount time so we have a stable reference.
    try {
      const raw = localStorage.getItem('app-auth');
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { accessToken?: string } };
        const token = parsed?.state?.accessToken;
        if (token) {
          const payload = jwtDecode<JwtPayload>(token);
          setOriginalSub(payload.sub ?? null);
        }
      }
    } catch {
      // Ignore parse errors — banner just won't fire if we can't read the token.
    }

    function onStorage(e: StorageEvent) {
      if (e.key !== 'app-auth') return;
      // Local writes (this tab) don't fire the storage event — only writes
      // from OTHER tabs do, which is exactly what we want.
      try {
        const next = e.newValue ? (JSON.parse(e.newValue) as { state?: { accessToken?: string } }) : null;
        const nextSub = next?.state?.accessToken
          ? jwtDecode<JwtPayload>(next.state.accessToken).sub
          : null;
        // If the token was cleared elsewhere (logout), the change matters.
        // If sub is the same, it's just a token refresh — ignore.
        if (nextSub !== originalSub) {
          setHasChanged(true);
        }
      } catch {
        // Best-effort detection — if we can't parse, conservatively flag a change.
        setHasChanged(true);
      }
    }

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [originalSub]);

  return {
    hasChanged,
    dismiss: () => setHasChanged(false),
    originalSub,
  };
}
