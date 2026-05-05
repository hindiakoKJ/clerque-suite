'use client';
import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  ShoppingCart, LayoutDashboard, ShoppingBag, Package, ClipboardList,
  Users, Clock, Timer, RefreshCw, User, Ruler, AlertTriangle, Tag, Wallet,
  Monitor, Coffee, ChefHat, Snowflake, Cake, Store,
} from 'lucide-react';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import { AppShell, type NavItem } from '@/components/shell/AppShell';
import { ClockWidget } from '@/components/pos/ClockWidget';
import { OfflineBanner } from '@/components/pos/OfflineBanner';
import { ShiftGate } from '@/components/pos/ShiftGate';
import { CloseShiftModal } from '@/components/pos/CloseShiftModal';
import { ShiftEodReport, type ShiftReportData } from '@/components/pos/ShiftEodReport';
import { CashOutModal } from '@/components/pos/CashOutModal';
import { PrinterButton } from '@/components/pos/PrinterButton';
import { useAuthStore } from '@/store/auth';
import { useShiftStore } from '@/store/pos/shift';
import { useShiftGuard } from '@/hooks/pos/useShiftGuard';
import { usePendingSync } from '@/hooks/pos/usePendingSync';
import { closeShift, getShiftSummary } from '@/lib/pos/shifts';
import { api } from '@/lib/api';
import { db } from '@/lib/pos/db';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const POS_ACCENT      = 'hsl(217 91% 55%)';
const POS_ACCENT_SOFT = 'hsl(217 91% 55% / 0.08)';

// ── SOD Nav Role Sets ──────────────────────────────────────────────────────────
// Backend guards are the authoritative wall — these control sidebar visibility/state.
//
// Roles that can operate the register (open/close shifts):
//   CASHIER, SALES_LEAD
// Roles that are supervisors (view-only in POS, bypass ShiftGate):
//   BUSINESS_OWNER, BRANCH_MANAGER, SUPER_ADMIN, FINANCE_LEAD, MDM, WAREHOUSE_STAFF,
//   BOOKKEEPER, ACCOUNTANT, PAYROLL_MASTER, EXTERNAL_AUDITOR, GENERAL_EMPLOYEE
//
// Nav items are ALWAYS shown to every POS user but grayed-out (with lock icon)
// when the current role doesn't have access — so staff can see the full system
// capability and understand what each role unlocks.
const TERMINAL_ROLES   = ['SALES_LEAD', 'CASHIER'] as const;
const DASHBOARD_ROLES  = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD', 'FINANCE_LEAD'] as const;
const ORDERS_ROLES     = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD', 'CASHIER', 'EXTERNAL_AUDITOR'] as const;
const PRODUCTS_ROLES   = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'MDM'] as const;
const INVENTORY_ROLES  = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM', 'WAREHOUSE_STAFF', 'FINANCE_LEAD'] as const;
const STAFF_ROLES      = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM', 'SALES_LEAD', 'PAYROLL_MASTER'] as const;
const UOM_ROLES        = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'MDM'] as const;
const PROMOTIONS_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'MDM', 'BRANCH_MANAGER'] as const;
// Pending Sync is operational — only relevant to roles that create offline orders
const PENDING_SYNC_ROLES = ['CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER'] as const;
// My Expenses moved to /payroll/my-expenses — it's a personal-reimbursement
// concept (HR territory), not a POS sale-floor concept. POS will instead get
// a dedicated Cash Paid-Out / Cash Drop feature for till petty-cash.

function inRoles(role: string | undefined | null, set: readonly string[]) {
  return !!(role && set.includes(role));
}

/** Build a nav item — always visible; grayed-out with lock if role lacks access. */
function makeNavItem(
  href: string, label: string, icon: React.ElementType,
  allowedRoles: readonly string[], role: string | undefined | null,
  badge?: number,
): NavItem {
  const hasAccess = inRoles(role, allowedRoles);
  return {
    href, label, icon, badge,
    disabled: !hasAccess,
    disabledReason: hasAccess ? undefined : 'Your role doesn\'t have access to this section',
  };
}

