'use client';

import { useEffect } from 'react';

/**
 * Registers the offline service worker (public/sw.js).
 *
 * Production only: in development the worker would cache dev-server assets
 * and shadow hot reloads, which is a debugging trap for no benefit — offline
 * resilience matters on a real till, not on a laptop running `next dev`.
 *
 * To disable in an emergency set NEXT_PUBLIC_DISABLE_SW=1 and redeploy; the
 * component then actively unregisters any worker already installed on the
 * device, so a bad worker can be cleared remotely instead of needing someone
 * to clear site data on the tablet.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const disabled =
      process.env.NEXT_PUBLIC_DISABLE_SW === '1' || process.env.NODE_ENV !== 'production';

    if (disabled) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => undefined);
      return;
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    };

    // Registering after load keeps the worker off the critical path of the
    // first paint on a cold tablet.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
