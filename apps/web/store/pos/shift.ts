'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ActiveShift {
  id: string;
  branchId: string;
  cashierId: string;
  openingCash: number;
  openedAt: string;
  cashSales: number;
  nonCashSales: number;
  totalSales: number;
  orderCount: number;
  voidCount: number;
  /*
    What left the drawer other than change. Optional because an older API
    build does not send them, and a missing field must read as zero rather
    than blanking the close screen.
  */
  /** Cash handed back to customers during this shift. */
  refundTotal?: number;
  /** Real expenses paid out of the till. */
  paidOutTotal?: number;
  /** Mid-shift moves to the safe. */
  cashDropTotal?: number;
  /**
   * Cash rung at this branch during the shift that belongs to no shift —
   * almost always a supervisor, who bypasses the shift gate. Shown, not
   * subtracted: it explains an overage without making the cashier
   * accountable for someone else's sales.
   */
  unattributedCashSales?: number;
  expectedCash: number;
  /** Per-method totals for digital payment reconciliation */
  digitalBreakdown: Record<string, number>;
}

interface ShiftState {
  activeShift: ActiveShift | null;
  setActiveShift: (shift: ActiveShift) => void;
  clearShift: () => void;
}

export const useShiftStore = create<ShiftState>()(
  persist(
    (set) => ({
      activeShift: null,
      setActiveShift: (shift) => set({ activeShift: shift }),
      clearShift: () => set({ activeShift: null }),
    }),
    { name: 'pos-shift' },
  ),
);
