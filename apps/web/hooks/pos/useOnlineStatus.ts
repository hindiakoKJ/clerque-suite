'use client';
import { useEffect, useRef, useState } from 'react';

// Ping the actual API health endpoint — navigator.onLine only tells us
// whether the device has *any* network, not whether our Railway backend
// is reachable. This matters on slow/recovering connections.
const PING_URL          = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/health`;
const PING_INTERVAL     = 15_000; // re-check every 15 s when online
const RECOVERY_INTERVAL =  5_000; // try every 5 s while in offline state
const PING_TIMEOUT      = 12_000; // give Railway up to 12 s (cold-starts)
// Don't flip to offline on a single failed ping — flaky PH internet causes
// transient single-ping failures all the time. Require N consecutive failures.
const FAILURES_BEFORE_OFFLINE = 2;

async function pingApi(): Promise<boolean> {
  // Hard offline (no NIC / airplane mode) — skip the fetch entirely
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const res = await fetch(PING_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    // Optimistic initial value — confirmed by the first ping below
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const intervalRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFails  = useRef(0);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const reachable = await pingApi();
      if (!mounted) return;
      if (reachable) {
        // First success after any failures resets the counter and flips us
        // back online immediately.
        consecutiveFails.current = 0;
        setIsOnline(true);
      } else {
        consecutiveFails.current += 1;
        // Tolerate single transient failures — only flip offline after
        // N-in-a-row. PH internet is genuinely flaky and a single packet
        // loss shouldn't dump every order to the IndexedDB queue.
        if (consecutiveFails.current >= FAILURES_BEFORE_OFFLINE) {
          setIsOnline(false);
        }
      }
    };

    // Adaptive interval: ping more aggressively while offline so we recover
    // fast, ping calmly while online so we don't spam Railway.
    const scheduleNextCheck = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const delay = isOnline ? PING_INTERVAL : RECOVERY_INTERVAL;
      intervalRef.current = setInterval(check, delay);
    };

    // Check immediately on mount
    check();
    scheduleNextCheck();

    // Browser events for fast detection — but still confirm via API ping
    // (browser fires "online" when any adapter reconnects, not when our API is up)
    const onBrowserOnline  = () => check();
    const onBrowserOffline = () => { if (mounted) setIsOnline(false); };

    window.addEventListener('online',  onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);

    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('online',  onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
    };
  }, [isOnline]);

  return isOnline;
}
