/**
 * Invariants for the packaging model.
 *
 * These constants drive every plan-gated decision in the system — staff caps,
 * branch caps, AI quotas, module entitlement, feature flags. If any of them
 * drifts, billing and access control silently break.
 *
 * This suite used to hard-enumerate 11 plan codes and assert per-code
 * properties (moduleCount 1 for SOLO_*, 2 for PAIR_*, 3 for SUITE_*). That
 * ladder is retired. What matters now is different and, mostly, more
 * important: that an UNRECOGNISED plan string cannot break a tenant. The DB
 * column is unvalidated text and still holds legacy values, so the resolution
 * helpers are the real contract.
 */
import {
  PLAN_CAPS,
  PLAN_LIMITS,
  PLAN_FEATURES,
  PLAN_SETUP_FEE_PHP_CENTS,
  DEFAULT_PLAN_CODE,
  normalizePlanCode,
  planCapsFor,
  planLimitsFor,
  planFeaturesFor,
  effectiveSeatCeiling,
  isModuleEnabled,
  validateModuleCombo,
  planLabel,
  isPermissionAvailableUnderPlan,
  getRequiredPlanForPermission,
  type PlanCode,
} from '@repo/shared-types';

const ALL_PLAN_CODES: PlanCode[] = ['CLERQUE'];

/** Values that really do sit in tenants.plan_code today, plus junk. */
const LEGACY_AND_JUNK = [
  'SOLO_LITE', 'SOLO_STANDARD', 'SOLO_PRO', 'SOLO_BOOKS',
  'PAIR_T1', 'PAIR_T2', 'PAIR_T3',
  'SUITE_T1', 'SUITE_T2', 'SUITE_T3', 'ENTERPRISE',
  // Deleted two migrations before the collapse but still written by
  // demo-bootstrap until it was fixed.
  'STD_SOLO', 'STD_DUO', 'STD_TEAM', 'STD_BIZ',
  '', 'nonsense', 'clerque', 'Clerque',
];

describe('Plan tables', () => {
  test.each(ALL_PLAN_CODES)('%s has consistent caps', (code) => {
    const cap = PLAN_CAPS[code];
    expect(cap).toBeDefined();
    expect(cap.maxTotal).toBe(cap.baseSeats + cap.maxAddons);
    expect(cap.pricePhpMonthlyCents).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(cap.maxTotal)).toBe(true);
  });

  test.each(ALL_PLAN_CODES)('%s has finite limits', (code) => {
    const limits = PLAN_LIMITS[code];
    expect(Number.isFinite(limits.maxBranches)).toBe(true);
    expect(Number.isFinite(limits.maxAiPerMonth)).toBe(true);
    expect(Number.isFinite(limits.apiRatePerHour)).toBe(true);
  });

  it('defines every table for the default code', () => {
    expect(PLAN_CAPS[DEFAULT_PLAN_CODE]).toBeDefined();
    expect(PLAN_LIMITS[DEFAULT_PLAN_CODE]).toBeDefined();
    expect(PLAN_FEATURES[DEFAULT_PLAN_CODE]).toBeDefined();
    expect(PLAN_SETUP_FEE_PHP_CENTS[DEFAULT_PLAN_CODE]).toBeDefined();
    expect(planLabel(DEFAULT_PLAN_CODE)).toBeTruthy();
  });

  it('grants readwrite API access — an ecosystem app must be able to post a sale', () => {
    // This is the flag that decides whether Clerque can act as a commerce
    // backend at all. It previously lived only on the two most expensive
    // plans, which put the platform story out of reach of a small venue.
    expect(PLAN_FEATURES[DEFAULT_PLAN_CODE].apiAccess).toBe('readwrite');
  });

  it('grants full accounting — one package means one set of books', () => {
    expect(PLAN_FEATURES[DEFAULT_PLAN_CODE].advancedAccounting).toBe(true);
  });

  it('has no leftover flags that nothing reads', () => {
    // crossModuleReports, aiAddons, whitelabel, customDomain, customRoles and
    // fifoValuation were each defined for all 11 plans and read by no guard,
    // service or screen. Re-adding one without a reader is how the last set
    // of dead flags accumulated.
    const features = PLAN_FEATURES[DEFAULT_PLAN_CODE] as unknown as Record<string, unknown>;
    for (const dead of [
      'crossModuleReports', 'aiAddons', 'whitelabel',
      'customDomain', 'customRoles', 'fifoValuation',
    ]) {
      expect(features).not.toHaveProperty(dead);
    }
  });
});

