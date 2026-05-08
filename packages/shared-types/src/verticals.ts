/**
 * VerticalPack registry — single source of truth for per-business-type
 * capabilities across the Clerque app suite.
 *
 * ╭──────────────────────────────────────────────────────────────────────╮
 * │  THE THREE-AXIS MODEL                                                │
 * │                                                                      │
 * │   Module   = which apps the tenant can open  (POS / Ledger / Sync)   │
 * │   Plan     = how MUCH within those apps      (seats, branches, AI)   │
 * │   Vertical = WHAT the workflow looks like    (this file)             │
 * │                                                                      │
 * │  Module + Plan are business-model axes (sold via PLAN_CAPS / module  │
 * │  flags). Vertical is the workflow axis (sold via tenant.businessType │
 * │  during signup). They're orthogonal — a Solo-plan laundromat and a   │
 * │  Suite T3 laundromat see the same UI, just with different caps.      │
 * ╰──────────────────────────────────────────────────────────────────────╯
 *
 * RULE: Universal primitives. Vertical-specific surfaces. Plan-controlled
 * gating. Never fork accounting math, BIR forms, payroll engine, or auth
 * per vertical — those are PH-wide and forking them = forking the platform.
 *
 * Adding a new vertical = define ONE pack object below + register it in the
 * VERTICAL_PACKS map. No code spelunk through 14 files.
 *
 * Adding a new BusinessType WITHOUT adding a pack falls back to a sensible
 * default (RETAIL). Tests assert that every enum value is registered.
 */

import type { BusinessType } from './tenant';

// ── High-level grouping (for shared packs across multiple BusinessTypes) ──

/**
 * Vertical category — coarse grouping. A category may map to multiple
 * BusinessTypes. F&B has 6 BusinessTypes that all share one pack.
 */
export type VerticalCategory =
  | 'FNB'
  | 'RETAIL'
  | 'SERVICE'
  | 'LAUNDRY'
  | 'MANUFACTURING'
  | 'PHARMACY'        // future
  | 'PERSONAL_CARE';  // future — barbershop, salon, spa

// ── Per-pack capability descriptors ────────────────────────────────────

/** Cashier primary screen — what the till operator does first. */
export type CashierScreen =
  | 'TERMINAL'    // F&B / Retail / Service — cart-driven sale
  | 'INTAKE'      // Laundry — multi-line ticket before payment
  | 'WORK_ORDER'  // Auto-repair / construction (future)
  | 'DISPENSE'    // Pharmacy — Rx-gated dispense (future)
  | 'APPOINTMENT';// Salon / clinic (future)

/** Inventory paradigm. Drives Products page UX + COGS calculation. */
export type InventoryParadigm =
  | 'UNIT_FIFO'    // Retail / Pharmacy — discrete units, lot/expiry tracked
  | 'UNIT_WAC'     // Retail simple — discrete units, weighted average cost
  | 'RECIPE_BOM'   // F&B — finished item consumes ingredient quantities
  | 'SERVICE_BASED'// Laundry / Salon — services priced per kg/hour/visit
  | 'PROJECT_WIP'  // Manufacturing / Construction — WIP → Finished Goods
  | 'NONE';        // Pure service — no goods inventory at all

/** Compensation patterns this vertical's staff can be paid on. */
export type CompensationType =
  | 'SALARY'
  | 'HOURLY'
  | 'PIECE_RATE'      // per kg processed (laundry), per unit produced (mfg)
  | 'COMMISSION'      // % of own attributed sales (retail, salon)
  | 'PROJECT_HOURS'   // billable hours per project (service)
  | 'TIPS_POOL';      // F&B distributed tips

/** Timesheet input shape — drives the Sync (Payroll) timesheet UI. */
export type TimesheetShape =
  | 'SHIFT'      // open/close shift, total hours derived
  | 'PROJECT'    // hours logged against a project
  | 'PIECE'      // count of units / kg processed per day
  | 'COMMISSION' // attribution-based, no hour input
  | 'APPOINTMENT';

