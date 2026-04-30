'use client';
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

/**
 * Live clock + date for the cashier sidebar. Updates every second.
 * Renders in PH locale (Asia/Manila), 12-hour with AM/PM, and a friendly
 * "Mon, Apr 30" date underneath. Designed to fit a 224px-wide sidebar
 * (the AppShell expanded width).
 */
export function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null);

  // Initialize on mount + tick every second. Setting state to null on the
  // server prevents an SSR / client hydration mismatch (the time is always
  // different between render and hydrate).
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    // Server-render placeholder — same height as the live widget so layout
    // doesn't shift on hydration.
    return <div className="h-[68px]" />;
  }

  const time = now.toLocaleTimeString('en-PH', {
    hour:   'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  });
  const date = now.toLocaleDateString('en-PH', {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    timeZone: 'Asia/Manila',
  });

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Clock className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          PH Time
        </span>
      </div>
      <div className="text-[15px] font-bold text-foreground tabular-nums leading-tight">
        {time}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">
        {date}
      </div>
    </div>
  );
}
