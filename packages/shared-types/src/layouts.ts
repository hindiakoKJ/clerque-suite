/**
 * Coffee Shop Operational Layout Tiers (CS-1 → CS-5)
 *
 * Distinct from `SubscriptionTier` (TIER_1-6, which gates pricing & staff cap).
 * These describe the PHYSICAL FLOOR LAYOUT — how many stations, what kind,
 * how orders flow from cashier to prep area.
 *
 * Each tier is a locked template (per the "Option A" customizability decision):
 * the structure is fixed — owner can rename stations but cannot add/remove
 * stations beyond what the template defines. Upgrades to a higher CS tier
 * are sales-controlled (no self-serve in-app upgrade).
 *
 * The template drives auto-provisioning of:
 *   - Stations (Counter / Bar / Kitchen / Hot Bar / Cold Bar / Pastry Pass)
 *   - Default Printer slots (Receipt + per-station)
 *   - Customer-facing display flag
 *   - Multi-terminal capability
 *   - KDS (Kitchen Display) availability
 *
 * Future verticals (Restaurants, Retail, Water Stations, Gas Stations) will
 * have parallel tier hierarchies (RT-1...RT-5, etc.) following the same
 * structure-then-rename pattern.
 */

// ── Enums ───────────────────────────────────────────────────────────────────

/**
 * Coffee shop floor-layout tier. Determines station structure, printer slots,
 * and whether customer/KDS displays are available.
 */
export const COFFEE_SHOP_TIERS = ['CS_1', 'CS_2', 'CS_3', 'CS_4', 'CS_5'] as const;
export type CoffeeShopTier = (typeof COFFEE_SHOP_TIERS)[number];

/**
 * A station is a logical prep area where ordered items are routed for
 * preparation. Each station can have one printer and one KDS screen.
 *
 * COUNTER       — All-in-one cashier+barista station (CS-1)
 * BAR           — Generic drinks station (CS-3, CS-4)
 * KITCHEN       — Food prep station (CS-4)
 * HOT_BAR       — Espresso / hot drinks (CS-5 only — split from cold)
 * COLD_BAR      — Iced drinks / frappes (CS-5 only — split from hot)
 * PASTRY_PASS   — Pastry/snack pass-through (CS-5 only — display-case items)
 */
export const STATION_KINDS = [
  'COUNTER',
  'BAR',
  'KITCHEN',
  'HOT_BAR',
  'COLD_BAR',
  'PASTRY_PASS',
] as const;
export type StationKind = (typeof STATION_KINDS)[number];

// ── Per-tier structural template ────────────────────────────────────────────

export interface LayoutStationSpec {
  kind:       StationKind;
  /** Default station name shown to staff. Owner can rename, structure stays. */
  defaultName: string;
  /** Default categories (by name) that route to this station on first setup. */
  defaultCategories: string[];
  /** Whether this station shows a Kitchen Display Screen (KDS). */
  hasKds: boolean;
  /** Whether this station has its own printer separate from the receipt printer. */
  hasPrinter: boolean;
}

export interface CoffeeShopLayoutTemplate {
  tier:           CoffeeShopTier;
  /** Marketing-friendly name. */
  name:           string;
  /** One-line summary for tier-picker UI. */
  tagline:        string;
  /** Real-world examples — helps owners self-identify. */
  examples:       string[];
  /** Number of cashier tablets supported by this tier. */
  cashierTablets: number;
  /**
   * Whether a customer-facing display is part of the canonical setup.
   * For CS_1 this is `false` by default but can be toggled on per the
   * "CS-1 optional customer display" decision.
   */
  hasCustomerDisplay: boolean;
  /**
   * If true, the customer display is OPTIONAL — owner can toggle it on/off
   * even though the canonical setup wouldn't include it. CS-1 only.
   */
  customerDisplayOptional?: boolean;
  /** Whether the tier supports multiple cashier terminals (POS-01, POS-02, ...) */
  multiTerminal: boolean;
  /** Stations owned by this tier — locked. Cannot be added to or removed from. */
  stations: readonly LayoutStationSpec[];
  /**
   * Routing strategy when multiple cashiers/orders feed the same station.
   * SHARED_FIFO = one queue, oldest-first (CS-5).
   * SINGLE      = only one cashier feeds this station (CS-1..CS-4).
   */
  queueStrategy: 'SINGLE' | 'SHARED_FIFO';
}

// ── The 5 locked templates ──────────────────────────────────────────────────

