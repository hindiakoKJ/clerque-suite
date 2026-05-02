'use client';
import { useEffect, useRef, useState } from 'react';

// Ping the actual API health endpoint — navigator.onLine only tells us
// whether the device has *any* network, not whether our Railway backend
// is reachable. This matters on slow/recovering connections.
const PING_URL      = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/health`;
const PING_INTERVAL = 15_000; // re-check every 15 s
const PING_TIMEOUT  =  6_000; // treat as offline if no response in 6 s

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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const reachable = await pingApi();
      if (mounted) setIsOnline(reachable);
    };

    // Check immediately on mount
    check();

    // Periodic background check
    intervalRef.current = setInterval(check, PING_INTERVAL);

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
  }, []);

  return isOnline;
}