/** Receipt template id. Each vertical may print extra fields. */
export type ReceiptFormatId =
  | 'STANDARD_OR'      // F&B / Retail — BIR-compliant Official Receipt
  | 'LAUNDRY_CLAIM'    // OR + claim number prominent
  | 'PHARMACY_RX'      // OR + generic name + Rx + dispensing pharmacist PRC (future)
  | 'PROJECT_INVOICE'  // OR + project number + scope summary
  | 'APPOINTMENT_SLIP';// future

/** Plan-feature flags from PLAN_FEATURES (kept in sync with plans.ts). */
type PlanFeatureFlag =
  | 'birForms'
  | 'customRoles'
  | 'auditLog'
  | 'crossModuleReports'
  | 'aiAddons'
  | 'whitelabel'
  | 'customDomain';

/** Plan codes from plans.ts (subset — vertical may exclude specific plans). */
type PlanCode =
  | 'STD_SOLO' | 'STD_DUO' | 'STD_TEAM' | 'STD_BIZ'
  | 'PAIR_T1'  | 'PAIR_T2' | 'PAIR_T3'
  | 'SUITE_T1' | 'SUITE_T2' | 'SUITE_T3'
  | 'ENTERPRISE';

// ── The pack ─────────────────────────────────────────────────────────────

export interface VerticalPack {
  /** BusinessTypes this pack handles. F&B pack handles 6 enum values. */
  businessTypes: ReadonlyArray<BusinessType>;
  category:      VerticalCategory;
  /** Stable internal id used in registry keys + telemetry. */
  id:            string;
  /** Operator-facing label ("Coffee Shop", "Laundromat", "Pharmacy"). */
  displayName:   string;
  /** One-sentence description shown on the signup wizard. */
  tagline:       string;

  // ── POS surface (every vertical with modulePos has this) ────────────
  pos: {
    /** Primary cashier screen the operator lands on. */
    cashierScreen: CashierScreen;
    /** Logical sidebar groups in render order. */
    sidebarGroups: ReadonlyArray<{
      label: string;                              // 'Overview' / 'Sell' / 'Operations'
      items: ReadonlyArray<{
        label:    string;                         // 'Dashboard' / 'Terminal' / 'Intake'
        href:     string;                         // '/pos/dashboard'
        iconName: string;                         // 'LayoutDashboard' (lucide-react)
        /** Set true for items that need multi-branch (>1 active branch). */
        multiBranchOnly?: boolean;
      }>;
    }>;
    /** Receipt template id — drives the print layout. */
    receiptFormat: ReceiptFormatId;
    /** Product modal copy. */
    productModal: {
      titleNew:        string;
      titleEdit:       string;
      namePlaceholder: string;
      /** Whether to show the recipe / BOM toggle. Only true for RECIPE_BOM. */
      showInventoryMode: boolean;
      /** Notes shown under the modal title (e.g. pricing setup pointer). */
      helperHtml?: string;
    };
  };

  // ── Inventory paradigm — how stock is tracked + COGS computed ─────
  inventory: InventoryParadigm;

  // ── Ledger surface (when tenant has moduleLedger) ──────────────────
  ledger: {
    /** Vertical-specific report ids registered with the report registry. */
    reportIds: ReadonlyArray<string>;
    /** Vertical-specific JE templates auto-suggested at onboarding. */
    journalTemplateIds: ReadonlyArray<string>;
    /** Optional CoA accounts to enable beyond the universal seed. */
    optionalAccountCodes: ReadonlyArray<string>;
  };

  // ── Sync (Payroll) surface (when tenant has modulePayroll) ────────
  payroll: {
    compensationTypes: ReadonlyArray<CompensationType>;
    timesheetShape:    TimesheetShape;
    /** Vertical-specific allowances/deductions (tips, per-diem, PRC premium). */
    extraIds:          ReadonlyArray<string>;
  };

  // ── Settings ────────────────────────────────────────────────────────
  settings: {
    /** Extra cards on Settings landing for this vertical. */
    extraCards: ReadonlyArray<{
      label:    string;                           // 'Laundry Setup'
      desc:     string;
      href:     string;                           // '/settings/laundry'
      iconName: string;
    }>;
  };

