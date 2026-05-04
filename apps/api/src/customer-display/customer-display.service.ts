import { Injectable } from '@nestjs/common';

/**
 * In-memory cart-snapshot store for customer-facing displays.
 *
 * Purpose: when the cashier and customer screens are on different devices
 * (two tablets, or different Chrome profiles on one device), BroadcastChannel
 * can't reach across the boundary — we need a server-mediated relay.
 *
 * Design:
 *   - Cashier publishes a snapshot to POST /customer-display/state.
 *   - Customer screen polls GET /customer-display/state every 1s.
 *   - State is keyed by `cashierId` (or `terminalCode` for multi-cashier
 *     scenarios where multiple staff share a terminal).
 *   - In-memory only. No persistence — the cart is ephemeral by definition.
 *     Restart wipes everything; clients reconcile via a fresh GET.
 *   - 60s TTL — stale snapshots auto-expire so a forgotten customer-display
 *     window doesn't keep showing yesterday's order.
 *   - Bounded — caps at 1000 active sessions per server (no realistic risk
 *     for our scale, but defensive).
 *
 * Tenant isolation: each entry stores tenantId; reads filter on it.
 */

export interface CartSnapshot {
  type:      'WELCOME' | 'CART_UPDATE' | 'PAYMENT_PENDING' | 'PAYMENT_COMPLETE' | 'CLEAR';
  lines: Array<{
    productName: string;
    quantity:    number;
    unitPrice:   number;
    lineTotal:   number;
    modifiers?:  string[];
  }>;
  subtotal:        number;
  discount:        number;
  vatAmount:       number;
  total:           number;
  amountTendered?: number;
  changeDue?:      number;
  cashierName?:    string;
  branchName?:     string;
  businessName?:   string;
}

interface StoredSnapshot extends CartSnapshot {
  tenantId:  string;
  cashierId: string;
  /** Monotonic per-key sequence — receivers ignore older messages. */
  seq:       number;
  /** Server-assigned timestamp; used for TTL expiry. */
  storedAt:  number;
}

const TTL_MS = 60_000;
const MAX_SESSIONS = 1000;

@Injectable()
export class CustomerDisplayService {
  /**
   * Map key = `${tenantId}:${cashierId}` so snapshots are tenant-isolated
   * AND multi-cashier-friendly within the same tenant.
   */
  private store = new Map<string, StoredSnapshot>();
  private seqCounter = 0;

  private key(tenantId: string, cashierId: string): string {
    return `${tenantId}:${cashierId}`;
  }

  /** Publish a fresh snapshot — overwrites any prior state for this cashier. */
  publish(tenantId: string, cashierId: string, snapshot: CartSnapshot): { seq: number; storedAt: number } {
    this.evictExpired();
    if (this.store.size >= MAX_SESSIONS) {
      // Drop oldest to make room. Realistic bound never reached at our scale.
      const oldestKey = [...this.store.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0]?.[0];
      if (oldestKey) this.store.delete(oldestKey);
    }
    const stored: StoredSnapshot = {
      ...snapshot,
      tenantId,
      cashierId,
      seq:      ++this.seqCounter,
      storedAt: Date.now(),
    };
    this.store.set(this.key(tenantId, cashierId), stored);
    return { seq: stored.seq, storedAt: stored.storedAt };
  }

  /**
   * Read the current snapshot for this tenant+cashier.
   * Returns `null` when no active snapshot exists (customer screen shows
   * its WELCOME state in that case).
   */
  read(tenantId: string, cashierId: string): StoredSnapshot | null {
    this.evictExpired();
    const stored = this.store.get(this.key(tenantId, cashierId));
    if (!stored) return null;
    // Tenant isolation re-check (defensive — keys already encode tenantId)
    if (stored.tenantId !== tenantId) return null;
    return stored;
  }

  /** Clear a cashier's snapshot — called on shift close / explicit clear. */
  clear(tenantId: string, cashierId: string): void {
    this.store.delete(this.key(tenantId, cashierId));
  }

  /** Drop entries older than TTL. Cheap to call on every read/write. */
  private evictExpired(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [k, v] of this.store) {
      if (v.storedAt < cutoff) this.store.delete(k);
    }
  }
}