describe('normalizePlanCode — the DB boundary', () => {
  // The whole point of this function: tenants.plan_code is unvalidated TEXT
  // with a legacy default. Before it existed, an unrecognised value meant
  // PlanFeatureGuard fell back to the lowest tier, PLAN_CAPS[code].baseSeats
  // threw, and — worst — the API-key resolver read apiAccess as 'none' and
  // returned null, surfacing as "Invalid or expired API key". A stale string
  // silently killed a working integration.
  test.each(LEGACY_AND_JUNK)('resolves %p onto the package', (raw) => {
    expect(normalizePlanCode(raw)).toBe(DEFAULT_PLAN_CODE);
  });

  it('resolves null and undefined', () => {
    expect(normalizePlanCode(null)).toBe(DEFAULT_PLAN_CODE);
    expect(normalizePlanCode(undefined)).toBe(DEFAULT_PLAN_CODE);
  });

  it('keeps a recognised code', () => {
    expect(normalizePlanCode('CLERQUE')).toBe('CLERQUE');
  });
});

describe('Safe accessors never return undefined', () => {
  test.each([...LEGACY_AND_JUNK, null, undefined])('%p yields full tables', (raw) => {
    expect(planCapsFor(raw as string).baseSeats).toBeGreaterThan(0);
    expect(planLimitsFor(raw as string).maxBranches).toBeGreaterThan(0);
    expect(planFeaturesFor(raw as string).apiAccess).toBe('readwrite');
  });

  it('never grants unlimited by accident on an unknown code', () => {
    // products.service and inventory.service used `?? -1` fallbacks, and -1
    // means UNLIMITED — so an unrecognised plan failed OPEN. The accessor
    // returns the real package instead of a hole, so the value is deliberate.
    expect(planFeaturesFor('nonsense').maxRecipes).toBe(
      PLAN_FEATURES[DEFAULT_PLAN_CODE].maxRecipes,
    );
  });
});

describe('effectiveSeatCeiling', () => {
  it('clamps purchased seats to the plan ceiling', () => {
    const cap = PLAN_CAPS[DEFAULT_PLAN_CODE];
    expect(effectiveSeatCeiling(DEFAULT_PLAN_CODE, 0)).toBe(
      Math.min(cap.baseSeats, cap.maxTotal),
    );
    expect(effectiveSeatCeiling(DEFAULT_PLAN_CODE, 10_000)).toBe(cap.maxTotal);
  });

  it('treats negative addons as zero', () => {
    expect(effectiveSeatCeiling(DEFAULT_PLAN_CODE, -5)).toBe(
      effectiveSeatCeiling(DEFAULT_PLAN_CODE, 0),
    );
  });

  it('does not throw on a legacy stored code', () => {
    expect(() => effectiveSeatCeiling('SUITE_T2', 0)).not.toThrow();
  });
});

describe('isModuleEnabled — the flags are the only source of truth', () => {
  const on  = { modulePos: true,  moduleLedger: true,  modulePayroll: true  };
  const off = { modulePos: false, moduleLedger: false, modulePayroll: false };

  it('reports each module from its own flag', () => {
    expect(isModuleEnabled(DEFAULT_PLAN_CODE, on, 'POS')).toBe(true);
    expect(isModuleEnabled(DEFAULT_PLAN_CODE, on, 'LEDGER')).toBe(true);
    expect(isModuleEnabled(DEFAULT_PLAN_CODE, on, 'PAYROLL')).toBe(true);
    expect(isModuleEnabled(DEFAULT_PLAN_CODE, off, 'POS')).toBe(false);
    expect(isModuleEnabled(DEFAULT_PLAN_CODE, off, 'LEDGER')).toBe(false);
    expect(isModuleEnabled(DEFAULT_PLAN_CODE, off, 'PAYROLL')).toBe(false);
  });

  it('agrees with AppAccessGuard when a module is switched off', () => {
    // Regression: this used to short-circuit to true for any plan with
    // moduleCount 3, while AppAccessGuard read the flags alone. A Suite
    // tenant with modulePos false was "enabled" here and 403'd at the wall.
    const posOff = { modulePos: false, moduleLedger: true, modulePayroll: true };
    expect(isModuleEnabled(DEFAULT_PLAN_CODE, posOff, 'POS')).toBe(false);
  });
});

