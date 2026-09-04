/**
 * Persona Templates — Multi-Hat Role Bundles
 *
 * Real Philippine MSMEs hire one person to do multiple things.  A "Cashier
 * who also handles inventory" doesn't fit cleanly into either CASHIER (no
 * inventory access) or WAREHOUSE_STAFF (no POS access).
 *
 * A persona is a NAMED BUNDLE of:
 *   1. A base UserRole       (drives default app access + role-gated endpoints)
 *   2. App-access overrides  (deltas vs DEFAULT_APP_ACCESS for that role)
 *   3. Permission grants     (extra PermissionKeys beyond the role's defaults
 *                             in the PERMISSION_MATRIX)
 *
 * Personas are **NOT** stored in the database.  They live as TypeScript
 * constants here, single source of truth.  The User model stores only:
 *   - role           (the base role)
 *   - personaKey     (which template was applied — for "reset" + analytics)
 *   - customPermissions[]   (any further owner-toggled extras beyond the persona)
 *
 * UI workflow:
 *   1. Owner picks a persona at staff creation     → fields populated
 *   2. Owner optionally enters Advanced mode       → toggles individual perms
 *   3. SOD engine evaluates the final combination  → may warn or block
 *   4. On save: store role + personaKey + customPermissions
 *
 * Adding new personas: append to PERSONAS below.  Keep `key` stable (used as
 * a foreign-key string).  Display labels are mutable.
 */

import type { UserRole, AppAccessEntry } from './auth';
import type { PermissionKey } from './permissions';
import type { StationKind } from './layouts';

export type PersonaKey =
  | 'OWNER_OPERATOR'
  | 'CASHIER_BASIC'
  | 'CASHIER_COOK'
  | 'CASHIER_INVENTORY'
  | 'SENIOR_CASHIER'
  | 'BRANCH_MANAGER_DEFAULT'
  | 'BOOKKEEPER_DEFAULT'
  | 'BOOKKEEPER_AR_CLERK'
  | 'INVENTORY_MANAGER'
  | 'PAYROLL_OFFICER'
  | 'GENERAL_EMPLOYEE_DEFAULT'
  | 'EXTERNAL_AUDITOR_DEFAULT'
  | 'BARISTA'
  | 'LINE_COOK';

export interface PersonaTemplate {
  key: PersonaKey;
  /** Human-readable label shown in the persona picker dropdown. */
  displayName: string;
  /** Short description rendered as helper text under the dropdown. */
  description: string;
  /** Base role this persona is built on top of. */
  baseRole: UserRole;
  /**
   * App-access overrides relative to DEFAULT_APP_ACCESS for the base role.
   * Only list entries that DIFFER from the default.  Empty array = use defaults.
   */
  appAccessOverrides: AppAccessEntry[];
  /**
   * Extra permissions granted on TOP of what the base role gets via
   * PERMISSION_MATRIX.  These are the deltas that make the persona "multi-hat".
   * Empty array = pure base-role permissions.
   */
  extraPermissions: PermissionKey[];
  /**
   * Optional: which BusinessType this persona is most relevant for.
   * Used by the persona picker to surface relevant options first.
   * Empty = relevant for all business types.
   */
  relevantFor: ('FNB' | 'RETAIL' | 'SERVICE' | 'MANUFACTURING')[];
  /**
   * Whether this persona requires BUSINESS_OWNER assignment (some personas
   * touch sensitive data and should only be assignable by the owner).
   */
  requiresOwnerAssignment: boolean;
  /**
   * Which prep stations this persona works, if it is tied to one.
   *
   * A cafe's kitchen and bar both prep ahead, and until now every account that
   * could record a batch could record ANY batch: a barista could book the
   * spaghetti sauce, a cook could book the syrup. Nothing was stolen by that,
   * but the record of who used which ingredients — the whole point of
   * attributing prep to a station — was only as good as everyone remembering
   * to pick the right one from a list.
   *
   * OMITTED means every station, which is what all twelve existing personas
   * mean and what every account with no persona at all means. So this changes
   * nothing for anyone until an owner deliberately hires someone as a barista
   * or a line cook.
   */
  prepStationKinds?: StationKind[];
}