  // ── Help / FAQ ───────────────────────────────────────────────────────
  help: {
    /** Module path under apps/web for the help-sections file. Imported lazily. */
    sectionsModule: string;                       // '@/verticals/laundry/help-sections'
  };

  // ── Plan compatibility ───────────────────────────────────────────────
  /** Plans that don't make sense for this vertical (signup-blocked). */
  excludedPlans?: ReadonlyArray<PlanCode>;
  /** Plan features required (vertical can't function without them). */
  requiredFeatures?: ReadonlyArray<PlanFeatureFlag>;
}

// ──────────────────────────────────────────────────────────────────────────
// PACKS — one definition per vertical. Adding a new vertical = add a pack
// here + map its BusinessTypes in VERTICAL_PACKS below. That's it.
// ──────────────────────────────────────────────────────────────────────────

/**
 * F&B pack — shared by all 6 F&B BusinessTypes.
 * Coffee shop, restaurant, bakery, food stall, bar/lounge, catering.
 */
export const fnbPack: VerticalPack = {
  businessTypes: ['COFFEE_SHOP', 'RESTAURANT', 'BAKERY', 'FOOD_STALL', 'BAR_LOUNGE', 'CATERING'],
  category:      'FNB',
  id:            'fnb',
  displayName:   'Food & Beverage',
  tagline:       'Coffee shops, restaurants, bakeries, food stalls, bars, catering.',

  pos: {
    cashierScreen: 'TERMINAL',
    sidebarGroups: [
      { label: 'Overview', items: [{ label: 'Dashboard', href: '/pos/dashboard', iconName: 'LayoutDashboard' }] },
      { label: 'Sell',     items: [
        { label: 'Terminal', href: '/pos/terminal', iconName: 'ShoppingCart' },
        { label: 'Orders',   href: '/pos/orders',   iconName: 'ShoppingBag' },
      ]},
      { label: 'Catalog',  items: [
        { label: 'Products',     href: '/pos/products',     iconName: 'Package'       },
        { label: 'Ingredients',  href: '/pos/inventory',    iconName: 'ClipboardList' },
        { label: 'Units (UoM)',  href: '/pos/settings/uom', iconName: 'Ruler'         },
      ]},
      { label: 'Warehouse', items: [
        { label: 'Transfers',    href: '/pos/warehouse/transfers',    iconName: 'Truck',          multiBranchOnly: true },
        { label: 'Cycle Counts', href: '/pos/warehouse/cycle-counts', iconName: 'ClipboardCheck', multiBranchOnly: true },
      ]},
    ],
    receiptFormat: 'STANDARD_OR',
    productModal: {
      titleNew:        'New Product',
      titleEdit:       'Edit Product',
      namePlaceholder: 'e.g. Brewed Coffee',
      showInventoryMode: true,    // recipe vs unit toggle
    },
  },

  inventory: 'RECIPE_BOM',

  ledger: {
    reportIds:            ['fnb.spoilage', 'fnb.day-part-revenue', 'fnb.recipe-cost-variance'],
    journalTemplateIds:   ['fnb.monthly-rent-utilities'],
    optionalAccountCodes: ['5070' /* Spoilage & Waste */, '6062' /* Water */, '6063' /* Gas & Fuel */],
  },

  payroll: {
    compensationTypes: ['HOURLY', 'SALARY', 'TIPS_POOL'],
    timesheetShape:    'SHIFT',
    extraIds:          ['fnb.tips-pool', 'fnb.meal-allowance'],
  },

  settings: {
    extraCards: [
      { label: 'Floor Layout', desc: 'Stations, printers, category routing, KDS', href: '/settings/floor-layout', iconName: 'LayoutGrid' },
    ],
  },

  help: { sectionsModule: '@/app/pos/(pos)/help/page' },
};

