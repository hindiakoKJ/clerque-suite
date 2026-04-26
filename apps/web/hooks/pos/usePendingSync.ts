'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { db } from '@/lib/pos/db';
import { syncPendingOrders } from '@/lib/pos/sync';
import { useOnlineStatus } from './useOnlineStatus';

export function usePendingSync() {
  const isOnline  = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);

  const pendingCount = useLiveQuery(
    () => db.pendingOrders.where('status').anyOf(['PENDING', 'FAILED']).count(),
    [],
    0,
  );

  const triggerSync = useCallback(async () => {
    if (isSyncing || !pendingCount) return;
    setIsSyncing(true);
    try {
      const { synced, failed, abandoned } = await syncPendingOrders();
      if (synced > 0) toast.success(`${synced} offline order${synced > 1 ? 's' : ''} synced`);
      if (failed > 0) toast.error(`${failed} order${failed > 1 ? 's' : ''} failed to sync — will retry`);
      if (abandoned > 0) toast.error(`${abandoned} order${abandoned > 1 ? 's' : ''} could not be synced after ${5} attempts — review in Pending Sync`);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, pendingCount]);

  // Auto-sync when connection is restored
  useEffect(() => {
    if (isOnline && pendingCount) void triggerSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  return { pendingCount: pendingCount ?? 0, isSyncing, triggerSync, isOnline };
}