export const PERSONAS: Record<PersonaKey, PersonaTemplate> = {
  // ── Owner-Operator ─────────────────────────────────────────────────────────
  // Available at every tier — the owner is always present.  Capabilities expand
  // automatically as tier upgrades unlock more features.
  OWNER_OPERATOR: {
    key: 'OWNER_OPERATOR',
    displayName: 'Owner-Operator',
    description: 'Solo owner running the till, books, and back office. Full access by default.',
    baseRole: 'BUSINESS_OWNER',
    appAccessOverrides: [],
    extraPermissions: [],
    relevantFor: [],
    requiresOwnerAssignment: false,
  },

  // ── Cashier variants ───────────────────────────────────────────────────────
  // T2+ — first staff slot opens at Duo (Owner+1).
  CASHIER_BASIC: {
    key: 'CASHIER_BASIC',
    displayName: 'Cashier',
    description: 'Pure cashier — sells, opens/closes shift, takes payment. Voids require supervisor.',
    baseRole: 'CASHIER',
    appAccessOverrides: [],
    extraPermissions: [],
    relevantFor: [],
    requiresOwnerAssignment: false,
  },
  CASHIER_COOK: {
    key: 'CASHIER_COOK',
    displayName: 'Cashier + Cook',
    description: 'F&B staff who takes orders AND prepares them. Sees inventory levels but cannot adjust.',
    baseRole: 'CASHIER',
    appAccessOverrides: [],
    extraPermissions: ['inventory:view'],
    relevantFor: ['FNB'],
    requiresOwnerAssignment: false,
  },
  CASHIER_INVENTORY: {
    key: 'CASHIER_INVENTORY',
    displayName: 'Cashier + Inventory',
    description: 'Mini-mart clerk who runs the till and restocks. Can adjust inventory.',
    baseRole: 'CASHIER',
    appAccessOverrides: [],
    extraPermissions: ['inventory:view', 'inventory:adjust'],
    relevantFor: ['RETAIL'],
    requiresOwnerAssignment: false,
  },
  SENIOR_CASHIER: {
    key: 'SENIOR_CASHIER',
    displayName: 'Senior Cashier',
    description: 'Experienced cashier with direct void authority and discount approval. Supervises junior cashiers.',
    baseRole: 'SALES_LEAD',
    appAccessOverrides: [],
    extraPermissions: [],
    relevantFor: [],
    requiresOwnerAssignment: false,
  },

  // ── Branch Manager ─────────────────────────────────────────────────────────
  // T3+ — manager-level oversight starts when the team is large enough to need one.
  BRANCH_MANAGER_DEFAULT: {
    key: 'BRANCH_MANAGER_DEFAULT',
    displayName: 'Branch Manager',
    description: 'Manages a single branch — staff, voids, settlement, EOD. Reads ledger, no journal entries.',
    baseRole: 'BRANCH_MANAGER',
    appAccessOverrides: [],
    extraPermissions: [],
    relevantFor: [],
    requiresOwnerAssignment: false,
  },

  // ── Bookkeeper variants ────────────────────────────────────────────────────
  // T3+ for the basic Bookkeeper (read-only ledger access at T3, full posting at T4+).
  // T4+ for the AR-Clerk variant which needs ar:full feature unlocked at T4.
  BOOKKEEPER_DEFAULT: {
    key: 'BOOKKEEPER_DEFAULT',
    displayName: 'Bookkeeper',
    description: 'Posts journal entries and runs ledger reports. Cannot close periods or run payroll.',
    baseRole: 'BOOKKEEPER',
    // Bookkeeper baseline is POS:NONE; sometimes they need to see today's sales summary.
    appAccessOverrides: [{ app: 'POS', level: 'READ_ONLY' }],
    extraPermissions: ['ledger:export'],
    relevantFor: [],
    requiresOwnerAssignment: false,
  },
  BOOKKEEPER_AR_CLERK: {
    key: 'BOOKKEEPER_AR_CLERK',
    displayName: 'Bookkeeper + AR Clerk',
    description: 'Bookkeeper who also manages B2B customer invoices and collections.',
    baseRole: 'BOOKKEEPER',
    appAccessOverrides: [{ app: 'POS', level: 'READ_ONLY' }],
    extraPermissions: [
      'ledger:export',
      // Future: 'ar:create_customer', 'ar:collect' once Phase 4 lands.
    ],
    relevantFor: [],
    requiresOwnerAssignment: false,
  },

  // ── Inventory Manager ──────────────────────────────────────────────────────
  // T4+ — dedicated inventory role makes sense at Squad scale where there's a back room.
  INVENTORY_MANAGER: {
    key: 'INVENTORY_MANAGER',
    displayName: 'Inventory Manager',
    description: 'Owns stock movement, raw materials, low-stock thresholds. No POS sales access.',
    baseRole: 'WAREHOUSE_STAFF',
    appAccessOverrides: [{ app: 'POS', level: 'READ_ONLY' }],
    extraPermissions: ['inventory:set_threshold'],
    relevantFor: ['RETAIL', 'MANUFACTURING', 'FNB'],
    requiresOwnerAssignment: false,
  },

  // ── Payroll Officer ────────────────────────────────────────────────────────
  // T5+ — payroll:full feature flag is required.
  PAYROLL_OFFICER: {
    key: 'PAYROLL_OFFICER',
    displayName: 'Payroll Officer',
    description: 'Sees salary columns and runs payroll. ONLY the Business Owner can assign this persona.',
    baseRole: 'PAYROLL_MASTER',
    appAccessOverrides: [],
    extraPermissions: [],
    relevantFor: [],
    requiresOwnerAssignment: true,
  },

  // ── General Employee ───────────────────────────────────────────────────────
  // T2+ — first staff slot.
  GENERAL_EMPLOYEE_DEFAULT: {
    key: 'GENERAL_EMPLOYEE_DEFAULT',
    displayName: 'General Employee',
    description: 'Clock-in/out only. Files expense claims. Cooks, dishwashers, runners, helpers.',
    baseRole: 'GENERAL_EMPLOYEE',
    appAccessOverrides: [],
    extraPermissions: [],
    relevantFor: [],
    requiresOwnerAssignment: false,
  },

  // ── External Auditor ───────────────────────────────────────────────────────
  // T6 only — audit:log feature flag is required.
  // ── Bar and kitchen ────────────────────────────────────────────────────────
  // The two jobs in a cafe that PREP, kept apart so each one's board shows
  // their own work. Both are ordinary front-line accounts otherwise.
  BARISTA: {
    key: 'BARISTA',
    displayName: 'Barista',
    description: 'Runs the bar: takes orders, and preps the bar\u2019s syrups and cold brew. Kitchen preps are not theirs to record.',
    // A barista at Cafe Carolina IS the cashier -- there is no separate till
    // person -- so this is built on CASHIER rather than GENERAL_EMPLOYEE.
    baseRole: 'CASHIER',
    appAccessOverrides: [],
    extraPermissions: ['inventory:view'],
    relevantFor: ['FNB'],
    requiresOwnerAssignment: false,
    /*
      Every station where drinks get made, INCLUDING the plain counter.

      The first version listed BAR / HOT_BAR / COLD_BAR, reading the station
      enum's comments rather than the floor plans. Checked against
      COFFEE_SHOP_LAYOUTS, that was wrong in both directions: no tier creates
      HOT_BAR or COLD_BAR at all, and the two SMALLEST tiers -- CS-1 and CS-2,
      the shops most likely to have exactly one barista -- create only a
      COUNTER. So a barista at a one-counter shop would have opened a blank
      prep board and been refused every batch by the server.

      COUNTER is safe to include: no tier creates a COUNTER alongside a BAR, so
      where it exists it IS the bar. HOT_BAR and COLD_BAR are kept because the
      enum documents them as the CS-5 split and a shop may yet be moved onto
      them by hand.
    */
    prepStationKinds: ['COUNTER', 'BAR', 'HOT_BAR', 'COLD_BAR'],
  },
  LINE_COOK: {
    key: 'LINE_COOK',
    displayName: 'Line cook',
    description: 'Works the kitchen: preps the sauces, stocks and bases. Does not run the till.',
    baseRole: 'GENERAL_EMPLOYEE',
    appAccessOverrides: [],
    extraPermissions: ['inventory:view'],
    relevantFor: ['FNB'],
    requiresOwnerAssignment: false,
    /*
      The food side. PASTRY_PASS is a real station -- CS-5 creates one -- and
      leaving it out meant a bakery's pastry preps were refused to the very
      people who make them.
    */
    prepStationKinds: ['KITCHEN', 'PASTRY_PASS'],
  },

  EXTERNAL_AUDITOR_DEFAULT: {
    key: 'EXTERNAL_AUDITOR_DEFAULT',
    displayName: 'External Auditor',
    description: 'Read-only compliance access for visiting BIR auditors or external accountants.',
    baseRole: 'EXTERNAL_AUDITOR',
    appAccessOverrides: [],
    extraPermissions: [],
    relevantFor: [],
    requiresOwnerAssignment: true,
  },
};

