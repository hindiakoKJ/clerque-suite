'use client';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useShiftStore } from '@/store/pos/shift';
import { fetchActiveShift, openShift, getShiftSummary } from '@/lib/pos/shifts';
import { OpenShiftModal } from './OpenShiftModal';
import { db } from '@/lib/pos/db';

interface ShiftGateProps {
  children: React.ReactNode;
}

export function ShiftGate({ children }: ShiftGateProps) {
  const user = useAuthStore((s) => s.user);
  const { activeShift, setActiveShift } = useShiftStore();
  const [checking, setChecking] = useState(true);

  const branchId = activeShift?.branchId ?? user?.branchId ?? '';

  useEffect(() => {
    if (!user?.branchId) {
      // Even without a branchId, clear any stale shift that might be in the store
      // from a previous session — prevents bypassing the gate for admin users.
      useShiftStore.getState().clearShift();
      setChecking(false);
      return;
    }

    async function validate() {
      try {
        if (activeShift) {
          // Refresh summary from API (may have changed since last page load)
          const fresh = await getShiftSummary(activeShift.id);
          if (!fresh || (fresh as unknown as { closedAt?: string }).closedAt) {
            // Shift was closed externally — clear store + Dexie cache
            useShiftStore.getState().clearShift();
            await db.activeShift.clear();
          } else {
            // ── Stale-shift guard: shifts must not span calendar days (PH timezone) ──
            // A shift opened on a previous day is considered stale — clear it locally
            // so the cashier is prompted to open a fresh one. The server will auto-close
            // the stale shift when POST /shifts is called next (see shifts.service.ts).
            const today    = new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });
            const shiftDay = new Date(fresh.openedAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });
            if (shiftDay !== today) {
              useShiftStore.getState().clearShift();
              await db.activeShift.clear();
            } else {
              setActiveShift(fresh);
              // Refresh Dexie cache
              await db.activeShift.put({
                id: fresh.id,
                branchId: fresh.branchId,
                cashierId: fresh.cashierId,
                openingCash: fresh.openingCash,
                openedAt: fresh.openedAt,
                cachedAt: Date.now(),
              });
            }
          }
        } else {
          // 1. Try API
          const existing = await fetchActiveShift(user!.branchId!);
          if (existing) {
            setActiveShift(existing);
            await db.activeShift.put({
              id: existing.id,
              branchId: existing.branchId,
              cashierId: existing.cashierId,
              openingCash: existing.openingCash,
              openedAt: existing.openedAt,
              cachedAt: Date.now(),
            });
          }
          // If no shift found, fall through to show OpenShiftModal
        }
      } catch {
        // Offline or network error — try Dexie cache
        if (!activeShift) {
          try {
            const cached = await db.activeShift
              .where('branchId')
              .equals(user!.branchId!)
              .first();
            if (cached) {
              // Reconstruct minimal ActiveShift from cache so cashier can continue
              setActiveShift({
                id: cached.id,
                branchId: cached.branchId,
                cashierId: cached.cashierId,
                openingCash: cached.openingCash,
                openedAt: cached.openedAt,
                cashSales: 0,
                nonCashSales: 0,
                totalSales: 0,
                orderCount: 0,
                voidCount: 0,
                expectedCash: cached.openingCash,
                digitalBreakdown: {},
              });
            }
          } catch {
            // IndexedDB unavailable — let gate show OpenShiftModal
          }
        }
      } finally {
        setChecking(false);
      }
    }

    validate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sub]);

  async function handleOpenShift(openingCash: number, notes?: string) {
    const shift = await openShift(branchId, openingCash, notes);
    const withSummary = await getShiftSummary(shift.id);
    setActiveShift(withSummary);
    // Cache in Dexie
    try {
      await db.activeShift.put({
        id: withSummary.id,
        branchId: withSummary.branchId,
        cashierId: withSummary.cashierId,
        openingCash: withSummary.openingCash,
        openedAt: withSummary.openedAt,
        cachedAt: Date.now(),
      });
    } catch { /* non-critical */ }
  }

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading shift…
      </div>
    );
  }

  if (!activeShift) {
    return (
      <OpenShiftModal
        cashierName={user?.name || user?.sub || 'Cashier'}
        onOpen={handleOpenShift}
      />
    );
  }

  return <>{children}</>;
}