/** Retail pack — flat catalog, no recipes, no projects. Closest to "base" POS. */
export const retailPack: VerticalPack = {
  businessTypes: ['RETAIL'],
  category:      'RETAIL',
  id:            'retail',
  displayName:   'Retail',
  tagline:       'Sari-sari stores, boutiques, convenience, general merchandise.',

  pos: {
    cashierScreen: 'TERMINAL',
    sidebarGroups: [
      { label: 'Overview', items: [{ label: 'Dashboard', href: '/pos/dashboard', iconName: 'LayoutDashboard' }] },
      { label: 'Sell',     items: [
        { label: 'Terminal', href: '/pos/terminal', iconName: 'ShoppingCart' },
        { label: 'Orders',   href: '/pos/orders',   iconName: 'ShoppingBag' },
      ]},
      { label: 'Catalog',  items: [
        { label: 'Products',    href: '/pos/products',     iconName: 'Package'       },
        { label: 'Inventory',   href: '/pos/inventory',    iconName: 'ClipboardList' },
        { label: 'Units (UoM)', href: '/pos/settings/uom', iconName: 'Ruler'         },
      ]},
      { label: 'Warehouse', items: [
        { label: 'Transfers',    href: '/pos/warehouse/transfers',    iconName: 'Truck',          multiBranchOnly: true },
        { label: 'Cycle Counts', href: '/pos/warehouse/cycle-counts', iconName: 'ClipboardCheck', multiBranchOnly: true },
      ]},
    ],
    receiptFormat: 'STANDARD_OR',
    productModal: {
      titleNew:        'New Product',
      titleEdit:       'Edit Product',
      namePlaceholder: 'e.g. Item name',
      showInventoryMode: false,
    },
  },

  inventory: 'UNIT_WAC',

  ledger: {
    reportIds:            ['retail.shrinkage', 'retail.abc-analysis'],
    journalTemplateIds:   [],
    optionalAccountCodes: ['5060' /* Inventory Write-off */],
  },

  payroll: {
    compensationTypes: ['HOURLY', 'SALARY', 'COMMISSION'],
    timesheetShape:    'SHIFT',
    extraIds:          ['retail.sales-commission'],
  },

  settings: { extraCards: [] },

  help: { sectionsModule: '@/app/pos/(pos)/help/page' },
};

/**
 * Service / Manufacturing pack — adds Projects + Material Issuance.
 * Construction, repair shops, custom manufacturing, generic services.
 */
export const serviceMfgPack: VerticalPack = {
  businessTypes: ['SERVICE', 'MANUFACTURING'],
  category:      'SERVICE',
  id:            'service-mfg',
  displayName:   'Service / Manufacturing',
  tagline:       'Construction, repair shops, custom manufacturing, project-based services.',

  pos: {
    cashierScreen: 'TERMINAL',
    sidebarGroups: [
      { label: 'Overview', items: [{ label: 'Dashboard', href: '/pos/dashboard', iconName: 'LayoutDashboard' }] },
      { label: 'Sell',     items: [
        { label: 'Terminal', href: '/pos/terminal', iconName: 'ShoppingCart' },
        { label: 'Orders',   href: '/pos/orders',   iconName: 'ShoppingBag' },
      ]},
      { label: 'Catalog',  items: [
        { label: 'Products',    href: '/pos/products',     iconName: 'Package'       },
        { label: 'Inventory',   href: '/pos/inventory',    iconName: 'ClipboardList' },
        { label: 'Units (UoM)', href: '/pos/settings/uom', iconName: 'Ruler'         },
      ]},
      { label: 'Projects', items: [
        { label: 'Projects', href: '/pos/projects', iconName: 'Hammer' },
      ]},
      { label: 'Warehouse', items: [
        { label: 'Transfers',    href: '/pos/warehouse/transfers',    iconName: 'Truck',          multiBranchOnly: true },
        { label: 'Cycle Counts', href: '/pos/warehouse/cycle-counts', iconName: 'ClipboardCheck', multiBranchOnly: true },
      ]},
    ],
    receiptFormat: 'PROJECT_INVOICE',
    productModal: {
      titleNew:        'New Product',
      titleEdit:       'Edit Product',
      namePlaceholder: 'e.g. Item / raw material',
      showInventoryMode: false,
    },
  },

  inventory: 'PROJECT_WIP',

  ledger: {
    reportIds:            ['service.project-pnl', 'service.wip-aging', 'service.materials-variance'],
    journalTemplateIds:   ['service.daily-wip-to-fg'],
    optionalAccountCodes: ['5080' /* Direct Labor */, '5090' /* Manufacturing Overhead */],
  },

  payroll: {
    compensationTypes: ['HOURLY', 'SALARY', 'PROJECT_HOURS', 'PIECE_RATE'],
    timesheetShape:    'PROJECT',
    extraIds:          ['service.per-diem', 'service.site-allowance'],
  },

  settings: { extraCards: [] },
  help: { sectionsModule: '@/app/pos/(pos)/help/page' },
  // Manufacturing on a single-cashier plan is rarely a real business.
  excludedPlans: ['STD_SOLO'],
};