/**
 * List all personas that match a given business type, sorted with most-relevant
 * first.  Personas with empty `relevantFor` are considered universal and appear
 * after type-specific ones.  Used by the persona picker dropdown.
 */
export function personasForBusinessType(
  businessType: 'FNB' | 'RETAIL' | 'SERVICE' | 'MANUFACTURING',
): PersonaTemplate[] {
  const all = Object.values(PERSONAS);
  const specific = all.filter((p) => p.relevantFor.includes(businessType));
  const universal = all.filter((p) => p.relevantFor.length === 0);
  return [...specific, ...universal];
}

/**
 * Compute the FULL effective permission set for a user given:
 *  - their persona (which provides extraPermissions on top of base role)
 *  - their owner-toggled customPermissions (Advanced-mode overrides)
 *
 * Returns a deduplicated list of PermissionKey strings.  This is the list
 * that should be embedded in the JWT and consulted by `hasPermission()`
 * via the customPermissions overlay.
 *
 * Note: this returns ONLY the EXTRA permissions beyond the role's
 * PERMISSION_MATRIX defaults.  The base-role check still happens via
 * the existing `hasPermission()` against PERMISSION_MATRIX.
 */
export function computeExtraPermissions(
  personaKey: PersonaKey | null | undefined,
  customPermissions: PermissionKey[] | null | undefined,
): PermissionKey[] {
  const fromPersona =
    personaKey && PERSONAS[personaKey]
      ? PERSONAS[personaKey].extraPermissions
      : [];
  const custom = customPermissions ?? [];
  const merged = new Set<PermissionKey>([...fromPersona, ...custom]);
  return Array.from(merged);
}

