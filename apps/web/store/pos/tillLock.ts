'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Till lock — the restroom-break state.
 *
 * Locking the till hides the terminal behind a PIN overlay WITHOUT closing
 * the shift, so a five-minute break stops costing two full drawer handovers.
 * Any staff member's PIN unlocks it: the same person resumes, or a relief
 * cashier takes over and rings under her own name while the drawer stays
 * with the shift that opened it.
 *
 * Persisted so a reload (or an Android tab discard) cannot silently bypass
 * the lock. This is a workflow convenience, not a security boundary — the
 * JWT is the boundary; the lock keeps honest hands off an unattended till.
 */
interface TillLockState {
  locked: boolean;
  /** Who locked it — shown on the overlay so relief knows whose till it is. */
  lockedByName: string | null;
  lock: (byName: string | null) => void;
  unlock: () => void;
}

export const useTillLockStore = create<TillLockState>()(
  persist(
    (set) => ({
      locked: false,
      lockedByName: null,
      lock: (byName) => set({ locked: true, lockedByName: byName }),
      unlock: () => set({ locked: false, lockedByName: null }),
    }),
    { name: 'clerque-till-lock' },
  ),
);
