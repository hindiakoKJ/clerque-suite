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
  type PlanCode,
} from '@repo/shared-types';

describe('Plans constants', () => {
  const ALL_PLAN_CODES: PlanCode[] = [
    'STD_SOLO', 'STD_DUO', 'STD_TEAM', 'STD_BIZ',
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

    it('Solo plan is exactly 1 staff, no add-ons', () => {
      expect(PLAN_CAPS.STD_SOLO.baseSeats).toBe(1);
      expect(PLAN_CAPS.STD_SOLO.maxAddons).toBe(0);
      expect(PLAN_CAPS.STD_SOLO.maxTotal).toBe(1);
      expect(PLAN_CAPS.STD_SOLO.moduleCount).toBe(1);
    });

    it('module-count tiers are correct (1=STD, 2=PAIR, 3=SUITE/ENTERPRISE)', () => {
      ['STD_SOLO', 'STD_DUO', 'STD_TEAM', 'STD_BIZ'].forEach((c) => {
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
      expect(PLAN_LIMITS.STD_SOLO.maxBranches).toBe(1);
      expect(PLAN_LIMITS.STD_SOLO.maxAiPerMonth).toBe(0);
      expect(PLAN_LIMITS.STD_SOLO.apiRatePerHour).toBe(0);
    });

    it('AI quotas are monotonically non-decreasing within each tier ladder', () => {
      // Standalone ladder
      expect(PLAN_LIMITS.STD_SOLO.maxAiPerMonth).toBeLessThanOrEqual(PLAN_LIMITS.STD_DUO.maxAiPerMonth);
      expect(PLAN_LIMITS.STD_DUO.maxAiPerMonth).toBeLessThanOrEqual(PLAN_LIMITS.STD_TEAM.maxAiPerMonth);
      expect(PLAN_LIMITS.STD_TEAM.maxAiPerMonth).toBeLessThanOrEqual(PLAN_LIMITS.STD_BIZ.maxAiPerMonth);
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
      const f = PLAN_FEATURES.STD_SOLO;
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
      expect(PLAN_SETUP_FEE_PHP_CENTS.STD_SOLO).toBe(0);
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
      expect(effectiveSeatCeiling('STD_TEAM', 0)).toBe(5);
      expect(effectiveSeatCeiling('SUITE_T2', 0)).toBe(8);
    });

    it('returns base + addons when within plan ceiling', () => {
      expect(effectiveSeatCeiling('STD_TEAM', 3)).toBe(8); // base 5 + 3 = 8
      expect(effectiveSeatCeiling('SUITE_T3', 10)).toBe(30); // base 20 + 10 = 30
    });

    it('clamps to plan maxTotal regardless of addons paid', () => {
      // STD_TEAM: base 5, maxAddons 5, maxTotal 10. Buying 100 add-ons still caps at 10.
      expect(effectiveSeatCeiling('STD_TEAM', 100)).toBe(10);
      expect(effectiveSeatCeiling('SUITE_T3', 999)).toBe(50);
      expect(effectiveSeatCeiling('STD_SOLO', 5)).toBe(1); // Solo is hard 1 regardless
    });

    it('treats negative addons as zero', () => {
      expect(effectiveSeatCeiling('STD_TEAM', -3)).toBe(5);
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
      expect(isModuleEnabled('STD_TEAM', onlyPos, 'POS')).toBe(true);
      expect(isModuleEnabled('STD_TEAM', onlyPos, 'LEDGER')).toBe(false);
      expect(isModuleEnabled('STD_TEAM', onlyPos, 'PAYROLL')).toBe(false);
    });

    it('Pair plans respect the per-module flags', () => {
      const posLedger = { modulePos: true, moduleLedger: true, modulePayroll: false };
      expect(isModuleEnabled('PAIR_T2', posLedger, 'POS')).toBe(true);
      expect(isModuleEnabled('PAIR_T2', posLedger, 'LEDGER')).toBe(true);
      expect(isModuleEnabled('PAIR_T2', posLedger, 'PAYROLL')).toBe(false);
    });
  });

  describe('validateSoloModuleCombo', () => {
    it('returns null for Solo + POS only (the only valid Solo combo)', () => {
      expect(validateSoloModuleCombo('STD_SOLO', true, false, false)).toBeNull();
    });

    it('rejects Solo without POS', () => {
      expect(validateSoloModuleCombo('STD_SOLO', false, false, false)).toMatch(/POS/i);
    });

    it('rejects Solo + Ledger combination', () => {
      expect(validateSoloModuleCombo('STD_SOLO', true, true, false)).toMatch(/Ledger/i);
    });

    it('rejects Solo + Payroll combination', () => {
      expect(validateSoloModuleCombo('STD_SOLO', true, false, true)).toMatch(/Payroll/i);
    });

    it('returns null for non-Solo plans (no Solo-specific restriction)', () => {
      expect(validateSoloModuleCombo('STD_DUO', true, true, false)).toBeNull();
      expect(validateSoloModuleCombo('PAIR_T1', false, true, true)).toBeNull();
      expect(validateSoloModuleCombo('SUITE_T2', true, true, true)).toBeNull();
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
});
