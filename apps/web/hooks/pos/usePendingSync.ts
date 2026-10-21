'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { db } from '@/lib/pos/db';
import { syncPendingOrders, recoverStrandedOrders, claimUnclaimedOrders } from '@/lib/pos/sync';
import { ownsQueuedSale, queueOwnerFrom } from '@/lib/pos/pending-scope';
import { useAuthStore } from '@/store/auth';
import { useOnlineStatus } from './useOnlineStatus';

export function usePendingSync() {
  const isOnline  = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);

  // The badge counts this shop's queued sales only. On a shared tablet another
  // shop's offline sales may also be waiting; they are not this shop's to see.
  const user     = useAuthStore((s) => s.user);
  const tenantId = user?.tenantId ?? null;
  const branchId = user?.branchId ?? null;
  const userId   = user?.sub ?? null;

  const pendingCount = useLiveQuery(
    () => {
      const owner = queueOwnerFrom({ tenantId, branchId, sub: userId });
      return db.pendingOrders
        .where('status')
        .anyOf(['PENDING', 'FAILED'])
        .filter((o) => ownsQueuedSale(owner, o))
        .count();
    },
    [tenantId, branchId, userId],
    0,
  );

  // Sales queued by a build that did not record the shop: stamp them as this
  // shop's when their branch proves it, so they are matched by shop from now on.
  useEffect(() => {
    void claimUnclaimedOrders(queueOwnerFrom({ tenantId, branchId, sub: userId }));
  }, [tenantId, branchId, userId]);

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

  // Recover anything left mid-flight by a previous session. A tab closed
  // during a sync leaves rows durably SYNCING, which no query looks at —
  // those sales became invisible until this sweep put them back in the queue.
  useEffect(() => {
    void recoverStrandedOrders();
  }, []);

  // Auto-sync when connection is restored
  useEffect(() => {
    if (isOnline && pendingCount) void triggerSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  return { pendingCount: pendingCount ?? 0, isSyncing, triggerSync, isOnline };
}
