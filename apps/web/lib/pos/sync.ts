import { db } from './db';
import { api } from '@/lib/api';

interface SyncResult {
  clientUuid: string;
  orderId?: string;
  error?: string;
}

export async function syncPendingOrders(): Promise<{ synced: number; failed: number }> {
  const pending = await db.pendingOrders
    .where('status')
    .anyOf(['PENDING', 'FAILED'])
    .toArray();

  if (pending.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const BATCH = 10;

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch   = pending.slice(i, i + BATCH);
    const ids     = batch.map((o) => o.id!);
    const payloads = batch.map((o) => o.payload);

    await db.pendingOrders.where('id').anyOf(ids).modify({ status: 'SYNCING' });

    try {
      const { data }: { data: SyncResult[] } = await api.post('/orders/sync', { orders: payloads });

      for (const result of data) {
        const order = batch.find(
          (o) => (o.payload as { clientUuid: string }).clientUuid === result.clientUuid,
        );
        if (!order?.id) continue;

        if (result.orderId && !result.error) {
          await db.pendingOrders.delete(order.id);
          synced++;
        } else {
          await db.pendingOrders.update(order.id, {
            status: 'FAILED',
            retries: order.retries + 1,
            lastError: result.error ?? 'Server rejected order',
          });
          failed++;
        }
      }
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

  return { synced, failed };
}
