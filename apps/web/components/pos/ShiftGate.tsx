'use client';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useShiftStore } from '@/store/pos/shift';
import { fetchActiveShift, openShift, getShiftSummary } from '@/lib/pos/shifts';
import { OpenShiftModal } from './OpenShiftModal';
import { db } from '@/lib/pos/db';
import { useFloorLayout } from '@/hooks/useFloorLayout';

/** Roles that supervise the POS but do not operate the register. */
const SUPERVISOR_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SUPER_ADMIN', 'FINANCE_LEAD',
                          'MDM', 'WAREHOUSE_STAFF', 'BOOKKEEPER', 'ACCOUNTANT',
                          'PAYROLL_MASTER', 'EXTERNAL_AUDITOR'] as const;

interface ShiftGateProps {
  children: React.ReactNode;
}

export function ShiftGate({ children }: ShiftGateProps) {
  const user = useAuthStore((s) => s.user);
  const { activeShift, setActiveShift } = useShiftStore();
  const { terminals } = useFloorLayout();
  const [checking, setChecking] = useState(true);

  // Supervisors bypass the shift gate entirely — they are not cashiers.
  // They can view all POS pages (orders, dashboard, reports) without opening a shift.
  const isSupervisor = SUPERVISOR_ROLES.includes(user?.role as typeof SUPERVISOR_ROLES[number]);

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

  async function handleOpenShift(openingCash: number, notes?: string, terminalId?: string) {
    const shift = await openShift(branchId, openingCash, notes, terminalId);
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
        Loading…
      </div>
    );
  }

  // User was just cleared (logout in progress) — the layout will redirect to /login.
  // Return null to avoid flashing the OpenShiftModal for a single render frame.
  if (!user) return null;

  // Supervisors: bypass shift gate — render children directly.
  // (The role label in the sidebar header — "Counter · Admin" — already
  // signals the supervisor context, no banner needed.)
  if (isSupervisor) {
    return <>{children}</>;
  }

  /*
    A cashier with no branch cannot open a shift: branchId is '' and
    openShift('') always fails. The modal has no cancel and no sign-out, so
    the account was simply locked out of the app -- the barista signs in at
    6am and gets a dialog that can never be satisfied.

    It happens easily: the Branch field on the staff form offers "— None —"
    first, is not marked required, and nothing validates it, so in a
    single-branch shop it reads as optional. Say what is wrong and give them a
    way out instead of a dialog that cannot be dismissed.
  */
  if (!user?.branchId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center">
          <h1 className="text-base font-semibold">This account has no branch</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            A till has to belong to a branch before a shift can be opened. Ask the owner to open
            <strong className="text-foreground"> Staff</strong>, edit your account and set its
            branch — then sign in again.
          </p>
          <button
            onClick={() => {
              useAuthStore.getState().clear();
              document.cookie = 'app-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
              window.location.href = '/login';
            }}
            className="mt-4 inline-flex min-h-[2.5rem] items-center rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (!activeShift) {
    return (
      <OpenShiftModal
        cashierName={user?.name || user?.sub || 'Cashier'}
        onOpen={handleOpenShift}
        terminals={terminals.map((t) => ({ id: t.id, name: t.name, code: t.code }))}
      />
    );
  }

  return <>{children}</>;
}