describe('validateModuleCombo', () => {
  it('accepts any combination with at least one module on', () => {
    expect(validateModuleCombo(DEFAULT_PLAN_CODE, true,  false, false)).toBeNull();
    expect(validateModuleCombo(DEFAULT_PLAN_CODE, false, true,  false)).toBeNull();
    expect(validateModuleCombo(DEFAULT_PLAN_CODE, false, false, true )).toBeNull();
    expect(validateModuleCombo(DEFAULT_PLAN_CODE, true,  true,  true )).toBeNull();
  });

  it('accepts Ledger-only, which the old validator rejected outright', () => {
    // The public Ledger signup wrote exactly this shape (modulePos false,
    // moduleLedger true) while validateSoloModuleCombo demanded POS on every
    // SOLO_* plan. Such tenants existed in the DB and could not be edited in
    // the admin console at all without first changing their plan.
    expect(validateModuleCombo(DEFAULT_PLAN_CODE, false, true, false)).toBeNull();
  });

  it('rejects a tenant with every module off', () => {
    const err = validateModuleCombo(DEFAULT_PLAN_CODE, false, false, false);
    expect(err).toMatch(/at least one module/i);
  });
});

describe('isPermissionAvailableUnderPlan', () => {
  const ctx = (mods: Partial<{ pos: boolean; ledger: boolean; payroll: boolean }>) => ({
    planCode:      DEFAULT_PLAN_CODE,
    modulePos:     mods.pos     ?? false,
    moduleLedger:  mods.ledger  ?? false,
    modulePayroll: mods.payroll ?? false,
  });

  it('gates simple ledger on the Ledger module', () => {
    expect(isPermissionAvailableUnderPlan('ledger:view', ctx({ ledger: true  }))).toBe(true);
    expect(isPermissionAvailableUnderPlan('ledger:view', ctx({ ledger: false }))).toBe(false);
  });

  it('gates full ledger on the Ledger module plus advancedAccounting', () => {
    expect(isPermissionAvailableUnderPlan('ledger:journal_entry', ctx({ ledger: true  }))).toBe(true);
    expect(isPermissionAvailableUnderPlan('ledger:period_close',  ctx({ ledger: false }))).toBe(false);
    expect(isPermissionAvailableUnderPlan('finance:bank_recon',   ctx({ ledger: false }))).toBe(false);
  });

  it('gates payroll on the Payroll module', () => {
    expect(isPermissionAvailableUnderPlan('payroll:run', ctx({ payroll: true  }))).toBe(true);
    expect(isPermissionAvailableUnderPlan('payroll:run', ctx({ payroll: false }))).toBe(false);
  });

  it('does not let a switched-off module leak through', () => {
    // Regression: moduleCount === 3 used to short-circuit all three branches
    // to true, so a Suite tenant with Payroll off still saw payroll
    // permissions offered in the staff editor.
    expect(isPermissionAvailableUnderPlan('payroll:edit', ctx({ pos: true, ledger: true }))).toBe(false);
  });

  it('treats unlisted permissions as universal', () => {
    expect(isPermissionAvailableUnderPlan('pos:sell', ctx({}))).toBe(true);
  });
});

describe('getRequiredPlanForPermission', () => {
  it('points at the module, not at a plan that no longer exists', () => {
    // Old copy read "Upgrade to Duo or higher" and "Pair T3 / Suite T2" —
    // Duo and Business had already been deleted by earlier migrations.
    const ledger = getRequiredPlanForPermission('ledger:journal_entry');
    expect(ledger).toMatch(/Ledger module/i);
    expect(ledger).not.toMatch(/\bPair\b|\bSuite\b|\bDuo\b|Upgrade to/i);

    const payroll = getRequiredPlanForPermission('payroll:run');
    expect(payroll).toMatch(/Payroll module/i);
  });

  it('returns null for universal permissions', () => {
    expect(getRequiredPlanForPermission('pos:sell')).toBeNull();
  });
});
