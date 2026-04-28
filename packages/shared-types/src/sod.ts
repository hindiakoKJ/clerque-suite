/**
 * Segregation-of-Duties (SOD) Detection Engine
 *
 * SOD rules describe permission combinations that:
 *   - 🔴 BLOCK: are flat-out incompatible with sound internal control (e.g.,
 *               same person posts journal entries AND closes the period —
 *               total compliance fail).  The UI must prevent saving these.
 *   - 🟡 WARN:  are unusual but legal under specific small-business
 *               circumstances (e.g., owner-operator who is also the cashier).
 *               The UI shows a confirmation modal; the owner can override
 *               with a typed reason; the override is recorded in AuditLog.
 *
 * BUSINESS_OWNER is exempt from SOD warnings on themselves — by definition
 * they are the audited party and can do anything within their tenant.
 *
 * This file is consumed by:
 *   - Frontend: live SOD evaluation in the staff edit modal
 *   - Backend:  re-validation on PATCH /users/:id at write time
 *               (defense in depth — never trust the client)
 *
 * Adding a new rule: append to SOD_RULES.  Keep `key` stable (used as a
 * machine identifier in audit logs).  `description` and `recommendation`
 * are user-facing copy and may be tuned.
 */

import type { UserRole } from './auth';
import type { PermissionKey } from './permissions';

export type SODSeverity = 'BLOCK' | 'WARN';

export interface SODRule {
  /** Stable machine-readable identifier (used in audit log entries). */
  key: string;
  severity: SODSeverity;
  /**
   * The permission combination that triggers this rule.  All keys must be
   * present together for the rule to fire.
   */
  conflictingPermissions: PermissionKey[];
  /**
   * One-sentence description of WHAT the rule catches.  Shown as the modal
   * title.  Avoid jargon; an MSME owner is the reader.
   */
  description: string;
  /**
   * Longer explanation of WHY the combination is risky.  Shown in the modal
   * body.  Tie to compliance / audit framing where relevant.
   */
  rationale: string;
  /**
   * Concrete suggestion for an alternative.  Shown as the call-to-action.
   * Should help the owner solve the same problem the right way.
   */
  recommendation: string;
  /**
   * Roles that are EXEMPT from this rule.  BUSINESS_OWNER is implicitly
   * exempt from all rules and need not be listed.
   */
  exemptRoles?: UserRole[];
}