/* ─── Persona listing ─────────────────────────────────────────────────────── */

/**
 * Every persona, including OWNER_OPERATOR.
 *
 * Personas used to be gated by a `minTier` floor against the TIER_1..TIER_6
 * ladder. That ladder is retired and there is one package, so every template
 * is offered to everyone. The gating functions (isPersonaAvailableAtTier,
 * listAvailablePersonas(tier), listHiringPersonas(tier)) had no callers in
 * any app — the pickers already listed personas unfiltered.
 */
export function listAvailablePersonas(): PersonaTemplate[] {
  return Object.values(PERSONAS);
}

/**
 * Personas appropriate for HIRING staff.
 *
 * Excludes OWNER_OPERATOR (the owner already exists; you don't "hire" them).
 * Used by the Staff Edit modal's persona dropdown.
 */
export function listHiringPersonas(): PersonaTemplate[] {
  return listAvailablePersonas().filter((p) => p.key !== 'OWNER_OPERATOR');
}

export function listHiringPersonasForTenant(
  businessType: 'FNB' | 'RETAIL' | 'SERVICE' | 'MANUFACTURING',
): PersonaTemplate[] {
  const all = listHiringPersonas();
  const specific = all.filter((p) => p.relevantFor.includes(businessType));
  const universal = all.filter((p) => p.relevantFor.length === 0);
  return [...specific, ...universal];
}

/* ─── Prep station scope ──────────────────────────────────────── */

/**
 * Which prep stations this person may record batches for.
 *
 * `null` means EVERY station, and that is the answer for every account that
 * existed before this: the twelve original personas carry no station scope,
 * and most staff have no persona at all. Restricting is opt-in, one hire at a
 * time, which is the only safe default — a rule that silently narrowed what
 * existing staff could do would strand a cook at 7am with a blank screen.
 *
 * Exported from here rather than written twice so the list a barista SEES and
 * the rule the server ENFORCES cannot drift apart.
 */
export function prepStationKindsFor(
  personaKey: string | null | undefined,
): StationKind[] | null {
  if (!personaKey) return null;
  const persona = PERSONAS[personaKey as PersonaKey];
  if (!persona) return null;
  const kinds = persona.prepStationKinds;
  return kinds && kinds.length > 0 ? kinds : null;
}

/**
 * May this person record a batch for a prep at `stationKind`?
 *
 * A prep with NO station — one whose category was never routed, or one that
 * genuinely feeds both the bar and the kitchen — is allowed to everyone.
 * Hiding those would be the cruel reading: a shop that has not finished
 * routing its menu would hand its cook an empty prep board and conclude the
 * feature is broken. An unrouted prep is a setup gap, not a permission
 * boundary.
 */
export function canPrepAtStation(
  personaKey: string | null | undefined,
  stationKind: string | null | undefined,
  /**
   * Every station kind this shop actually has, when the caller knows them.
   *
   * The backstop against a floor plan nobody anticipated. Widening the lists
   * above fixed the shapes that exist TODAY, but the lists are still a guess
   * about how a shop is laid out, and a guess that is wrong hands somebody an
   * empty screen and a refusal on every tap -- the most expensive way for a
   * rule to be wrong, because it looks like the feature is broken.
   *
   * So: if a persona's stations do not overlap this shop's stations AT ALL,
   * the scope is meaningless here and is not applied. A rule that would hide
   * everything is a rule that was written for a different shop.
   */
  shopStationKinds?: readonly string[] | null,
): boolean {
  const allowed = prepStationKindsFor(personaKey);
  if (!allowed) return true;
  if (!stationKind) return true;
  if (shopStationKinds && shopStationKinds.length > 0) {
    const overlaps = shopStationKinds.some((k) => allowed.includes(k as StationKind));
    if (!overlaps) return true;
  }
  return allowed.includes(stationKind as StationKind);
}
