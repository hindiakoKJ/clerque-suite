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

/**
 * Map outbox `kind` → real Cloud endpoint. Returns `false` for unknown kinds
 * so the drain loop can skip and log instead of throwing.
 */
async function dispatchOutbox(kind: string, payload: unknown): Promise<boolean> {
  switch (kind) {
    case 'order.create': {
      // Payload shape: `{ order: { clientUuid, ... } }` — see api/orderSubmit.ts
      const body = payload as { order?: { clientUuid?: string } };
      const clientUuid = body?.order?.clientUuid;
      await api.post('/orders', payload, {
        headers: clientUuid ? { 'Idempotency-Key': clientUuid } : undefined,
      });
      return true;
    }
    case 'audit.supervisorElevation': {
      await api.post('/audit/elevation', payload);
      return true;
    }
    case 'inventory.adjustment': {
      await api.post('/inventory/adjustments', payload);
      return true;
    }
    default:
      // eslint-disable-next-line no-console
      console.warn(`[sync] skipping unknown outbox kind: ${kind}`);
      return false;
  }
}

/**
 * Categorize an error so the drain loop knows whether to retry, drop, or stop.
 *   - 'network'   : no HTTP response (offline / DNS) → leave in queue, stop draining
 *   - 'transient' : 5xx → leave in queue, continue with next row
 *   - 'fatal'     : 4xx → mark with last_error and stop retrying this row
 *   - 'unknown'   : non-HTTP exception → leave in queue, continue
 */
function classifyError(err: unknown): 'network' | 'transient' | 'fatal' | 'unknown' {
  if (!(err instanceof ApiHttpError)) return 'unknown';
  if (err.status === 0) return 'network';
  if (err.status >= 500) return 'transient';
  if (err.status >= 400) return 'fatal';
  return 'unknown';
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
          const handled = await dispatchOutbox(row.kind, payload);
          if (handled) {
            await deleteOutbox(row.id);
          } else {
            // Unknown kind — mark and drop from the active queue by recording
            // a fatal-style error so we don't loop forever.
            await markOutboxFailure(row.id, `unknown kind: ${row.kind}`);
          }
        } catch (err) {
          const msg =
            err instanceof ApiHttpError
              ? `${err.status} ${err.code}: ${err.message}`
              : err instanceof Error
                ? err.message
                : 'unknown';
          await markOutboxFailure(row.id, msg);
          const cls = classifyError(err);
          if (cls === 'network') break;       // stop, retry on reconnect
          // 'fatal' (4xx) stays in the queue with last_error set; the next
          // drain will retry it. UI surfaces it on the Pending Sync screen
          // so a human can investigate / delete the bad row.
          // 'transient' / 'unknown' → continue with next row.
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