export const COFFEE_SHOP_LAYOUTS: Record<CoffeeShopTier, CoffeeShopLayoutTemplate> = {
  CS_1: {
    tier: 'CS_1',
    name: 'Solo Counter',
    tagline: 'Owner-operated. Counter is the bar — coffee made where you pay.',
    examples: ["Lola's home brew", 'Food cart', 'Sari-sari with espresso'],
    cashierTablets: 1,
    hasCustomerDisplay: false,
    customerDisplayOptional: true,
    multiTerminal: false,
    queueStrategy: 'SINGLE',
    stations: [
      {
        kind: 'COUNTER',
        defaultName: 'Counter',
        defaultCategories: ['Hot Coffee', 'Cold Coffee', 'Specialty', 'Tea', 'Pastries'],
        hasKds: false,    // single-person op — no need for a queue display
        hasPrinter: false, // receipt printer only
      },
    ],
  },

  CS_2: {
    tier: 'CS_2',
    name: 'Counter + Customer Display',
    tagline: 'Casual neighborhood café. Small team, one prep area.',
    examples: ["Tita's Café", '2-person home-style coffee shops'],
    cashierTablets: 1,
    hasCustomerDisplay: true,
    multiTerminal: false,
    queueStrategy: 'SINGLE',
    stations: [
      {
        kind: 'COUNTER',
        defaultName: 'Counter',
        defaultCategories: ['Hot Coffee', 'Cold Coffee', 'Specialty', 'Tea', 'Pastries'],
        hasKds: false,
        hasPrinter: false,
      },
    ],
  },

  CS_3: {
    tier: 'CS_3',
    name: 'Counter + Bar Station',
    tagline: 'Specialty coffee shop. Cashier and barista are different people.',
    examples: ['EDSA Beverage Design', 'Yardstick', 'Tom & Cake', 'most third-wave shops'],
    cashierTablets: 1,
    hasCustomerDisplay: true,
    multiTerminal: false,
    queueStrategy: 'SINGLE',
    stations: [
      {
        kind: 'BAR',
        defaultName: 'Bar',
        defaultCategories: ['Hot Coffee', 'Cold Coffee', 'Specialty', 'Tea'],
        hasKds: true,
        hasPrinter: true,
      },
    ],
  },

  CS_4: {
    tier: 'CS_4',
    name: 'Café with Bar + Kitchen',
    tagline: 'Café-restaurant hybrid. Drinks and food prepped separately.',
    examples: ['Wildflour', 'Pancake House cafés', 'brunch spots'],
    cashierTablets: 2,
    hasCustomerDisplay: true,
    multiTerminal: true,
    queueStrategy: 'SINGLE',
    stations: [
      {
        kind: 'BAR',
        defaultName: 'Bar',
        defaultCategories: ['Hot Coffee', 'Cold Coffee', 'Specialty', 'Tea'],
        hasKds: true,
        hasPrinter: true,
      },
      {
        kind: 'KITCHEN',
        defaultName: 'Kitchen',
        defaultCategories: ['Pastries', 'Sandwiches', 'Mains', 'Breakfast'],
        hasKds: true,
        hasPrinter: true,
      },
    ],
  },

  CS_5: {
    tier: 'CS_5',
    name: 'Multi-Station Chain',
    tagline: 'High-volume operation. Hot/cold drinks split, kitchen, pastry pass.',
    examples: ['McCafé', 'Starbucks Reserve', 'hotel cafés', 'mall food court chains'],
    cashierTablets: 3,
    hasCustomerDisplay: true,
    multiTerminal: true,
    queueStrategy: 'SHARED_FIFO',
    stations: [
      {
        kind: 'HOT_BAR',
        defaultName: 'Hot Bar',
        defaultCategories: ['Hot Coffee', 'Specialty', 'Tea'],
        hasKds: true,
        hasPrinter: true,
      },
      {
        kind: 'COLD_BAR',
        defaultName: 'Cold Bar',
        defaultCategories: ['Cold Coffee', 'Frappes', 'Iced Drinks'],
        hasKds: true,
        hasPrinter: true,
      },
      {
        kind: 'KITCHEN',
        defaultName: 'Kitchen',
        defaultCategories: ['Sandwiches', 'Mains', 'Breakfast', 'Hot Food'],
        hasKds: true,
        hasPrinter: true,
      },
      {
        kind: 'PASTRY_PASS',
        defaultName: 'Pastry Pass',
        defaultCategories: ['Pastries', 'Cakes', 'Display Case'],
        hasKds: false,    // pastries are pre-made — no queue, just a print slip
        hasPrinter: true,
      },
    ],
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the layout template for a coffee shop tier. Pure lookup — used by
 * setup wizard, station provisioner, and any UI that needs to know what
 * stations/screens/printers a tier supports.
 */
export function getCoffeeShopLayout(tier: CoffeeShopTier): CoffeeShopLayoutTemplate {
  return COFFEE_SHOP_LAYOUTS[tier];
}

/**
 * The "next tier up" — used to render the upgrade-to-higher-CS prompt.
 * Returns null when already at the top tier.
 */
export function nextCoffeeShopTier(tier: CoffeeShopTier): CoffeeShopTier | null {
  const idx = COFFEE_SHOP_TIERS.indexOf(tier);
  if (idx < 0 || idx >= COFFEE_SHOP_TIERS.length - 1) return null;
  return COFFEE_SHOP_TIERS[idx + 1];
}

/**
 * Given a category name (e.g., "Hot Coffee"), find which station should
 * receive its order tickets in the given tier. Falls back to the first
 * station when no match — guarantees orders never get lost.
 */
export function defaultStationForCategory(
  tier: CoffeeShopTier,
  categoryName: string,
): LayoutStationSpec {
  const layout = getCoffeeShopLayout(tier);
  const match = layout.stations.find((s) =>
    s.defaultCategories.some((c) => c.toLowerCase() === categoryName.toLowerCase()),
  );
  return match ?? layout.stations[0];
}
