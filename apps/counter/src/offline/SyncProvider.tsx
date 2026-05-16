/**
 * Clerque Counter — SyncProvider
 * Tracks network connectivity and the outbox queue depth, and drains the
 * queue against the Cloud API. Consumers (TopBar pill, OfflineBanner, drawer
 * badge) read `useSync()` for the live status.
 *
 * Drain triggers:
 *   • Reconnect — when NetInfo flips to online.
 *   • Foreground timer — every 30s while the app is in foreground.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

import { api, ApiHttpError } from '@/api/client';
import {
  countOutbox,
  deleteOutbox,
  enqueueOutbox,
  listOutbox,
  markOutboxFailure,
} from '@/offline/db';
import type { SyncState } from '@/types';

interface SyncContextValue {
  state: SyncState;
  queuedCount: number;
  lastSyncAt: number | null;
  enqueue: (kind: string, payload: unknown) => Promise<void>;
  drainQueue: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}

/** Map outbox `kind` → API call. Extended as verticals add new mutations. */
async function dispatchOutbox(kind: string, payload: unknown): Promise<void> {
  // For now we POST every kind to `/sync/{kind}`; the Cloud API routes it.
  // Terminal/payment/receipt teams own the per-kind dispatcher contract.
  await api.post(`/sync/${encodeURIComponent(kind)}`, payload);
}

export function SyncProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [online, setOnline] = useState(true);
  const [draining, setDraining] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  // Ref guard prevents overlapping drains.
  const drainingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    try {
      const c = await countOutbox();
      setQueuedCount(c);
    } catch {
      // db not ready yet; ignore
    }
  }, []);

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setDraining(true);
    try {
      const rows = await listOutbox(50);
      for (const row of rows) {
        try {
          // payload_json was JSON-stringified on enqueue.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const payload: any = JSON.parse(row.payload_json);
          await dispatchOutbox(row.kind, payload);
          await deleteOutbox(row.id);
        } catch (err) {
          const msg =
            err instanceof ApiHttpError
              ? `${err.status} ${err.code}: ${err.message}`
              : err instanceof Error
                ? err.message
                : 'unknown';
          await markOutboxFailure(row.id, msg);
          // If it's a network error, stop draining — try again on reconnect.
          if (err instanceof ApiHttpError && err.status === 0) break;
        }
      }
      setLastSyncAt(Date.now());
    } finally {
      await refreshCount();
      drainingRef.current = false;
      setDraining(false);
    }
  }, [refreshCount]);

  const enqueue = useCallback(
    async (kind: string, payload: unknown) => {
      await enqueueOutbox(kind, payload);
      await refreshCount();
      // Fire-and-forget drain attempt if we're online.
      if (online) drainQueue().catch(() => {});
    },
    [online, drainQueue, refreshCount],
  );

  // NetInfo subscription.
  useEffect(() => {
    const handle = (s: NetInfoState) => {
      const isOnline = Boolean(s.isConnected && s.isInternetReachable !== false);
      setOnline((prev) => {
        if (!prev && isOnline) {
          // Transition offline → online; drain.
          drainQueue().catch(() => {});
        }
        return isOnline;
      });
    };
    const unsubscribe = NetInfo.addEventListener(handle);
    NetInfo.fetch().then(handle).catch(() => {});
    return () => unsubscribe();
  }, [drainQueue]);

  // 30s foreground timer.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (online) drainQueue().catch(() => {});
        refreshCount().catch(() => {});
      }, 30_000);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onAppState = (s: AppStateStatus) => {
      if (s === 'active') start();
      else stop();
    };
    start();
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      stop();
      sub.remove();
    };
  }, [online, drainQueue, refreshCount]);

  // Initial count load.
  useEffect(() => {
    refreshCount().catch(() => {});
  }, [refreshCount]);

  const state: SyncState = draining ? 'syncing' : online ? 'online' : 'offline';

  const value = useMemo<SyncContextValue>(
    () => ({ state, queuedCount, lastSyncAt, enqueue, drainQueue }),
    [state, queuedCount, lastSyncAt, enqueue, drainQueue],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