/**
 * Laundry pack — entirely different cashier flow (intake/queue/claim
 * instead of cart-driven sale).
 */
export const laundryPack: VerticalPack = {
  businessTypes: ['LAUNDRY'],
  category:      'LAUNDRY',
  id:            'laundry',
  displayName:   'Laundromat',
  tagline:       'Wash-and-fold, dry-clean, pickup-and-delivery laundry services.',

  pos: {
    cashierScreen: 'INTAKE',
    sidebarGroups: [
      { label: 'Overview',   items: [{ label: 'Dashboard', href: '/pos/dashboard', iconName: 'LayoutDashboard' }] },
      { label: 'Operations', items: [
        { label: 'Intake', href: '/pos/laundry/intake', iconName: 'Sparkles' },
        { label: 'Queue',  href: '/pos/laundry/queue',  iconName: 'Shirt'    },
      ]},
      { label: 'Records', items: [
        { label: 'Orders',   href: '/pos/orders',   iconName: 'ShoppingBag' },
        { label: 'Services', href: '/pos/products', iconName: 'Package'     },
      ]},
      // No Warehouse group — laundry doesn't track raw-material variance.
    ],
    receiptFormat: 'LAUNDRY_CLAIM',
    productModal: {
      titleNew:        'New Service / Item',
      titleEdit:       'Edit Service / Item',
      namePlaceholder: 'e.g. Wash & Fold (per kg)',
      showInventoryMode: false,
      helperHtml: 'Use this for retail items (detergent, fabric softener, hangers). Per-kg / per-load <strong>service prices</strong> live under Settings → Laundry.',
    },
  },

  inventory: 'SERVICE_BASED',

  ledger: {
    reportIds:            ['laundry.claim-aging', 'laundry.service-mix', 'laundry.machine-utilization'],
    journalTemplateIds:   ['laundry.weekly-utility-allocation'],
    optionalAccountCodes: ['4040' /* Service Revenue */, '6062' /* Water */, '6061' /* Electricity */],
  },

  payroll: {
    compensationTypes: ['HOURLY', 'SALARY', 'PIECE_RATE'],
    timesheetShape:    'SHIFT',
    extraIds:          ['laundry.per-load-bonus'],
  },

  settings: {
    extraCards: [
      { label: 'Laundry Setup', desc: 'Service prices, promos, machine fleet', href: '/settings/laundry', iconName: 'Sparkles' },
    ],
  },

  help: { sectionsModule: '@/app/pos/(pos)/help/laundry-sections' },
};

// ──────────────────────────────────────────────────────────────────────────
// EXAMPLE — adding a new vertical is exactly two edits in this file.
//
// The barbershopPack below is the reference implementation: a complete
// vertical defined in ~30 lines. When BusinessType.BARBERSHOP is added to
// the enum (in tenant.ts + the Prisma schema), uncomment the registry entry
// at the bottom and the barbershop tenant immediately gets:
//   - Its own POS sidebar (Appointments / Services / Products / Manage)
//   - Its own dashboard (booked-today, walk-in mix, top stylist)
//   - Commission-based payroll
//   - Appointment-slip receipt format
//   - The right help / settings cards
//
// No code changes anywhere else in the codebase. That's the whole point.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Barbershop / salon / spa pack — appointment-driven personal-care services.
 * Currently a TEMPLATE, not registered. Uncomment the VERTICAL_PACKS entry
 * below + add BARBERSHOP to BusinessType when ready to ship.
 */
