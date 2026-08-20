import { db } from './db';
import { api } from '@/lib/api';

const MAX_RETRIES = 5;

interface SyncResult {
  clientUuid: string;
  orderId?: string;
  error?: string;
  errorCode?: string;
  ok?: boolean;
}

/** Actual body of POST /orders/sync (OrdersService.bulkSync). */
interface BulkSyncResponse {
  results: SyncResult[];
  firstFailureIndex: number | null;
  successCount: number;
  failureCount: number;
}

/**
 * Return rows stranded in SYNCING to PENDING so they are retried.
 *
 * The status flips to SYNCING *before* the network call, so a tab close,
 * refresh, crash, or device sleep mid-POST leaves the row durably SYNCING —
 * and nothing else ever queries that state (the outbox drain, the pending
 * badge and the "Sync Now" button all filter PENDING/FAILED). Those sales
 * became invisible and were never retried. Sweeping on every drain (and at
 * POS boot) makes the interruption recoverable; replay is safe because the
 * server dedups on clientUuid.
 */
export async function recoverStrandedOrders(): Promise<number> {
  return db.pendingOrders.where('status').equals('SYNCING').modify({ status: 'PENDING' });
}

export async function syncPendingOrders(): Promise<{ synced: number; failed: number; abandoned: number }> {
  await recoverStrandedOrders();

  const all = await db.pendingOrders
    .where('status')
    .anyOf(['PENDING', 'FAILED'])
    .toArray();

  // Permanently abandon orders that have exceeded the retry cap
  const overLimit = all.filter((o) => o.retries >= MAX_RETRIES);
  for (const o of overLimit) {
    await db.pendingOrders.update(o.id!, { status: 'FAILED', lastError: `Abandoned after ${MAX_RETRIES} retries: ${o.lastError ?? 'unknown error'}` });
  }
  const abandoned = overLimit.length;

  const pending = all.filter((o) => o.retries < MAX_RETRIES);

  if (pending.length === 0) return { synced: 0, failed: 0, abandoned };

  let synced = 0;
  let failed = 0;
  const BATCH = 10;

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch   = pending.slice(i, i + BATCH);
    const ids     = batch.map((o) => o.id!);
    const payloads = batch.map((o) => o.payload);

    await db.pendingOrders.where('id').anyOf(ids).modify({ status: 'SYNCING' });

    try {
      // The endpoint returns { results, firstFailureIndex, successCount,
      // failureCount } — NOT a bare array. Iterating the envelope threw
      // "data is not iterable" on every reconnect, so orders the server had
      // already created were never cleared from the outbox and were marked
      // permanently FAILED after MAX_RETRIES.
      const { data } = await api.post<BulkSyncResponse>('/orders/sync', { orders: payloads });
      const results = data?.results ?? [];

      const answered = new Set<string>();

      for (const result of results) {
        const order = batch.find(
          (o) => (o.payload as { clientUuid: string }).clientUuid === result.clientUuid,
        );
        if (!order?.id) continue;
        answered.add(result.clientUuid);

        if (result.orderId && !result.error) {
          await db.pendingOrders.delete(order.id);
          synced++;
        } else {
          // A definitive business rejection (closed accounting period, stale
          // branch, validation) will never succeed by retrying, so it must
          // not burn the retry budget and silently become "abandoned" —
          // that is how a real sale stops being visible as needing action.
          // Park it at the cap with the server's reason so it stays on the
          // Pending Sync page for the owner to resolve.
          await db.pendingOrders.update(order.id, {
            status: 'FAILED',
            retries: MAX_RETRIES,
            lastError: `Needs attention — ${result.error ?? 'server rejected this order'}`,
          });
          failed++;
        }
      }

      // Anything the server did not report on must not be left in SYNCING —
      // that state is invisible to every later drain. Put it back in the
      // queue so the next attempt picks it up.
      const unanswered = batch.filter(
        (o) => !answered.has((o.payload as { clientUuid: string }).clientUuid),
      );
      for (const o of unanswered) {
        await db.pendingOrders.update(o.id!, {
          status: 'PENDING',
          retries: o.retries + 1,
          lastError: 'No result returned for this order',
        });
        failed++;
      }

      // NOTE: station (kitchen/bar) tickets are deliberately NOT dispatched
      // here. The KDS screens poll the API, so they are down for the same
      // outage the sale was rung through — staff worked those items off the
      // printed offline receipt at the counter. Firing tickets at sync time
      // would print drinks that were served an hour ago.
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      await db.pendingOrders.where('id').anyOf(ids).modify((o) => {
        o.status  = 'PENDING';
        o.retries += 1;
        o.lastError = message;
      });
      failed += batch.length;
    }
  }

  return { synced, failed, abandoned };
}