export const SOD_RULES: SODRule[] = [
  // ── Cash handling (highest fraud risk) ─────────────────────────────────────
  {
    key: 'self_void_unsupervised',
    severity: 'WARN',
    conflictingPermissions: ['order:create', 'order:void_direct'],
    description: 'Cashier with direct void authority',
    rationale:
      'A staff member who can both create AND void orders without supervisor approval can erase a sale and pocket the cash. ' +
      'Most businesses require a supervisor (SALES_LEAD or BRANCH_MANAGER) to approve voids. ' +
      'Granting both to the same person weakens the cash-handling control.',
    recommendation:
      'Consider keeping order:void_direct on a SALES_LEAD or BRANCH_MANAGER, and using order:void_supervised (which requires supervisor entry) on cashiers.',
  },
  {
    key: 'self_price_self_sell',
    severity: 'WARN',
    conflictingPermissions: ['product:edit_price', 'order:create'],
    description: 'Same person sets prices AND rings up sales',
    rationale:
      'A cashier who can edit prices can manipulate the unit price at sale time. ' +
      'Best practice is to keep pricing authority on the BUSINESS_OWNER or MDM and read-only at the till.',
    recommendation:
      'Keep product:edit_price on BUSINESS_OWNER or MDM only.  Cashiers can suggest a manager-override discount per transaction instead.',
  },
  {
    key: 'self_inventory_self_sell',
    severity: 'WARN',
    conflictingPermissions: ['inventory:adjust', 'order:create'],
    description: 'Same person adjusts inventory AND rings up sales',
    rationale:
      'A cashier who can adjust inventory can hide shrinkage by writing off the same items they failed to ring up. ' +
      'Inventory adjustments are usually owned by a BRANCH_MANAGER, MDM, or WAREHOUSE_STAFF.',
    recommendation:
      'Move inventory:adjust to a non-selling role.  If you really need this combination (small biz reality), document it in the audit reason.',
  },

  // ── Ledger / period close (BIR-critical) ───────────────────────────────────
  {
    key: 'post_and_close_period',
    severity: 'BLOCK',
    conflictingPermissions: ['ledger:journal_entry', 'ledger:period_close'],
    description: 'Same person posts journal entries AND closes the period',
    rationale:
      'This is a hard SOD violation and will fail any external audit. ' +
      'A bookkeeper who can also close the period can post entries to bury errors then lock the books before they are caught. ' +
      'The same person CANNOT both post AND seal — without exception.',
    recommendation:
      'Period closure is reserved for BUSINESS_OWNER and ACCOUNTANT.  Bookkeepers may post but not close.  This rule cannot be overridden.',
  },
  {
    key: 'post_and_reopen_period',
    severity: 'BLOCK',
    conflictingPermissions: ['ledger:journal_entry', 'ledger:period_reopen'],
    description: 'Same person posts journal entries AND can reopen closed periods',
    rationale:
      'Reopening a closed period after entries are posted defeats the purpose of period locks.  This is treated as a BIR audit fail.',
    recommendation:
      'Period reopen authority should sit with BUSINESS_OWNER only, separately from anyone with journal entry rights.',
  },

  // ── Payroll (sensitive personal data) ──────────────────────────────────────
  {
    key: 'payroll_edit_and_run_unowner',
    severity: 'WARN',
    conflictingPermissions: ['payroll:edit', 'payroll:run'],
    description: 'Same person edits salary AND runs payroll',
    rationale:
      'Combining payroll edit and run on a single non-owner staff member means there is no second pair of eyes before salaries hit bank accounts. ' +
      'Most businesses split: PAYROLL_MASTER edits, BUSINESS_OWNER runs (or vice versa).',
    recommendation:
      'Keep one of payroll:edit or payroll:run on BUSINESS_OWNER for cross-checking.',
    exemptRoles: ['BUSINESS_OWNER'],
  },

  // ── Privilege escalation (own-promotion attack) ────────────────────────────
  {
    key: 'self_create_self_promote',
    severity: 'BLOCK',
    conflictingPermissions: ['staff:create', 'staff:assign_payroll_master'],
    description: 'Same non-owner can create users AND assign sensitive roles',
    rationale:
      'A staff member with both staff:create and staff:assign_payroll_master could create a new user, assign them PAYROLL_MASTER, ' +
      'log in as that user, and bypass the owner.  This is a privilege-escalation path that cannot exist on a non-owner.',
    recommendation:
      'staff:assign_payroll_master is BUSINESS_OWNER-only.  Cannot be overridden.',
  },
  {
    key: 'self_create_self_assign_mdm',
    severity: 'BLOCK',
    conflictingPermissions: ['staff:create', 'staff:assign_mdm'],
    description: 'Same non-owner can create users AND assign MDM',
    rationale:
      'Same logic as the payroll-master escalation: granting both lets a non-owner self-grant master-data control by proxy.',
    recommendation:
      'staff:assign_mdm is BUSINESS_OWNER-only.  Cannot be overridden.',
  },

  // ── Auditor independence ───────────────────────────────────────────────────
  {
    key: 'auditor_with_writes',
    severity: 'WARN',
    conflictingPermissions: ['audit:view', 'order:create'],
    description: 'Auditor with write permissions',
    rationale:
      'An external auditor is supposed to be independent of operations.  Granting write permissions to someone with audit:view ' +
      'compromises that independence.  Internal compliance-only auditors may be exempt.',
    recommendation:
      'Use the EXTERNAL_AUDITOR_DEFAULT persona which is read-only.  If this is an internal compliance person, grant audit:view but no operational writes.',
  },
  {
    key: 'auditor_with_journal_writes',
    severity: 'WARN',
    conflictingPermissions: ['audit:view', 'ledger:journal_entry'],
    description: 'Auditor with journal-entry rights',
    rationale: 'Auditors should not be able to modify the books they are auditing.',
    recommendation:
      'If this user audits, do not grant ledger:journal_entry.  If they bookkeep, do not grant audit:view.',
  },

  // ── Bank reconciliation collision ──────────────────────────────────────────
  {
    key: 'bank_recon_and_sell',
    severity: 'WARN',
    conflictingPermissions: ['finance:bank_recon', 'order:create'],
    description: 'Cashier reconciling their own till against the bank',
    rationale:
      'The person who handled the cash should not be the one matching it to the bank deposit.  ' +
      'Bank reconciliation is owned by FINANCE_LEAD or BUSINESS_OWNER.',
    recommendation:
      'Move finance:bank_recon to a non-selling role.',
  },
];

export interface SODViolation {
  rule: SODRule;
  /** The permission keys (intersection) that triggered the rule. */
  triggered: PermissionKey[];
}

/**
 * Detect all SOD violations for a given user's effective permission set.
 *
 * @param role         The user's base role.
 * @param permissions  The FULL effective permission set — base role permissions
 *                     UNION extraPermissions from persona UNION customPermissions
 *                     from Advanced overrides.  Compute via the helpers in
 *                     personas.ts + permissions.ts before calling this.
 * @returns All matching SODRule + the conflicting permissions present.
 *          Empty array = no violations.
 */
export function detectViolations(
  role: UserRole,
  permissions: PermissionKey[],
): SODViolation[] {
  // Owner is exempt from all rules.
  if (role === 'BUSINESS_OWNER' || role === 'SUPER_ADMIN') return [];

  const set = new Set(permissions);
  const violations: SODViolation[] = [];

  for (const rule of SOD_RULES) {
    if (rule.exemptRoles?.includes(role)) continue;

    // Rule fires only if ALL conflicting permissions are present together.
    const allPresent = rule.conflictingPermissions.every((p) => set.has(p));
    if (!allPresent) continue;

    violations.push({
      rule,
      triggered: [...rule.conflictingPermissions],
    });
  }

  return violations;
}

/**
 * Convenience: check whether a permission set has any BLOCK-severity violation.
 * BLOCK violations cannot be overridden by the owner — they must be resolved.
 */
export function hasBlockingViolation(
  role: UserRole,
  permissions: PermissionKey[],
): boolean {
  return detectViolations(role, permissions).some(
    (v) => v.rule.severity === 'BLOCK',
  );
}

/**
 * Convenience: list all WARN-severity violations.  These can be overridden
 * by the owner with a typed reason; the override is logged to AuditLog with
 * action='SOD_OVERRIDE_GRANTED' and a reference to the rule.key.
 */
export function listWarnings(
  role: UserRole,
  permissions: PermissionKey[],
): SODViolation[] {
  return detectViolations(role, permissions).filter(
    (v) => v.rule.severity === 'WARN',
  );
}