export const barbershopPack: VerticalPack = {
  // businessTypes: ['BARBERSHOP'],   // uncomment when enum value exists
  businessTypes: [],
  category:      'PERSONAL_CARE',
  id:            'barbershop',
  displayName:   'Barbershop / Salon',
  tagline:       'Appointment-driven personal-care services with stylist commission.',

  pos: {
    cashierScreen: 'APPOINTMENT',
    sidebarGroups: [
      { label: 'Overview', items: [{ label: 'Dashboard', href: '/pos/dashboard', iconName: 'LayoutDashboard' }] },
      { label: 'Today',    items: [
        { label: 'Appointments', href: '/pos/appointments', iconName: 'Calendar'   },
        { label: 'Walk-ins',     href: '/pos/terminal',     iconName: 'ShoppingCart' },
      ]},
      { label: 'Catalog',  items: [
        { label: 'Services', href: '/pos/products',     iconName: 'Sparkles' },
        { label: 'Products', href: '/pos/inventory',    iconName: 'Package'  },
        { label: 'Stylists', href: '/pos/staff',        iconName: 'Users'    },
      ]},
    ],
    receiptFormat: 'APPOINTMENT_SLIP',
    productModal: {
      titleNew:        'New Service / Product',
      titleEdit:       'Edit Service / Product',
      namePlaceholder: 'e.g. Men\'s haircut',
      showInventoryMode: false,
    },
  },

  inventory: 'SERVICE_BASED',

  ledger: {
    reportIds:            ['barbershop.stylist-revenue', 'barbershop.service-mix', 'barbershop.commission-payable'],
    journalTemplateIds:   [],
    optionalAccountCodes: ['4040' /* Service Revenue */, '2110' /* Commissions Payable */ ],
  },

  payroll: {
    compensationTypes: ['HOURLY', 'COMMISSION'],
    timesheetShape:    'COMMISSION',
    extraIds:          ['barbershop.tip-distribution', 'barbershop.product-commission'],
  },

  settings: { extraCards: [] },
  help: { sectionsModule: '@/app/pos/(pos)/help/page' },
};

// ──────────────────────────────────────────────────────────────────────────
// REGISTRY — the single map every per-vertical decision reads from.
//
// Adding a new vertical is exactly two edits:
//   1. Define a new pack object above (one file).
//   2. Add the BusinessType → pack mappings here.
// ──────────────────────────────────────────────────────────────────────────

export const VERTICAL_PACKS: Record<BusinessType, VerticalPack> = {
  COFFEE_SHOP:   fnbPack,
  RESTAURANT:    fnbPack,
  BAKERY:        fnbPack,
  FOOD_STALL:    fnbPack,
  BAR_LOUNGE:    fnbPack,
  CATERING:      fnbPack,
  RETAIL:        retailPack,
  SERVICE:       serviceMfgPack,
  MANUFACTURING: serviceMfgPack,
  LAUNDRY:       laundryPack,
};

/** Default pack used when a businessType isn't yet registered (defensive). */
const DEFAULT_PACK: VerticalPack = retailPack;

/**
 * Single accessor — every per-vertical decision in the codebase should read
 * from this. Replaces the scattered `isLaundryType()` / `isFnbType()` checks.
 */
export function getVerticalPack(businessType: BusinessType | null | undefined): VerticalPack {
  if (!businessType) return DEFAULT_PACK;
  return VERTICAL_PACKS[businessType] ?? DEFAULT_PACK;
}

/**
 * List of all registered packs (deduplicated — F&B pack appears once even
 * though it covers 6 BusinessTypes). Used by admin / signup wizard to render
 * the vertical picker.
 */
export const ALL_PACKS: ReadonlyArray<VerticalPack> = (() => {
  const seen = new Set<string>();
  const out: VerticalPack[] = [];
  for (const pack of Object.values(VERTICAL_PACKS)) {
    if (seen.has(pack.id)) continue;
    seen.add(pack.id);
    out.push(pack);
  }
  return out;
})();

/**
 * Convenience predicate — drop-in replacement for the older `isFnbType`,
 * `isLaundryType` helpers. Generic over category.
 */
export function isCategory(businessType: BusinessType | null | undefined, category: VerticalCategory): boolean {
  return getVerticalPack(businessType).category === category;
}
