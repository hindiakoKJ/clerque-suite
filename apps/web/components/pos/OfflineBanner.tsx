'use client';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/pos/useOnlineStatus';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="bg-amber-500 text-white text-xs font-medium px-4 py-1.5 flex items-center gap-2 shrink-0"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span>
        You&apos;re offline — orders are saved locally and will sync automatically when you reconnect.
      </span>
    </div>
  );
}
