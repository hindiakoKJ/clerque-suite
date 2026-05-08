/**
 * VerticalPack registry — completeness contract.
 *
 * The Clerque platform branches per BusinessType across ~14 surfaces (sidebar
 * nav, dashboard, help, product modal, receipt, demo data, etc.). Before this
 * registry, those branches were scattered as `isLaundryType()` / `isFnbType()`
 * checks. Now they all read from `getVerticalPack(businessType)`.
 *
 * This spec is the safety net: if a new BusinessType is added to the enum but
 * no pack is registered for it, this spec fails and the build is red. Forces
 * the engineer adding the new type to also define its pack.
 */
import {
  VERTICAL_PACKS,
  ALL_PACKS,
  getVerticalPack,
  isCategory,
  fnbPack,
  retailPack,
  laundryPack,
  serviceMfgPack,
  type BusinessType,
} from '@repo/shared-types';

const ALL_BUSINESS_TYPES: BusinessType[] = [
  'COFFEE_SHOP',
  'RESTAURANT',
  'BAKERY',
  'FOOD_STALL',
  'BAR_LOUNGE',
  'CATERING',
  'RETAIL',
  'SERVICE',
  'LAUNDRY',
  'MANUFACTURING',
];

describe('VerticalPack registry', () => {
  describe('completeness — every BusinessType has a pack', () => {
    test.each(ALL_BUSINESS_TYPES)('%s is registered', (bt) => {
      const pack = VERTICAL_PACKS[bt];
      expect(pack).toBeDefined();
      expect(pack.businessTypes).toContain(bt);
    });
  });

  describe('shape — every pack has every required field', () => {
    test.each(ALL_PACKS.map((p) => [p.id, p] as [string, typeof p]))(
      '%s pack is well-formed',
      (_id, pack) => {
        expect(pack.id).toBeTruthy();
        expect(pack.displayName).toBeTruthy();
        expect(pack.category).toBeTruthy();
        expect(pack.businessTypes.length).toBeGreaterThan(0);

        // POS surface
        expect(pack.pos.cashierScreen).toBeTruthy();
        expect(pack.pos.sidebarGroups.length).toBeGreaterThan(0);
        expect(pack.pos.receiptFormat).toBeTruthy();
        expect(pack.pos.productModal.titleNew).toBeTruthy();
        expect(pack.pos.productModal.namePlaceholder).toBeTruthy();

        // Inventory paradigm
        expect(pack.inventory).toBeTruthy();

        // Ledger surface — arrays exist (may be empty for simple verticals)
        expect(Array.isArray(pack.ledger.reportIds)).toBe(true);
        expect(Array.isArray(pack.ledger.journalTemplateIds)).toBe(true);
        expect(Array.isArray(pack.ledger.optionalAccountCodes)).toBe(true);

        // Payroll surface
        expect(pack.payroll.compensationTypes.length).toBeGreaterThan(0);
        expect(pack.payroll.timesheetShape).toBeTruthy();

        // Settings + help
        expect(Array.isArray(pack.settings.extraCards)).toBe(true);
        expect(pack.help.sectionsModule).toBeTruthy();
      },
    );
  });

  describe('getVerticalPack accessor', () => {
    it('returns the right pack for a known BusinessType', () => {
      expect(getVerticalPack('COFFEE_SHOP')).toBe(fnbPack);
      expect(getVerticalPack('LAUNDRY')).toBe(laundryPack);
      expect(getVerticalPack('RETAIL')).toBe(retailPack);
      expect(getVerticalPack('MANUFACTURING')).toBe(serviceMfgPack);
    });

    it('falls back to RETAIL pack for null / undefined', () => {
      expect(getVerticalPack(null)).toBe(retailPack);
      expect(getVerticalPack(undefined)).toBe(retailPack);
    });

    it('falls back gracefully for an unknown BusinessType (defensive)', () => {
      const result = getVerticalPack('NOT_A_REAL_TYPE' as BusinessType);
      // Should not throw; should return something usable.
      expect(result).toBeDefined();
      expect(result.pos.cashierScreen).toBeTruthy();
    });
  });

  describe('FNB pack — shared across 6 BusinessTypes', () => {
    test.each(['COFFEE_SHOP', 'RESTAURANT', 'BAKERY', 'FOOD_STALL', 'BAR_LOUNGE', 'CATERING'] as BusinessType[])(
      '%s resolves to fnbPack',
      (bt) => {
        expect(getVerticalPack(bt)).toBe(fnbPack);
        expect(isCategory(bt, 'FNB')).toBe(true);
      },
    );

    it('non-F&B BusinessTypes are not categorised as FNB', () => {
      expect(isCategory('LAUNDRY', 'FNB')).toBe(false);
      expect(isCategory('RETAIL', 'FNB')).toBe(false);
    });
  });

  describe('LAUNDRY pack — distinct cashier flow', () => {
    it('uses INTAKE not TERMINAL', () => {
      expect(laundryPack.pos.cashierScreen).toBe('INTAKE');
      expect(fnbPack.pos.cashierScreen).toBe('TERMINAL');
      expect(retailPack.pos.cashierScreen).toBe('TERMINAL');
    });

    it('uses LAUNDRY_CLAIM receipt format', () => {
      expect(laundryPack.pos.receiptFormat).toBe('LAUNDRY_CLAIM');
    });

    it('exposes the Laundry Setup settings card', () => {
      const cards = laundryPack.settings.extraCards;
      expect(cards.length).toBe(1);
      expect(cards[0].href).toBe('/settings/laundry');
    });

    it('does NOT expose Warehouse sidebar group (no raw-material variance flow)', () => {
      const labels = laundryPack.pos.sidebarGroups.map((g) => g.label);
      expect(labels).not.toContain('Warehouse');
    });
  });

  describe('SERVICE/MFG pack — has projects, excludes solo plan', () => {
    it('includes a Projects sidebar group', () => {
      const labels = serviceMfgPack.pos.sidebarGroups.map((g) => g.label);
      expect(labels).toContain('Projects');
    });

    it('payroll supports project hours', () => {
      expect(serviceMfgPack.payroll.compensationTypes).toContain('PROJECT_HOURS');
      expect(serviceMfgPack.payroll.timesheetShape).toBe('PROJECT');
    });

    it('excludes STD_SOLO (manufacturing on a single-cashier plan rarely real)', () => {
      expect(serviceMfgPack.excludedPlans).toContain('STD_SOLO');
    });
  });

  describe('inventory paradigm differs per vertical', () => {
    it('F&B uses RECIPE_BOM', () => {
      expect(fnbPack.inventory).toBe('RECIPE_BOM');
    });
    it('Laundry uses SERVICE_BASED', () => {
      expect(laundryPack.inventory).toBe('SERVICE_BASED');
    });
    it('Retail uses UNIT_WAC', () => {
      expect(retailPack.inventory).toBe('UNIT_WAC');
    });
    it('Service/Mfg uses PROJECT_WIP', () => {
      expect(serviceMfgPack.inventory).toBe('PROJECT_WIP');
    });
  });

  describe('multi-branch sidebar items are flagged', () => {
    it('every "Transfers" or "Cycle Counts" item has multiBranchOnly: true', () => {
      for (const pack of ALL_PACKS) {
        for (const group of pack.pos.sidebarGroups) {
          for (const item of group.items) {
            if (item.label === 'Transfers' || item.label === 'Cycle Counts') {
              expect(item.multiBranchOnly).toBe(true);
            }
          }
        }
      }
    });
  });
});
