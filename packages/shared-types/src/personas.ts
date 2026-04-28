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
import type { TierId } from './tiers';

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
  | 'EXTERNAL_AUDITOR_DEFAULT';

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
   * Minimum subscription tier where this persona is offered as a quick-start
   * template.  The persona's permissions must all be exercisable at this tier
   * (verifiable via verifyPersonaTierConsistency() helper).
   *
   * NOTE: a persona with `minTier=TIER_3` is OFFERED as a template at T3+,
   * but the template's INTRINSIC capabilities can grow when the tenant
   * upgrades.  Example: BOOKKEEPER_DEFAULT.minTier=TIER_3 — at T3 the
   * Bookkeeper sees read-only ledger; at T4 the same persona's user gains
   * journal-entry posting because the tier feature flag activates.
   */
  minTier: TierId;
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
    minTier: 'TIER_1',
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
    minTier: 'TIER_2',
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
    minTier: 'TIER_2',
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
    minTier: 'TIER_2',
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
    minTier: 'TIER_2',
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
    minTier: 'TIER_3',
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
    minTier: 'TIER_3',
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
    minTier: 'TIER_4',
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
    minTier: 'TIER_4',
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
    minTier: 'TIER_5',
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
    minTier: 'TIER_2',
  },

  // ── External Auditor ───────────────────────────────────────────────────────
  // T6 only — audit:log feature flag is required.
  EXTERNAL_AUDITOR_DEFAULT: {
    key: 'EXTERNAL_AUDITOR_DEFAULT',
    displayName: 'External Auditor',
    description: 'Read-only compliance access for visiting BIR auditors or external accountants.',
    baseRole: 'EXTERNAL_AUDITOR',
    appAccessOverrides: [],
    extraPermissions: [],
    relevantFor: [],
    requiresOwnerAssignment: true,
    minTier: 'TIER_6',
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

/* ─── Tier-aware persona filtering (Option 6) ──────────────────────────────── */

/** Internal: tier ordering for "is X >= Y" comparisons. */
const TIER_ORDER: TierId[] = [
  'TIER_1',
  'TIER_2',
  'TIER_3',
  'TIER_4',
  'TIER_5',
  'TIER_6',
];

/**
 * Check if a persona is offered as a quick-start template at the given tier.
 *
 * A persona is available iff `tenantTier >= persona.minTier`.  Owners on
 * higher tiers see all lower-tier personas plus their own tier's additions.
 */
export function isPersonaAvailableAtTier(
  personaKey: PersonaKey,
  tier: TierId,
): boolean {
  const persona = PERSONAS[personaKey];
  if (!persona) return false;
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(persona.minTier);
}

/**
 * List all personas (including OWNER_OPERATOR) available as templates at a
 * given tier.  Used by tier-aware admin views and the onboarding wizard.
 */
export function listAvailablePersonas(tier: TierId): PersonaTemplate[] {
  return Object.values(PERSONAS).filter((p) =>
    isPersonaAvailableAtTier(p.key, tier),
  );
}

/**
 * List personas appropriate for HIRING staff at a given tier.
 *
 * Excludes OWNER_OPERATOR (the owner already exists; you don't "hire" them).
 * Used by the Staff Edit modal's persona dropdown to populate the choices
 * an owner sees when adding a new team member.
 */
export function listHiringPersonas(tier: TierId): PersonaTemplate[] {
  return listAvailablePersonas(tier).filter((p) => p.key !== 'OWNER_OPERATOR');
}

/**
 * Filter personas BOTH by tier AND by business type.  Type-specific personas
 * appear first, then universal ones.  This is the primary "what should the
 * picker show?" helper for the staff creation flow.
 */
export function listHiringPersonasForTenant(
  tier: TierId,
  businessType: 'FNB' | 'RETAIL' | 'SERVICE' | 'MANUFACTURING',
): PersonaTemplate[] {
  const tierFiltered = listHiringPersonas(tier);
  const specific = tierFiltered.filter((p) => p.relevantFor.includes(businessType));
  const universal = tierFiltered.filter((p) => p.relevantFor.length === 0);
  return [...specific, ...universal];
}
