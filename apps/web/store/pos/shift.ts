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
  expectedCash: number;
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
