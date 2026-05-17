'use client';
import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ShoppingCart, LayoutDashboard, ShoppingBag, Package, ClipboardList,
  Users, Clock, Timer, RefreshCw, User, Ruler, AlertTriangle, Tag, Wallet,
  Monitor, Coffee, ChefHat, Snowflake, Cake, Store,
  Shirt, Sparkles, Truck, ClipboardCheck, Hammer, Activity, ChartBar,
  Pill, FileBadge, ShieldAlert, Wrench, Receipt as ReceiptIcon, Briefcase,
} from 'lucide-react';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import { isLaundryType, isFnbType } from '@repo/shared-types';
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
// Sprint 19 — POS is restricted to three roles at the route layer:
// BUSINESS_OWNER, BRANCH_MANAGER, CASHIER (+ SUPER_ADMIN for platform support).
// Other tenant roles (PAYROLL_MASTER, BOOKKEEPER, MDM, FINANCE_LEAD, etc.)
// live in Ledger / Sync / Console — they no longer reach /pos/*.
//
// Within those three, features cascade by hierarchy:
//   OWNER   → everything (Dashboard, Terminal, Orders, Products, Inventory,
//             Staff, Promotions, Vertical workflows, Settings)
//   MANAGER → everything except destructive ops + staff salary edits
//   CASHIER → till-floor only: Terminal, Pending Sync, own Orders, Help
//
// Nav items are ALWAYS shown to every POS user but grayed-out (with lock icon)
// when the current role doesn't have access — so staff can see the full system
// capability and understand what each role unlocks.
const ALL_POS    = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER'] as const;
const MGMT_POS   = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER'] as const;
// Sprint 19 — Separation of Duties. The till operator cannot also be the
// supervisor who approves voids/discounts. Manager APPROVES cashier
// actions; they don't ring sales themselves. Owner is exempt because in
// solo / small-shop plans the owner IS the cashier (matches PH SMB reality).
const TILL_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'CASHIER'] as const;

const TERMINAL_ROLES     = TILL_ROLES;   // ring up sales — SoD: no manager
const PENDING_SYNC_ROLES = TILL_ROLES;   // offline order queue belongs to till operators
const ORDERS_ROLES       = ALL_POS;      // read access for everyone (manager reviews / cashier sees own till)
const LAUNDRY_OPS_ROLES  = ALL_POS;      // intake / queue / fleet are operational, not financial — manager OK

