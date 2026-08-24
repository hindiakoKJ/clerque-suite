'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Kiosk mode for unattended display tablets (customer display, KDS).
 *
 * Three things a shop tablet needs that a browser tab does not give:
 *
 *   1. FULLSCREEN. A QR-paired display opens in a normal Chrome tab, URL bar
 *      and all — which looks unfinished to the customer and, worse, leaves
 *      the address bar one curious tap away. The Fullscreen API hides all
 *      browser chrome, but browsers only grant it from a user gesture, so we
 *      expose `enter()` for a tap target and re-offer whenever fullscreen is
 *      lost (Android drops it when the tablet sleeps or the home button is
 *      pressed).
 *
 *   2. WAKE LOCK. An idle tablet dims and sleeps mid-service. The Screen Wake
 *      Lock API keeps it lit; the lock is silently released by the OS every
 *      time the page is hidden, so it is re-acquired on visibilitychange
 *      rather than requested once and forgotten.
 *
 *   3. NO ACCIDENTAL MOVEMENT. Pinch-zoom, pull-to-refresh, long-press text
 *      selection — all of them let a stray customer finger scroll or shift a
 *      screen that should behave like an appliance. Fixed here with runtime
 *      style + listeners rather than component CSS, so one hook covers the
 *      whole surface, including anything portalled outside the layout.
 *
 * What no web page can do: block the Android home/back buttons. For a truly
 * locked device the owner pins the app (Settings → Security → App pinning) —
 * the UI surfaces that hint, since "fixed and not movable" is ultimately an
 * OS decision.
 */
export function useKioskMode(opts: { lockTouch?: boolean; blockPullToRefresh?: boolean } = {}) {
  const lockTouch = opts.lockTouch ?? true;
  const blockPullToRefresh = opts.blockPullToRefresh ?? true;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  // ── Fullscreen state tracking ─────────────────────────────────────────
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    setIsSupported(!!(el.requestFullscreen || el.webkitRequestFullscreen));

    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // ── Wake lock, re-acquired every time the page becomes visible ───────
  const acquireWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      if (!nav.wakeLock) return;
      wakeLockRef.current = await nav.wakeLock.request('screen');
    } catch {
      // Battery saver or unsupported — nothing to do; the OS wins this one.
    }
  }, []);

  useEffect(() => {
    void acquireWakeLock();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [acquireWakeLock]);

  // ── Pull-to-refresh block — safe everywhere, wanted on tills too ─────
  useEffect(() => {
    if (!blockPullToRefresh || typeof document === 'undefined') return;
    const html = document.documentElement.style;
    const prevHtml = html.overscrollBehavior;
    html.overscrollBehavior = 'none';        // kills pull-to-refresh chaining
    return () => { html.overscrollBehavior = prevHtml; };
  }, [blockPullToRefresh]);

  // ── Pin the surface: no zoom, no selection (display appliances only) ──
  useEffect(() => {
    if (!lockTouch || typeof document === 'undefined') return;

    const html = document.documentElement.style;
    const body = document.body.style;
    const prev = {
      htmlOverscroll: html.overscrollBehavior,
      bodyOverscroll: body.overscrollBehavior,
      touchAction: body.touchAction,
      userSelect: body.userSelect,
    };
    html.overscrollBehavior = 'none';
    body.overscrollBehavior = 'none';
    body.touchAction = 'pan-x pan-y';        // scroll ok, pinch + double-tap zoom not
    body.userSelect = 'none';                // no long-press text selection

    // iOS Safari ignores user-scalable=no; it needs the gesture events killed.
    // Double-tap zoom needs NO handler: `touch-action: pan-x pan-y` disables
    // it (only 'auto'/'manipulation' keep it). An earlier draft preventDefault-
    // ed any touchend within 300ms of the last one — which would have eaten
    // every second tap from a cashier ringing items fast. Never do that on a
    // surface with buttons.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    const onContext = (e: Event) => e.preventDefault();  // long-press menu
    document.addEventListener('contextmenu', onContext);

    return () => {
      html.overscrollBehavior = prev.htmlOverscroll;
      body.overscrollBehavior = prev.bodyOverscroll;
      body.touchAction = prev.touchAction;
      body.userSelect = prev.userSelect;
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('contextmenu', onContext);
    };
  }, [lockTouch]);

  /** Enter fullscreen. Must be called from a user gesture (tap/click). */
  const enter = useCallback(async () => {
    try {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      void acquireWakeLock();   // same gesture doubles as the wake-lock grant
    } catch {
      // Denied (e.g. iframe without allowfullscreen) — the banner stays up.
    }
  }, [acquireWakeLock]);

  const exit = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* already out */ }
  }, []);

  return { isFullscreen, isSupported, enter, exit };
}
