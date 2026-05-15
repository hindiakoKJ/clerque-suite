/**
 * Unit tests for the modular pricing constants and helpers.
 *
 * These constants drive every plan-gated decision in the system —
 * staff caps, branch caps, AI quotas, module entitlement, feature flags.
 * If any of them drifts, billing and access control silently break.
 */
import {
  PLAN_CAPS,
  PLAN_LIMITS,
  PLAN_FEATURES,
  PLAN_SETUP_FEE_PHP_CENTS,
  effectiveSeatCeiling,
  isModuleEnabled,
  validateSoloModuleCombo,
  planLabel,
  isPermissionAvailableUnderPlan,
  getRequiredPlanForPermission,
  type PlanCode,
} from '@repo/shared-types';

describe('Plans constants', () => {
  const ALL_PLAN_CODES: PlanCode[] = [
    'SOLO_LITE', 'SOLO_STANDARD', 'SOLO_PRO',
    'STD_BIZ',
    'PAIR_T1', 'PAIR_T2', 'PAIR_T3',
    'SUITE_T1', 'SUITE_T2', 'SUITE_T3',
    'ENTERPRISE',
  ];

  describe('PLAN_CAPS — every code present + maxTotal = base + maxAddons', () => {
    test.each(ALL_PLAN_CODES)('%s has consistent caps', (code) => {
      const cap = PLAN_CAPS[code];
      expect(cap).toBeDefined();
      expect(cap.maxTotal).toBe(cap.baseSeats + cap.maxAddons);
      expect(cap.moduleCount).toBeGreaterThanOrEqual(1);
      expect(cap.moduleCount).toBeLessThanOrEqual(3);
      expect(cap.pricePhpMonthlyCents).toBeGreaterThanOrEqual(0);
    });

    it('has no unlimited tiers — every maxTotal is finite and ≤ 100 except ENTERPRISE which is bounded', () => {
      for (const code of ALL_PLAN_CODES) {
        const total = PLAN_CAPS[code].maxTotal;
        expect(Number.isFinite(total)).toBe(true);
        // Enterprise is capped at 100 staff — anything above is bespoke contract.
        expect(total).toBeLessThanOrEqual(100);
      }
    });

    it('Solo Lite is exactly 1 staff, no add-ons', () => {
      expect(PLAN_CAPS.SOLO_LITE.baseSeats).toBe(1);
      expect(PLAN_CAPS.SOLO_LITE.maxAddons).toBe(0);
      expect(PLAN_CAPS.SOLO_LITE.maxTotal).toBe(1);
      expect(PLAN_CAPS.SOLO_LITE.moduleCount).toBe(1);
    });

    it('module-count tiers are correct (1=SOLO_*/STD_BIZ, 2=PAIR, 3=SUITE/ENTERPRISE)', () => {
      ['SOLO_LITE', 'SOLO_STANDARD', 'SOLO_PRO', 'STD_BIZ'].forEach((c) => {
        expect(PLAN_CAPS[c as PlanCode].moduleCount).toBe(1);
      });
      ['PAIR_T1', 'PAIR_T2', 'PAIR_T3'].forEach((c) => {
        expect(PLAN_CAPS[c as PlanCode].moduleCount).toBe(2);
      });
      ['SUITE_T1', 'SUITE_T2', 'SUITE_T3', 'ENTERPRISE'].forEach((c) => {
        expect(PLAN_CAPS[c as PlanCode].moduleCount).toBe(3);
      });
    });
  });

  describe('PLAN_LIMITS — branch / AI / API ceilings', () => {
    test.each(ALL_PLAN_CODES)('%s has finite ceilings', (code) => {
      const lim = PLAN_LIMITS[code];
      expect(lim).toBeDefined();
      expect(Number.isFinite(lim.maxBranches)).toBe(true);
      expect(Number.isFinite(lim.maxAiPerMonth)).toBe(true);
      expect(Number.isFinite(lim.apiRatePerHour)).toBe(true);
      expect(lim.maxBranches).toBeGreaterThanOrEqual(1);
      expect(lim.maxBranches).toBeLessThanOrEqual(15); // Enterprise cap
    });

    it('Solo is 1 branch, no AI, no API', () => {
      expect(PLAN_LIMITS.SOLO_LITE.maxBranches).toBe(1);
      expect(PLAN_LIMITS.SOLO_LITE.maxAiPerMonth).toBe(0);
      expect(PLAN_LIMITS.SOLO_LITE.apiRatePerHour).toBe(0);
    });

    it('AI quotas are monotonically non-decreasing within each tier ladder', () => {
      // Standalone ladder
      expect(PLAN_LIMITS.SOLO_LITE.maxAiPerMonth).toBeLessThanOrEqual(PLAN_LIMITS.SOLO_STANDARD.maxAiPerMonth);
      expect(PLAN_LIMITS.SOLO_STANDARD.maxAiPerMonth).toBeLessThanOrEqual(PLAN_LIMITS.SOLO_PRO.maxAiPerMonth);
      expect(PLAN_LIMITS.SOLO_PRO.maxAiPerMonth).toBeLessThanOrEqual(PLAN_LIMITS.STD_BIZ.maxAiPerMonth);
      // Suite ladder
      expect(PLAN_LIMITS.SUITE_T1.maxAiPerMonth).toBeLessThanOrEqual(PLAN_LIMITS.SUITE_T2.maxAiPerMonth);
      expect(PLAN_LIMITS.SUITE_T2.maxAiPerMonth).toBeLessThanOrEqual(PLAN_LIMITS.SUITE_T3.maxAiPerMonth);
    });
  });

  describe('PLAN_FEATURES — feature flags', () => {
    test.each(ALL_PLAN_CODES)('%s has all feature keys defined', (code) => {
      const f = PLAN_FEATURES[code];
      expect(f).toBeDefined();
      expect(typeof f.birForms).toBe('boolean');
      expect(typeof f.customRoles).toBe('boolean');
      expect(typeof f.auditLog).toBe('boolean');
      expect(typeof f.crossModuleReports).toBe('boolean');
      expect(typeof f.aiAddons).toBe('boolean');
      expect(['none', 'read', 'readwrite']).toContain(f.apiAccess);
      expect(typeof f.whitelabel).toBe('boolean');
      expect(typeof f.customDomain).toBe('boolean');
    });

    it('Solo unlocks only the bare minimum (no BIR forms, no audit)', () => {
      const f = PLAN_FEATURES.SOLO_LITE;
      expect(f.birForms).toBe(false);
      expect(f.auditLog).toBe(false);
      expect(f.customRoles).toBe(false);
      expect(f.apiAccess).toBe('none');
    });

    it('Enterprise unlocks everything', () => {
      const f = PLAN_FEATURES.ENTERPRISE;
      expect(f.birForms).toBe(true);
      expect(f.customRoles).toBe(true);
      expect(f.auditLog).toBe(true);
      expect(f.crossModuleReports).toBe(true);
      expect(f.aiAddons).toBe(true);
      expect(f.apiAccess).toBe('readwrite');
      expect(f.whitelabel).toBe(true);
      expect(f.customDomain).toBe(true);
    });

    it('white-label and custom domain are Enterprise-only', () => {
      for (const code of ALL_PLAN_CODES) {
        if (code === 'ENTERPRISE') continue;
        expect(PLAN_FEATURES[code].whitelabel).toBe(false);
        expect(PLAN_FEATURES[code].customDomain).toBe(false);
      }
    });
  });

  describe('PLAN_SETUP_FEE_PHP_CENTS', () => {
    test.each(ALL_PLAN_CODES)('%s has a non-negative setup fee', (code) => {
      const fee = PLAN_SETUP_FEE_PHP_CENTS[code];
      expect(typeof fee).toBe('number');
      expect(fee).toBeGreaterThanOrEqual(0);
    });

    it('Solo setup fee is 0 (no friction at entry)', () => {
      expect(PLAN_SETUP_FEE_PHP_CENTS.SOLO_LITE).toBe(0);
    });

    it('Enterprise setup fee is the floor', () => {
      // Other plans should be ≤ Enterprise setup fee
      for (const code of ALL_PLAN_CODES) {
        if (code === 'ENTERPRISE') continue;
        expect(PLAN_SETUP_FEE_PHP_CENTS[code]).toBeLessThanOrEqual(PLAN_SETUP_FEE_PHP_CENTS.ENTERPRISE);
      }
    });
  });

  describe('effectiveSeatCeiling', () => {
    it('returns base seats when no add-ons', () => {
      expect(effectiveSeatCeiling('SOLO_PRO', 0)).toBe(5);
      expect(effectiveSeatCeiling('SUITE_T2', 0)).toBe(8);
    });

    it('returns base + addons when within plan ceiling', () => {
      // STD_BIZ: base 10, maxAddons 15 → buyer adds 5 → ceiling = 15
      expect(effectiveSeatCeiling('STD_BIZ', 5)).toBe(15);
      expect(effectiveSeatCeiling('SUITE_T3', 10)).toBe(30); // base 20 + 10 = 30
    });

    it('clamps to plan maxTotal regardless of addons paid', () => {
      // STD_BIZ: base 10, maxAddons 15, maxTotal 25. Buying 100 addons caps at 25.
      expect(effectiveSeatCeiling('STD_BIZ', 100)).toBe(25);
      expect(effectiveSeatCeiling('SUITE_T3', 999)).toBe(50);
      expect(effectiveSeatCeiling('SOLO_LITE', 5)).toBe(1); // Solo is hard 1 regardless
      expect(effectiveSeatCeiling('SOLO_PRO', 100)).toBe(5); // Solo Pro caps at 5 (no addons allowed)
    });

    it('treats negative addons as zero', () => {
      expect(effectiveSeatCeiling('SOLO_PRO', -3)).toBe(5);
    });
  });

  describe('isModuleEnabled', () => {
    it('Suite plans return true for any module regardless of flags', () => {
      expect(isModuleEnabled('SUITE_T1', { modulePos: false, moduleLedger: false, modulePayroll: false }, 'POS')).toBe(true);
      expect(isModuleEnabled('SUITE_T2', { modulePos: false, moduleLedger: false, modulePayroll: false }, 'LEDGER')).toBe(true);
      expect(isModuleEnabled('ENTERPRISE', { modulePos: false, moduleLedger: false, modulePayroll: false }, 'PAYROLL')).toBe(true);
    });

    it('Standalone plans respect the per-module flags', () => {
      const onlyPos = { modulePos: true, moduleLedger: false, modulePayroll: false };
      expect(isModuleEnabled('SOLO_PRO', onlyPos, 'POS')).toBe(true);
      expect(isModuleEnabled('SOLO_PRO', onlyPos, 'LEDGER')).toBe(false);
      expect(isModuleEnabled('SOLO_PRO', onlyPos, 'PAYROLL')).toBe(false);
    });

    it('Pair plans respect the per-module flags', () => {
      const posLedger = { modulePos: true, moduleLedger: true, modulePayroll: false };
      expect(isModuleEnabled('PAIR_T2', posLedger, 'POS')).toBe(true);
      expect(isModuleEnabled('PAIR_T2', posLedger, 'LEDGER')).toBe(true);
      expect(isModuleEnabled('PAIR_T2', posLedger, 'PAYROLL')).toBe(false);
    });
  });

  describe('validateSoloModuleCombo (now applies to ALL STD_* plans)', () => {
    it('returns null for any STD plan + POS only (the only valid combo)', () => {
      expect(validateSoloModuleCombo('SOLO_LITE', true, false, false)).toBeNull();
      expect(validateSoloModuleCombo('SOLO_STANDARD',  true, false, false)).toBeNull();
      expect(validateSoloModuleCombo('SOLO_PRO', true, false, false)).toBeNull();
      expect(validateSoloModuleCombo('STD_BIZ',  true, false, false)).toBeNull();
    });

    it('rejects any STD plan without POS', () => {
      expect(validateSoloModuleCombo('SOLO_LITE', false, false, false)).toMatch(/POS/i);
      expect(validateSoloModuleCombo('SOLO_STANDARD',  false, false, false)).toMatch(/POS/i);
      expect(validateSoloModuleCombo('SOLO_PRO', false, false, false)).toMatch(/POS/i);
      expect(validateSoloModuleCombo('STD_BIZ',  false, false, false)).toMatch(/POS/i);
    });

    it('rejects ANY STD plan + Ledger combination (not just Solo)', () => {
      expect(validateSoloModuleCombo('SOLO_LITE', true, true, false)).toMatch(/Ledger/i);
      expect(validateSoloModuleCombo('SOLO_STANDARD',  true, true, false)).toMatch(/Ledger/i);
      expect(validateSoloModuleCombo('SOLO_PRO', true, true, false)).toMatch(/Ledger/i);
      expect(validateSoloModuleCombo('STD_BIZ',  true, true, false)).toMatch(/Ledger/i);
    });

    it('rejects ANY STD plan + Payroll combination', () => {
      expect(validateSoloModuleCombo('SOLO_LITE', true, false, true)).toMatch(/Payroll/i);
      expect(validateSoloModuleCombo('SOLO_STANDARD',  true, false, true)).toMatch(/Payroll/i);
      expect(validateSoloModuleCombo('SOLO_PRO', true, false, true)).toMatch(/Payroll/i);
      expect(validateSoloModuleCombo('STD_BIZ',  true, false, true)).toMatch(/Payroll/i);
    });

    it('returns null for PAIR / SUITE / ENTERPRISE plans (no STD-specific restriction)', () => {
      expect(validateSoloModuleCombo('PAIR_T1',    true, true, false)).toBeNull();
      expect(validateSoloModuleCombo('PAIR_T2',    false, true, true)).toBeNull();
      expect(validateSoloModuleCombo('SUITE_T2',   true, true, true)).toBeNull();
      expect(validateSoloModuleCombo('ENTERPRISE', true, true, true)).toBeNull();
    });
  });

  describe('planLabel', () => {
    it('returns a non-empty display label for every plan code', () => {
      for (const code of ALL_PLAN_CODES) {
        const label = planLabel(code);
        expect(label).toBeTruthy();
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Plan-based permission gate (replaces legacy tier-feature indirection)
  // ───────────────────────────────────────────────────────────────────────────

  describe('isPermissionAvailableUnderPlan', () => {
    const POS_ONLY = { modulePos: true,  moduleLedger: false, modulePayroll: false };
    const POS_LED  = { modulePos: true,  moduleLedger: true,  modulePayroll: false };
    const POS_PAY  = { modulePos: true,  moduleLedger: false, modulePayroll: true  };
    const SUITE    = { modulePos: true,  moduleLedger: true,  modulePayroll: true  };

    it('universal permissions are always available', () => {
      const ctx = { planCode: 'SOLO_LITE' as PlanCode, ...POS_ONLY };
      expect(isPermissionAvailableUnderPlan('product:create', ctx)).toBe(true);
      expect(isPermissionAvailableUnderPlan('order:create',   ctx)).toBe(true);
      expect(isPermissionAvailableUnderPlan('staff:view',     ctx)).toBe(true);
    });

    it('ledger:* requires moduleLedger', () => {
      const noLed = { planCode: 'SOLO_LITE' as PlanCode, ...POS_ONLY };
      const led   = { planCode: 'PAIR_T1' as PlanCode, ...POS_LED };
      expect(isPermissionAvailableUnderPlan('ledger:view',          noLed)).toBe(false);
      expect(isPermissionAvailableUnderPlan('ledger:journal_entry', noLed)).toBe(false);
      expect(isPermissionAvailableUnderPlan('ledger:view',          led)).toBe(true);
      expect(isPermissionAvailableUnderPlan('ledger:journal_entry', led)).toBe(true);
    });

    it('payroll:* requires modulePayroll', () => {
      const noPay = { planCode: 'SOLO_LITE' as PlanCode, ...POS_ONLY };
      const pay   = { planCode: 'PAIR_T2' as PlanCode, ...POS_PAY };
      expect(isPermissionAvailableUnderPlan('payroll:view_salary',         noPay)).toBe(false);
      expect(isPermissionAvailableUnderPlan('payroll:run',                  noPay)).toBe(false);
      expect(isPermissionAvailableUnderPlan('staff:assign_payroll_master', noPay)).toBe(false);
      expect(isPermissionAvailableUnderPlan('payroll:view_salary',         pay)).toBe(true);
      expect(isPermissionAvailableUnderPlan('payroll:run',                  pay)).toBe(true);
    });

    it('SUITE plans always include all module-gated permissions even if a module flag is somehow false', () => {
      // moduleCount === 3 short-circuits to true regardless of per-module flags.
      const buggy = { planCode: 'SUITE_T2' as PlanCode, modulePos: true, moduleLedger: false, modulePayroll: false };
      expect(isPermissionAvailableUnderPlan('ledger:view',  buggy)).toBe(true);
      expect(isPermissionAvailableUnderPlan('payroll:run',  buggy)).toBe(true);
    });

    it('audit:view follows PLAN_FEATURES.auditLog', () => {
      // SOLO_LITE does NOT include auditLog
      expect(isPermissionAvailableUnderPlan('audit:view', { planCode: 'SOLO_LITE',  ...POS_ONLY })).toBe(false);
      // STD_BIZ DOES include auditLog
      expect(isPermissionAvailableUnderPlan('audit:view', { planCode: 'STD_BIZ',   ...POS_ONLY })).toBe(true);
      // SUITE plans always include it
      expect(isPermissionAvailableUnderPlan('audit:view', { planCode: 'SUITE_T2',  ...SUITE })).toBe(true);
    });

    it('bir:view follows PLAN_FEATURES.birForms', () => {
      // Sprint 23 — BIR parked as a Solo-tier differentiator. No Solo plan has
      // BIR forms unlocked. Customers needing BIR exports upgrade to STD_BIZ
      // or PAIR/SUITE.
      expect(isPermissionAvailableUnderPlan('bir:view', { planCode: 'SOLO_LITE',     ...POS_ONLY })).toBe(false);
      expect(isPermissionAvailableUnderPlan('bir:view', { planCode: 'SOLO_STANDARD', ...POS_ONLY })).toBe(false);
      expect(isPermissionAvailableUnderPlan('bir:view', { planCode: 'SOLO_PRO',      ...POS_ONLY })).toBe(false);
      // STD_BIZ + PAIR_* + SUITE_* all have BIR forms
      expect(isPermissionAvailableUnderPlan('bir:view', { planCode: 'STD_BIZ',  ...POS_ONLY })).toBe(true);
      expect(isPermissionAvailableUnderPlan('bir:view', { planCode: 'PAIR_T1',  ...POS_LED  })).toBe(true);
    });

    it('unknown permission keys default to true (universal)', () => {
      const ctx = { planCode: 'SOLO_LITE' as PlanCode, ...POS_ONLY };
      expect(isPermissionAvailableUnderPlan('completely:made_up', ctx)).toBe(true);
    });
  });

  describe('getRequiredPlanForPermission', () => {
    it('returns null for universal permissions', () => {
      expect(getRequiredPlanForPermission('product:create')).toBeNull();
      expect(getRequiredPlanForPermission('staff:view')).toBeNull();
      expect(getRequiredPlanForPermission('unknown:thing')).toBeNull();
    });

    it('returns Ledger hint for ledger permissions', () => {
      expect(getRequiredPlanForPermission('ledger:view')).toMatch(/ledger/i);
      expect(getRequiredPlanForPermission('ledger:journal_entry')).toMatch(/ledger/i);
      expect(getRequiredPlanForPermission('finance:bank_recon')).toMatch(/ledger/i);
    });

    it('returns Payroll hint for payroll permissions', () => {
      expect(getRequiredPlanForPermission('payroll:view_salary')).toMatch(/payroll/i);
      expect(getRequiredPlanForPermission('payroll:run')).toMatch(/payroll/i);
      expect(getRequiredPlanForPermission('staff:assign_payroll_master')).toMatch(/payroll/i);
    });

    it('returns audit / bir hints for compliance permissions', () => {
      expect(getRequiredPlanForPermission('audit:view')).toMatch(/audit/i);
      expect(getRequiredPlanForPermission('bir:view')).toMatch(/bir/i);
    });
  });
});