const DASHBOARD_ROLES  = MGMT_POS;       // owner + manager (revenue gate is separate)
const PRODUCTS_ROLES   = MGMT_POS;       // edit catalog
const INVENTORY_ROLES  = MGMT_POS;
const STAFF_ROLES      = MGMT_POS;
const UOM_ROLES        = MGMT_POS;
const PROMOTIONS_ROLES = MGMT_POS;
const WAREHOUSE_ROLES  = MGMT_POS;       // multi-branch stock transfers
const PROJECT_ROLES    = MGMT_POS;       // construction / job-cost
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

  // Real branch count — the source of truth for whether to surface multi-branch
  // features in the sidebar (Stock Transfers, Cycle Counts). A tenant whose plan
  // permits multiple branches but who has only set up one shouldn't see these
  // affordances yet — they'd land on empty pages anyway. Only when a second
  // branch is actually provisioned do these become useful.
  const branchesQuery = useQuery<Array<{ id: string; isActive: boolean }>>({
    queryKey: ['tenant-branches'],
    queryFn:  () => api.get('/tenant/branches').then((r) => r.data),
    enabled:  !!accessToken,
    staleTime: 60_000,
  });
  const activeBranchCount = (branchesQuery.data ?? []).filter((b) => b.isActive).length;

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
    // KIOSK_DISPLAY accounts have no business in the cashier shell at all —
    // they belong on the station picker. Catch them BEFORE the smart-landing
    // logic so we don't fall through to "no accessible page" stuck state.
    if (r === 'KIOSK_DISPLAY') {
      router.replace('/pos/select-display');
      return;
    }
    // Laundry tenants don't use /pos/terminal at all — bounce anyone landing
    // on terminal or root /pos straight to the laundry queue.
    if (
      isLaundryType(layout?.tenant?.businessType) &&
      (pathname === '/pos/terminal' || pathname === '/pos')
    ) {
      router.replace('/pos/laundry/queue');
      return;
    }
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
      return;
    }

    // BUSINESS_OWNER landing — Solo owners run their own till, so Terminal is
    // their home. On every other plan there are hired cashiers, so the owner
    // is a manager: send them to the Dashboard on first entry. They can still
    // click Terminal in the sidebar afterwards.
    //
    // Two entry points need the redirect because login + middleware send users
    // straight to /pos/terminal (not /pos):
    //   1. /pos          — direct root visit
    //   2. /pos/terminal — login-flow + bookmarked URL
    //
    // To allow sidebar navigation to Terminal AFTER the first redirect, we
    // remember "owner already landed once" in sessionStorage. So:
    //   first load  → /pos/terminal → bounced to /pos/dashboard
    //   sidebar tap → /pos/terminal → respected (flag set)
    const planCode = (user as any)?.planCode as string | undefined;
    const isSoloPlan = planCode === 'STD_SOLO';
    if (
      r === 'BUSINESS_OWNER' &&
      !isSoloPlan &&
      (pathname === '/pos' || pathname === '/pos/terminal')
    ) {
      const alreadyLanded =
        typeof sessionStorage !== 'undefined' &&
        sessionStorage.getItem('owner-landed') === '1';
      if (!alreadyLanded) {
        try { sessionStorage.setItem('owner-landed', '1'); } catch {}
        router.replace('/pos/dashboard');
      }
    }
  }, [hydrated, user, pathname, router, layout?.tenant?.businessType]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Label shown after the app name in the sidebar header. Owners running their
  // own till see "Owner" instead of "Cashier" for clarity. SUPER_ADMIN always
  // shows "Admin" regardless of being in TERMINAL_ROLES.
  const roleLabel: string =
    role === 'SUPER_ADMIN'    ? 'Admin'   :
    role === 'BUSINESS_OWNER' ? 'Owner'   :
    inRoles(role, TERMINAL_ROLES) ? 'Cashier' : 'Admin';

  // ── POS sidebar nav resolver — vertical + multi-branch aware ────────────────
  //
  // The nav set you see depends on TWO independent dimensions:
  //
  //   1. businessType (vertical) — different verticals use POS differently:
  //        - LAUNDRY                       → Intake / Queue / Machines (no Terminal)
  //        - F&B (Coffee, Restaurant, …)   → Terminal + Ingredients/Recipes
  //        - SERVICE / MANUFACTURING       → adds Projects + Material Issuance
  //        - RETAIL                        → flat catalog, no recipes
  //
  //   2. multi-branch — Transfers + Cycle Counts only make sense when the
  //      tenant has more than one branch. We use the floor-layout hook's
  //      branch list (fast, cached) as the single source of truth.
  //
  // Plan-tier gating (POS-only on Solo/Duo/Team/Business; AppAccessGuard for
  // Ledger/Payroll module entitlement) is handled BACKEND-side. The nav items
  // here are purely visual — backend guards remain the authoritative wall.
  const businessType = layout?.tenant?.businessType;
  const isLaundry      = isLaundryType(businessType);
  const isFnb          = isFnbType(businessType);
  const isService      = businessType === 'SERVICE';
  const isMfg          = businessType === 'MANUFACTURING';
  const isRetail       = businessType === 'RETAIL';
  // Sprint 13 verticals
  const isPharmacy     = businessType === 'PHARMACY';
  const isTrucking     = businessType === 'TRUCKING';
  const isConstruction = businessType === 'CONSTRUCTION';
  // Multi-branch features only surface once the tenant has actually provisioned
  // a second branch — not merely because the plan permits it. Reasoning:
  //   - Transfers: nothing to transfer to/from with one branch.
  //   - Cycle Counts: a single-branch coffee shop / retail cashier can adjust
  //     inventory directly via the Ingredients/Products page; the formal
  //     count → variance → posting SOP is overhead they don't need. It's a
  //     multi-branch / warehouse-supervised control.
  // Plan capacity (planLimits.maxBranches) still gates whether the tenant CAN
  // add another branch, but that's enforced at the Settings → Branches page.
  // Until activeBranchCount > 1, both nav items stay hidden.
  // Laundry hides Cycle Counts at every count (no raw-material variance flow).
  const isMultiBranch  = activeBranchCount > 1;
  const showTransfers   = isMultiBranch;
  const showCycleCounts = isMultiBranch && !isLaundry;

  // Helper: stamp a section header onto the first item of a group. Sections
  // appear in the sidebar as small uppercase dividers above their first item;
  // collapsed mode renders only a thin separator. Empty groups are dropped.
  const withSection = (label: string, items: NavItem[]): NavItem[] =>
    items.length ? [{ ...items[0], sectionStart: label }, ...items.slice(1)] : [];

  // ── COMMON TAIL — Manage section (Staff / Promotions / Pending Sync) ────────
  // Promotions only relevant for sell-through verticals (F&B, Retail, Laundry).
  // Service/Manufacturing don't run consumer-facing promos.
  const showPromotions = isFnb || isRetail || isLaundry;
  const COMMON_TAIL: NavItem[] = [
    ...withSection('Manage', [
      makeNavItem('/pos/staff',        'Staff',        Users,   STAFF_ROLES,        role),
      ...(showPromotions
        ? [makeNavItem('/pos/promotions', 'Promotions', Tag,    PROMOTIONS_ROLES,   role)]
        : []),
      makeNavItem('/pos/pending',      'Pending Sync', Clock,   PENDING_SYNC_ROLES, role, pendingCount || undefined),
    ]),
    // Sprint 25 — Settings group. Per-tenant configuration that lives under
    // /pos/settings/*. Displays (secondary-screen pairing) is the first
    // entry; future settings pages (printers, station mapping, etc.) live
    // here too. Owner/Admin/Manager gate matches the revoke permission on
    // the backend — cashiers can generate codes via their tablet directly
    // but shouldn't manage paired devices.
    ...withSection('Settings', [
      makeNavItem('/pos/settings/displays', 'Displays', Monitor, MGMT_POS, role),
    ]),
  ];

  // Warehouse group is shared across F&B / Service / Mfg / Retail. Empty for
  // single-branch tenants and laundry tenants (Cycle Counts hidden) — withSection
  // drops the header automatically when items.length === 0.
  // Sprint 19 — owner-only Cross-Branch dashboard alongside Transfers.
  const OWNER_ONLY = ['BUSINESS_OWNER', 'SUPER_ADMIN'] as const;
  const warehouseSection = withSection('Warehouse', [
    ...(isMultiBranch   ? [makeNavItem('/pos/inventory/cross-branch', 'Cross-Branch', Activity,       OWNER_ONLY,      role)] : []),
    ...(showTransfers   ? [makeNavItem('/pos/warehouse/transfers',    'Transfers',    Truck,          WAREHOUSE_ROLES, role)] : []),
    ...(showCycleCounts ? [makeNavItem('/pos/warehouse/cycle-counts', 'Cycle Counts', ClipboardCheck, WAREHOUSE_ROLES, role)] : []),
  ]);

  // Sprint 19 — Owner-only Sales Report, available across all verticals.
  // MGMT_POS = Owner + Branch Manager (cashier never sees revenue here).
  // Unified all-branch report is owner-only (multi-branch only).
  const reportsSection = withSection('Reports', [
    makeNavItem('/pos/reports/sales', 'Sales Report', ChartBar, MGMT_POS, role),
    ...(isMultiBranch
      ? [makeNavItem('/pos/reports/unified', 'All Branches', ChartBar, OWNER_ONLY, role)]
      : []),
  ]);

  let verticalNav: NavItem[];

  if (isLaundry) {
    // ── LAUNDRY ──────────────────────────────────────────────────────────────
    verticalNav = [
      ...withSection('Overview', [
        makeNavItem('/pos/dashboard',     'Dashboard',  LayoutDashboard, DASHBOARD_ROLES,    role),
      ]),
      ...withSection('Operations', [
        makeNavItem('/pos/laundry/intake','Intake',     Sparkles,        LAUNDRY_OPS_ROLES,  role),
        makeNavItem('/pos/laundry/queue', 'Queue',      Shirt,           LAUNDRY_OPS_ROLES,  role),
        makeNavItem('/pos/laundry/fleet', 'Fleet',      Activity,        LAUNDRY_OPS_ROLES,  role),
      ]),
      ...withSection('Records', [
        makeNavItem('/pos/orders',        'Orders',     ShoppingBag,     ORDERS_ROLES,       role),
        makeNavItem('/pos/products',      'Services',   Package,         PRODUCTS_ROLES,     role),
      ]),
    ];
  } else if (isPharmacy) {
    // ── PHARMACY (Sprint 13 Compliance-Engine) ───────────────────────────────
    // Adds Rx + Lots + DDB Register on top of standard retail nav. Stock
    // tracking happens at the Product level + Product Lots (lot/expiry
    // FDA-mandated); the F&B-style /pos/inventory ingredients page does
    // not apply to a retail pharmacy and was just rendering "Not used for
    // your business type" — removed from this nav.
    verticalNav = [
      ...withSection('Overview', [
        makeNavItem('/pos/dashboard',         'Dashboard',       LayoutDashboard, DASHBOARD_ROLES, role),
      ]),
      ...withSection('Sell', [
        makeNavItem('/pos/terminal',          'Terminal',        ShoppingCart,    TERMINAL_ROLES,  role),
        makeNavItem('/pos/orders',            'Orders',          ShoppingBag,     ORDERS_ROLES,    role),
      ]),
      ...withSection('Pharmacy', [
        makeNavItem('/pos/pharmacy/rx',         'Prescriptions',   FileBadge,       PRODUCTS_ROLES,  role),
        makeNavItem('/pos/pharmacy/lots',       'Product Lots',    Pill,            INVENTORY_ROLES, role),
        makeNavItem('/pos/pharmacy/deliveries', 'Deliveries',      Truck,           INVENTORY_ROLES, role),
        makeNavItem('/pos/pharmacy/register',   'DDB Register',    ShieldAlert,     PRODUCTS_ROLES,  role),
      ]),
      ...withSection('Catalog', [
        makeNavItem('/pos/products',          'Products',        Package,         PRODUCTS_ROLES,  role),
        makeNavItem('/pos/settings/uom',      'Units (UoM)',     Ruler,           UOM_ROLES,       role),
      ]),
      ...warehouseSection,
    ];
  } else if (isTrucking) {
    // ── TRUCKING (Sprint 13 Logistics-Engine) ────────────────────────────────
    // Trip dispatch + fleet maintenance + liquidation. Catalog is minimal —
    // freight is sold at the till as a service line.
    verticalNav = [
      ...withSection('Overview', [
        makeNavItem('/pos/dashboard',         'Dashboard',       LayoutDashboard, DASHBOARD_ROLES, role),
      ]),
      ...withSection('Operations', [
        makeNavItem('/pos/trucking/trips',    'Trip Tickets',    Truck,           ORDERS_ROLES,    role),
        makeNavItem('/pos/trucking/fleet',    'Fleet',           Wrench,          PRODUCTS_ROLES,  role),
        makeNavItem('/pos/trucking/pm',       'PM Schedules',    ClipboardList,   PRODUCTS_ROLES,  role),
      ]),
      ...withSection('Sell', [
        makeNavItem('/pos/terminal',          'Terminal',        ShoppingCart,    TERMINAL_ROLES,  role),
        makeNavItem('/pos/orders',            'Orders',          ShoppingBag,     ORDERS_ROLES,    role),
      ]),
      ...warehouseSection,
    ];
  } else if (isConstruction) {
    // ── CONSTRUCTION (Sprint 13 Project-Engine) ──────────────────────────────
    // Projects + progress billings on top of Service-style nav. Material
    // issuance flows through Projects → Issuances (existing).
    verticalNav = [
      ...withSection('Overview', [
        makeNavItem('/pos/dashboard',         'Dashboard',       LayoutDashboard, DASHBOARD_ROLES, role),
      ]),
      ...withSection('Projects', [
        makeNavItem('/pos/projects',          'Projects',        Hammer,          PROJECT_ROLES,   role),
        makeNavItem('/pos/construction/billings', 'Progress Billings', ReceiptIcon, PROJECT_ROLES, role),
      ]),
      ...withSection('Sell', [
        makeNavItem('/pos/terminal',          'Terminal',        ShoppingCart,    TERMINAL_ROLES,  role),
        makeNavItem('/pos/orders',            'Orders',          ShoppingBag,     ORDERS_ROLES,    role),
      ]),
      ...withSection('Catalog', [
        makeNavItem('/pos/products',          'Products',        Package,         PRODUCTS_ROLES,  role),
        makeNavItem('/pos/inventory',         'Materials',       ClipboardList,   INVENTORY_ROLES, role),
      ]),
      ...warehouseSection,
    ];
  } else if (isFnb) {
    // ── F&B (Coffee Shop, Restaurant, Bakery, Food Stall, Bar, Catering) ─────
    // Recipes/BOM live inside the Products page (mode toggle on each product).
    // Floor Layout lives under Settings — not a top-level nav item.
    verticalNav = [
      ...withSection('Overview', [
        makeNavItem('/pos/dashboard',    'Dashboard',   LayoutDashboard, DASHBOARD_ROLES, role),
      ]),
      ...withSection('Sell', [
        makeNavItem('/pos/terminal',     'Terminal',    ShoppingCart,    TERMINAL_ROLES,  role),
        makeNavItem('/pos/orders',       'Orders',      ShoppingBag,     ORDERS_ROLES,    role),
      ]),
      ...withSection('Catalog', [
        makeNavItem('/pos/products',     'Products',    Package,         PRODUCTS_ROLES,  role),
        makeNavItem('/pos/inventory',    'Ingredients', ClipboardList,   INVENTORY_ROLES, role),
        makeNavItem('/pos/settings/uom', 'Units (UoM)', Ruler,           UOM_ROLES,       role),
      ]),
      ...warehouseSection,
    ];
  } else if (isService || isMfg) {
    // ── SERVICE / MANUFACTURING ──────────────────────────────────────────────
    // SERVICE adds Job Orders (auto repair, appliance, IT, etc.) for the
    // diagnose → estimate → fix → claim workflow.
    // MANUFACTURING uses Projects for batch costing.
    verticalNav = [
      ...withSection('Overview', [
        makeNavItem('/pos/dashboard',    'Dashboard',   LayoutDashboard, DASHBOARD_ROLES, role),
      ]),
      ...withSection('Sell', [
        makeNavItem('/pos/terminal',     'Terminal',    ShoppingCart,    TERMINAL_ROLES,  role),
        makeNavItem('/pos/orders',       'Orders',      ShoppingBag,     ORDERS_ROLES,    role),
      ]),
      ...(isService ? withSection('Service', [
        makeNavItem('/pos/job-orders',   'Job Orders',  Briefcase,       PRODUCTS_ROLES,  role),
      ]) : []),
      ...withSection('Catalog', [
        makeNavItem('/pos/products',     'Products',    Package,         PRODUCTS_ROLES,  role),
        makeNavItem('/pos/inventory',    isMfg ? 'Raw Materials' : 'Inventory', ClipboardList, INVENTORY_ROLES, role),
        makeNavItem('/pos/settings/uom', 'Units (UoM)', Ruler,           UOM_ROLES,       role),
      ]),
      ...withSection('Projects', [
        makeNavItem('/pos/projects',     'Projects',    Hammer,          PROJECT_ROLES,   role),
      ]),
      ...warehouseSection,
    ];
  } else if (isRetail) {
    // ── RETAIL ───────────────────────────────────────────────────────────────
    // Flat catalog, no recipes/BOM, no projects.
    verticalNav = [
      ...withSection('Overview', [
        makeNavItem('/pos/dashboard',    'Dashboard',   LayoutDashboard, DASHBOARD_ROLES, role),
      ]),
      ...withSection('Sell', [
        makeNavItem('/pos/terminal',     'Terminal',    ShoppingCart,    TERMINAL_ROLES,  role),
        makeNavItem('/pos/orders',       'Orders',      ShoppingBag,     ORDERS_ROLES,    role),
      ]),
      ...withSection('Catalog', [
        makeNavItem('/pos/products',     'Products',    Package,         PRODUCTS_ROLES,  role),
        makeNavItem('/pos/inventory',    'Inventory',   ClipboardList,   INVENTORY_ROLES, role),
        makeNavItem('/pos/settings/uom', 'Units (UoM)', Ruler,           UOM_ROLES,       role),
      ]),
      ...warehouseSection,
    ];
  } else {
    // Fallback — businessType not set yet (new tenant) or unknown.
    // Show the F&B set as a sensible default; user can switch business type
    // from Settings to get the right nav.
    verticalNav = [
      ...withSection('Overview', [
        makeNavItem('/pos/dashboard',    'Dashboard',   LayoutDashboard, DASHBOARD_ROLES, role),
      ]),
      ...withSection('Sell', [
        makeNavItem('/pos/terminal',     'Terminal',    ShoppingCart,    TERMINAL_ROLES,  role),
        makeNavItem('/pos/orders',       'Orders',      ShoppingBag,     ORDERS_ROLES,    role),
      ]),
      ...withSection('Catalog', [
        makeNavItem('/pos/products',     'Products',    Package,         PRODUCTS_ROLES,  role),
        makeNavItem('/pos/inventory',    'Inventory',   ClipboardList,   INVENTORY_ROLES, role),
        makeNavItem('/pos/settings/uom', 'Units (UoM)', Ruler,           UOM_ROLES,       role),
      ]),
    ];
  }

  // Sprint 19 — Reports section appended to every vertical's nav.
  // Cashiers don't see it (MGMT_POS gated); makeNavItem still emits the
  // disabled+grayed entry for transparency, then the filter pass below
  // removes it from cashier nav since the role check fails.
  verticalNav = [...verticalNav, ...reportsSection];

  // Filter disabled items, hoisting any orphaned sectionStart label onto the
  // next visible item in that section. Without this, hiding the first item
  // of a group (e.g. role lacks Dashboard access) would also drop the section
  // header — a section's identity should outlive any single hidden item.
  const navItems: NavItem[] = (() => {
    const out: NavItem[] = [];
    let pendingSection: string | null = null;
    for (const item of [...verticalNav, ...COMMON_TAIL]) {
      if (item.disabled) {
        if (item.sectionStart && !pendingSection) pendingSection = item.sectionStart;
        continue;
      }
      const stamp = pendingSection ?? item.sectionStart;
      pendingSection = null;
      out.push(stamp ? { ...item, sectionStart: stamp } : item);
    }
    return out;
  })();

  async function doLogout() {
    const refresh = localStorage.getItem('app-auth');
    if (refresh) { try { await api.post('/auth/logout', { refreshToken: refresh }); } catch {} }
    clear();
    clearShift();
    // Also clear the web-origin mirror cookie (server clears its own HttpOnly copy).
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
      className="theme-counter"
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
