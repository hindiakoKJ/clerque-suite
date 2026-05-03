'use client';

/**
 * Parked sales — local to a single terminal.
 *
 * Why localStorage and not the backend:
 *   - Parked sales are inherently terminal-local (a paused customer comes
 *     back to the SAME register, not a different one). Network-syncing them
 *     would create cross-terminal recall ambiguity.
 *   - Zero round-trip cost. Park + recall must feel instantaneous.
 *   - Survives browser refresh, but a tenant-scoped clear on logout
 *     prevents leakage between cashier shifts on a shared device.
 *
 * Auto-expiry: 24h. Older parked sales are filtered out on every read so
 * they never accumulate as junk in localStorage.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CartLine, CartDiscount, AdditionalPwdScEntry } from '@/store/pos/cart';

const PARK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ParkedSale {
  id: string;
  name: string;        // user-supplied label or auto "Park #N"
  parkedAt: number;    // epoch ms
  branchId: string | null;
  shiftId: string | null;
  lines: CartLine[];
  orderDiscount: CartDiscount | null;
  /**
   * Additional PWD/SC entries (2nd-5th in a shared meal). Persisted across
   * park/recall so a paused multi-PWD order doesn't lose the extra IDs.
   * Optional for backward-compat with parked sales saved before this field
   * was added.
   */
  additionalPwdScEntries?: AdditionalPwdScEntry[];
  totalAmount: number; // cached for the recall list (no need to recompute)
  itemCount: number;
}

interface ParkedSalesState {
  sales: ParkedSale[];
  add: (sale: Omit<ParkedSale, 'id' | 'parkedAt'>) => string;
  remove: (id: string) => void;
  /** Drop expired entries; called automatically on every read. */
  prune: () => void;
  /** Total still-valid (un-expired) parked sales. */
  validCount: () => number;
}

export const useParkedSalesStore = create<ParkedSalesState>()(
  persist(
    (set, get) => ({
      sales: [],

      add: (sale) => {
        const id = `park-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((state) => ({
          sales: [...state.sales, { ...sale, id, parkedAt: Date.now() }],
        }));
        return id;
      },

      remove: (id) => {
        set((state) => ({ sales: state.sales.filter((s) => s.id !== id) }));
      },

      prune: () => {
        const cutoff = Date.now() - PARK_TTL_MS;
        const before = get().sales;
        const after = before.filter((s) => s.parkedAt > cutoff);
        if (after.length !== before.length) {
          set({ sales: after });
        }
      },

      validCount: () => {
        get().prune();
        return get().sales.length;
      },
    }),
    {
      name: 'clerque-parked-sales',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