export default function PosLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { user, accessToken, clear } = useAuthStore();
  const { activeShift, clearShift } = useShiftStore();
  const { pendingCount, isSyncing, triggerSync } = usePendingSync();
  // Customer-facing display flag — drives the "Open Display" header button.
  // `layout` carries the full station list so we can also expose Bar / Kitchen
  // KDS buttons in the header (they open in a new window for second-screen use).
  const { hasCustomerDisplay, layout } = useFloorLayout();
  const kdsStations = (layout?.stations ?? []).filter((s) => s.hasKds);

  const [showCloseShift,      setShowCloseShift]      = useState(false);
  const [showCashOut,         setShowCashOut]         = useState(false);
  const [showSignOutWarning,  setShowSignOutWarning]  = useState(false);
  const [signOutAfterClose,   setSignOutAfterClose]   = useState(false);
  const [eodReport,           setEodReport]           = useState<ShiftReportData | null>(null);
  const [logoutOnEodClose,    setLogoutOnEodClose]    = useState(false);
  const [hydrated,            setHydrated]            = useState(false);

  useEffect(() => { setHydrated(true); }, []);
  useEffect(() => {
    if (hydrated && !accessToken) router.replace('/login');
  }, [hydrated, accessToken, router]);

  // ── Smart landing redirect ──────────────────────────────────────────────────
  // The root /pos page always sends users to /pos/terminal, but supervisors
  // (BUSINESS_OWNER, BRANCH_MANAGER, etc.) don't have terminal access.
  // If they land on /pos/terminal without access, redirect to their first
  // accessible page so they don't stare at a grayed-out terminal screen.
  useEffect(() => {
    if (!hydrated || !user) return;
    const r = user.role;
    if (
      (pathname === '/pos/terminal' || pathname === '/pos') &&
      !inRoles(r, TERMINAL_ROLES)
    ) {
      const firstAccessible = [
        { href: '/pos/dashboard',    roles: DASHBOARD_ROLES  },
        { href: '/pos/orders',       roles: ORDERS_ROLES     },
        { href: '/pos/products',     roles: PRODUCTS_ROLES   },
        { href: '/pos/inventory',    roles: INVENTORY_ROLES  },
        { href: '/pos/staff',        roles: STAFF_ROLES      },
        { href: '/pos/settings/uom', roles: UOM_ROLES        },
      ].find((item) => inRoles(r, item.roles));
      if (firstAccessible) router.replace(firstAccessible.href);
    }
  }, [hydrated, user, pathname, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set accent on <html> so Radix Dialog portals (rendered at document.body)
  // also inherit the correct --accent value in both light and dark mode.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent',      POS_ACCENT);
    root.style.setProperty('--accent-soft', POS_ACCENT_SOFT);
    return () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
    };
  }, []);

  // ── Browser-level guard: shows native "Leave site?" dialog on tab close / refresh ──
  useShiftGuard(!!activeShift);

  const role = user?.role;

  // ── Counter role suffix ────────────────────────────────────────────────────
  // Shown after "Counter" in the sidebar header so users always know whose
  // session they're in. Useful when admin and cashier are both on the same
  // shop floor on different tablets — the label tells you at a glance.
  // Binary distinction: anyone who operates the till = Cashier, otherwise Admin.
  const roleLabel: string = inRoles(role, TERMINAL_ROLES) ? 'Cashier' : 'Admin';

  // Build nav — ALL items are shown to every POS user.
  // Items the current role cannot access appear grayed-out with a lock icon.
  // Backend guards remain the authoritative enforcement layer.
  const navItems: NavItem[] = [
    makeNavItem('/pos/dashboard',    'Dashboard',   LayoutDashboard, DASHBOARD_ROLES,     role),
    makeNavItem('/pos/terminal',     'Terminal',    ShoppingCart,    TERMINAL_ROLES,      role),
    makeNavItem('/pos/orders',       'Orders',      ShoppingBag,     ORDERS_ROLES,        role),
    makeNavItem('/pos/products',     'Products',    Package,         PRODUCTS_ROLES,      role),
    makeNavItem('/pos/inventory',    'Ingredients', ClipboardList,   INVENTORY_ROLES,     role),
    makeNavItem('/pos/staff',        'Staff',       Users,           STAFF_ROLES,         role),
    makeNavItem('/pos/settings/uom', 'Units (UoM)', Ruler,           UOM_ROLES,           role),
    makeNavItem('/pos/promotions',   'Promotions',  Tag,             PROMOTIONS_ROLES,    role),
    makeNavItem('/pos/pending',      'Pending Sync',Clock,           PENDING_SYNC_ROLES,  role, pendingCount || undefined),
  ].filter((item) => !item.disabled);

  async function doLogout() {
    const refresh = localStorage.getItem('app-auth');
    if (refresh) { try { await api.post('/auth/logout', { refreshToken: refresh }); } catch {} }
    clear();
    clearShift();
    document.cookie = 'app-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    router.push('/login');
  }

  function handleLogout() {
    // If a shift is active, show a warning instead of logging out immediately
    if (activeShift) {
      setShowSignOutWarning(true);
      return;
    }
    void doLogout();
  }


  async function handleCloseShift(closingCashDeclared: number, notes?: string) {
    if (!activeShift) return;
    const shiftId = activeShift.id;
    await closeShift(shiftId, closingCashDeclared, notes);
    setShowCloseShift(false);
    toast.success('Shift closed successfully.');

    // Terminal operators (CASHIER / SALES_LEAD) always log out after closing a shift.
    // Shared terminals need the login screen between cashier rotations so each
    // shift is tied to the correct user account. Supervisors stay logged in.
    const willLogout = signOutAfterClose || inRoles(role, TERMINAL_ROLES);
    setSignOutAfterClose(false);

    let hasEod = false;
    try {
      const { data } = await api.get(`/reports/shift/${shiftId}`);
      setEodReport(data as ShiftReportData);
      hasEod = true;
    } catch (err) {
      console.warn('EOD report fetch failed:', err);
      toast.warning('End-of-day report unavailable — check your connection and view it from Orders.');
    }
    clearShift();
    try { await db.activeShift.clear(); } catch {}

    if (willLogout) {
      if (hasEod) {
        // Logout is deferred to when the cashier taps "Done & Sign Out" on the EOD modal.
        // This ensures they have time to view/print the report before being signed out.
        setLogoutOnEodClose(true);
      } else {
        // No EOD report to show — log out after a brief pause so the success toast is visible.
        setTimeout(() => { void doLogout(); }, 1800);
      }
    }
  }

  async function refreshShift() {
    if (!activeShift) return;
    try { useShiftStore.getState().setActiveShift(await getShiftSummary(activeShift.id)); } catch {}
  }

  const headerRight = (
    <>
      {pendingCount > 0 && (
        <button
          onClick={triggerSync}
          disabled={isSyncing}
          className="hidden sm:flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white rounded-md px-2.5 py-1.5 transition-colors font-medium"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
          {pendingCount} pending
        </button>
      )}

      {activeShift && (
        <button
          onClick={() => setShowCashOut(true)}
          className="hidden sm:flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 rounded-md px-2.5 py-1.5 transition-colors"
          title="Record cash leaving the till (paid-out / drop to safe)"
        >
          <Wallet className="h-3.5 w-3.5" />
          Cash Out
        </button>
      )}

      {/* Open station KDS displays in a new window — one button per station
          that has KDS enabled (Bar, Kitchen, etc.). Each station's KDS is a
          standalone URL — point a tablet at it and it works on its own.
          No pairing, no sync setup; just sign in once and bookmark. */}
      {kdsStations.map((station) => {
        const StationIcon =
          station.kind === 'BAR' || station.kind === 'HOT_BAR' ? Coffee :
          station.kind === 'COLD_BAR' ? Snowflake :
          station.kind === 'KITCHEN' ? ChefHat :
          station.kind === 'PASTRY_PASS' ? Cake : Store;
        return (
          <button
            key={station.id}
            onClick={() => {
              window.open(
                `/pos/station/${station.id}`,
                `clerque-kds-${station.id}`,
                'noopener,noreferrer,width=1280,height=800',
              );
            }}
            className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-md px-2.5 py-1.5 transition-colors"
            title={`Open the ${station.name} display in a new window (or copy the URL onto a tablet)`}
          >
            <StationIcon className="h-3.5 w-3.5" />
            {station.name}
          </button>
        );
      })}

      {/* Open the customer-facing display in a new window — only when the
          tenant has it configured (CS_2+, or CS_1 with toggle on). */}
      {hasCustomerDisplay && (
        <button
          onClick={() => {
            window.open(
              '/pos/customer-display',
              'clerque-customer-display',
              'noopener,noreferrer,width=1280,height=800',
            );
          }}
          className="hidden sm:flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-md px-2.5 py-1.5 transition-colors"
          title="Open the customer-facing display in a new window"
        >
          <Monitor className="h-3.5 w-3.5" />
          Customer Display
        </button>
      )}

      {activeShift && (
        <button
          onClick={async () => { await refreshShift(); setShowCloseShift(true); }}
          className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-secondary hover:bg-secondary/80 rounded-md px-2.5 py-1.5 transition-colors"
        >
          <Timer className="h-3.5 w-3.5" />
          Close Shift
        </button>
      )}

      <div className="hidden sm:block">
        <PrinterButton />
      </div>

      <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary rounded-md px-2.5 py-1.5">
        <User className="h-3.5 w-3.5" />
        <span className="max-w-[80px] truncate">{user?.name || 'Cashier'}</span>
      </div>
    </>
  );

  if (!hydrated) return null;

  return (
    <div
      style={{
        '--accent':      POS_ACCENT,
        '--accent-soft': POS_ACCENT_SOFT,
      } as React.CSSProperties}
    >
      <AppShell
        navItems={navItems}
        logoIcon={ShoppingCart}
        appName="Counter"
        roleLabel={roleLabel}
        headerRight={headerRight}
        sidebarExtra={<ClockWidget />}
        helpHref="/pos/help"
        onSignOut={handleLogout}
      >
        <OfflineBanner />
        <ShiftGate>{children}</ShiftGate>
      </AppShell>

      {activeShift && (
        <CloseShiftModal
          open={showCloseShift}
          shift={activeShift}
          onClose={() => setShowCloseShift(false)}
          onConfirm={handleCloseShift}
        />
      )}

      <CashOutModal
        open={showCashOut}
        shiftId={activeShift?.id ?? null}
        onClose={() => setShowCashOut(false)}
        onSuccess={refreshShift}
      />

      {eodReport && (
        <ShiftEodReport
          open
          data={eodReport}
          signOutOnClose={logoutOnEodClose}
          onClose={() => {
            setEodReport(null);
            if (logoutOnEodClose) {
              setLogoutOnEodClose(false);
              void doLogout();
            }
          }}
        />
      )}

      {/* ── Sign-Out Guard Modal ─────────────────────────────────────────────
          Shown when the user clicks "Sign Out" while a shift is still open.
          Gives three options:
            1. Close Shift & Sign Out  (recommended)
            2. Sign Out Anyway         (emergency escape — shift stays open on server)
            3. Cancel                  (stay in the POS)
      ──────────────────────────────────────────────────────────────────────── */}
      {showSignOutWarning && activeShift && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

            {/* Header */}
            <div className="flex items-start gap-3 px-6 pt-6 pb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground text-base leading-snug">
                  Shift Still Open
                </h2>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  You have an active shift. Signing out without closing it means
                  your cash count and sales won&apos;t be recorded for this session.
                </p>
              </div>
            </div>

            {/* Shift info strip */}
            <div className="mx-6 mb-4 px-3 py-2.5 rounded-xl bg-muted/60 border border-border text-xs text-muted-foreground flex items-center justify-between">
              <span>Shift opened</span>
              <span className="font-medium text-foreground">
                {new Date(activeShift.openedAt).toLocaleString('en-PH', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                  timeZone: 'Asia/Manila',
                })}
              </span>
            </div>

            {/* Actions */}
            <div className="px-6 pb-6 flex flex-col gap-2">
              {/* Primary: close shift first, then auto-logout */}
              <button
                onClick={() => {
                  setShowSignOutWarning(false);
                  setSignOutAfterClose(true);   // handleCloseShift will doLogout() after
                  setShowCloseShift(true);
                }}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)' }}
              >
                Close Shift First, then Sign Out
              </button>

              {/* Secondary: force logout (destructive) */}
              <button
                onClick={() => { setShowSignOutWarning(false); void doLogout(); }}
                className="w-full py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-500/8 border border-red-200/50 dark:border-red-800/40 transition-colors"
              >
                Sign Out Anyway
              </button>

              {/* Cancel */}
              <button
                onClick={() => setShowSignOutWarning(false)}
                className="w-full py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Stay in POS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
