/**
 * PH statutory contribution + WHT table tests.
 *
 * Test cases drawn from real-world worked examples (HR/payroll forums,
 * official SSS/PhilHealth/Pag-IBIG/BIR sample computations). Boundary
 * cases at MSC bracket edges and WHT bracket transitions.
 */
import {
  sssMsc, sssMonthly,
  philhealthMonthly,
  pagibigMonthly,
  computeWithholdingTax,
  computePayslip,
  toMonthlyGross,
  freqFactor,
} from './ph-tax-tables';

describe('PH Tax Tables', () => {
  describe('SSS — 2025 contribution schedule (5% EE / 10% ER + ₱30 EC)', () => {
    it('floors MSC at ₱4,000 for very low earners', () => {
      expect(sssMsc(2_000)).toBe(4_000);
      expect(sssMonthly(2_000).ee).toBe(200);   // 4000 × 5%
    });

    it('caps MSC at ₱30,000 for high earners', () => {
      expect(sssMsc(50_000)).toBe(30_000);
      expect(sssMonthly(50_000).ee).toBe(1_500); // 30000 × 5%
    });

    it('rounds to ₱500 buckets', () => {
      // ₱14,750 → bucket 14,500
      expect(sssMsc(14_750)).toBe(14_500);
      // ₱15,250 (just above midpoint) → 15,000
      expect(sssMsc(15_250)).toBe(15_000);
    });

    it('₱20,000 monthly → MSC ₱20,000 / EE ₱1,000 / ER ₱2,000 / EC ₱30', () => {
      const r = sssMonthly(20_000);
      expect(r.msc).toBe(20_000);
      expect(r.ee).toBe(1_000);
      expect(r.er).toBe(2_000);
      expect(r.ec).toBe(30);
    });
  });

  describe('PhilHealth — 5% premium split 50/50', () => {
    it('floor: ₱8,000 gross still pays the ₱250 minimum', () => {
      const r = philhealthMonthly(8_000);
      expect(r.ee).toBe(250);
      expect(r.er).toBe(250);
    });

    it('₱30,000 gross → ₱750 each (5% × 30000 / 2)', () => {
      const r = philhealthMonthly(30_000);
      expect(r.ee).toBe(750);
      expect(r.er).toBe(750);
    });

    it('caps at ₱2,500 each on ₱100,000+ gross', () => {
      expect(philhealthMonthly(100_000).ee).toBe(2_500);
      expect(philhealthMonthly(500_000).ee).toBe(2_500);
    });
  });

  describe('Pag-IBIG (HDMF) — capped on ₱10,000 MMC', () => {
    it('low earner (MMC ₱1,000): 1% EE / 2% ER', () => {
      const r = pagibigMonthly(1_000);
      expect(r.ee).toBe(10);
      expect(r.er).toBe(20);
    });

    it('₱5,000 MMC: 2% EE / 2% ER', () => {
      const r = pagibigMonthly(5_000);
      expect(r.ee).toBe(100);
      expect(r.er).toBe(100);
    });

    it('caps at ₱200 each (MMC ≥ ₱10,000)', () => {
      expect(pagibigMonthly(10_000).ee).toBe(200);
      expect(pagibigMonthly(50_000).ee).toBe(200);
    });
  });

  describe('BIR Withholding Tax — RR 11-2018 per-period tables', () => {
    describe('Semi-monthly', () => {
      it('₱10,000 (below first bracket) → ₱0', () => {
        expect(computeWithholdingTax(10_000, 'SEMI_MONTHLY')).toBe(0);
      });

      it('₱15,000 (in 15% bracket) → 15% × (15000 - 10417)', () => {
        // (15000 - 10417) × 0.15 = 687.45
        expect(computeWithholdingTax(15_000, 'SEMI_MONTHLY')).toBeCloseTo(687.45, 1);
      });

      it('₱30,000 (in 20% bracket) → 937.50 + 20% × (30000 - 16667)', () => {
        // 937.50 + (30000 - 16667) × 0.20 = 937.50 + 2666.60 = 3604.10
        expect(computeWithholdingTax(30_000, 'SEMI_MONTHLY')).toBeCloseTo(3_604.10, 1);
      });

      it('₱500,000 (top 35% bracket)', () => {
        // 91770.70 + (500000 - 333333) × 0.35 = 91770.70 + 58333.45 = 150104.15
        expect(computeWithholdingTax(500_000, 'SEMI_MONTHLY')).toBeCloseTo(150_104.15, 0);
      });
    });

    describe('Monthly', () => {
      it('₱20,833 (top of 0% bracket) → ₱0', () => {
        expect(computeWithholdingTax(20_833, 'MONTHLY')).toBe(0);
      });

      it('₱30,000 monthly → ~15% bracket', () => {
        // (30000 - 20833) × 0.15 = 1375.05
        expect(computeWithholdingTax(30_000, 'MONTHLY')).toBeCloseTo(1_375.05, 1);
      });

      it('₱100,000 monthly → 25% bracket', () => {
        // 8541.80 + (100000 - 66667) × 0.25 = 8541.80 + 8333.25 = 16875.05
        expect(computeWithholdingTax(100_000, 'MONTHLY')).toBeCloseTo(16_875.05, 1);
      });
    });

    it('zero or negative taxable → ₱0', () => {
      expect(computeWithholdingTax(0, 'SEMI_MONTHLY')).toBe(0);
      expect(computeWithholdingTax(-500, 'MONTHLY')).toBe(0);
    });
  });

  describe('toMonthlyGross + freqFactor are inverses (within rounding)', () => {
    it('semi-monthly: factor 0.5, ×2 to monthly', () => {
      expect(freqFactor('SEMI_MONTHLY')).toBe(0.5);
      expect(toMonthlyGross(15_000, 'SEMI_MONTHLY')).toBe(30_000);
    });
    it('monthly: factor 1, identity', () => {
      expect(freqFactor('MONTHLY')).toBe(1);
      expect(toMonthlyGross(30_000, 'MONTHLY')).toBe(30_000);
    });
    it('weekly: factor 7/30, ×52/12 to monthly', () => {
      expect(freqFactor('WEEKLY')).toBeCloseTo(0.2333, 3);
      expect(toMonthlyGross(7_000, 'WEEKLY')).toBeCloseTo(30_333.33, 1);
    });
  });

  describe('computePayslip — one-shot integration', () => {
    it('₱15,000 semi-monthly basic + ₱0 OT (i.e. ₱30k/mo employee)', () => {
      const slip = computePayslip({
        basicPay:   15_000,
        otPay:      0,
        allowances: 0,
        freq:       'SEMI_MONTHLY',
      });

      expect(slip.gross).toBe(15_000);
      // Monthly equivalent ₱30k → SSS MSC 30k → ee 1500/month → 750 semi-monthly
      expect(slip.sssEe).toBe(750);
      // PH 30k × 5% / 2 = 750/month → 375 semi-monthly
      expect(slip.philhealthEe).toBe(375);
      // Pag-IBIG capped 200/month → 100 semi-monthly
      expect(slip.pagibigEe).toBe(100);
      // Taxable = 15000 - 750 - 375 - 100 = 13775
      expect(slip.taxableGross).toBe(13_775);
      // WHT semi-monthly ₱13775 → 15% × (13775 - 10417) = 503.70
      expect(slip.withholdingTax).toBeCloseTo(503.70, 1);
      // Net = gross - SSS - PH - HDMF - WHT
      expect(slip.net).toBeCloseTo(13_271.30, 1);
    });

    it('non-taxable allowance not subject to WHT or SSS', () => {
      const slip = computePayslip({
        basicPay:   15_000,
        otPay:      0,
        allowances: 2_000,    // de minimis (rice / transpo)
        freq:       'SEMI_MONTHLY',
      });
      // Statutory contributions look at taxable base only (15k), unchanged
      expect(slip.sssEe).toBe(750);
      expect(slip.philhealthEe).toBe(375);
      // Net = 15000 + 2000 - statutory deductions
      expect(slip.gross).toBe(17_000);
      expect(slip.net).toBeCloseTo(15_271.30, 1);
    });

    it('low earner below WHT threshold pays SSS+PH+HDMF but ₱0 income tax', () => {
      const slip = computePayslip({
        basicPay:   8_000,    // ₱16k/mo equivalent
        otPay:      0,
        allowances: 0,
        freq:       'SEMI_MONTHLY',
      });
      // Taxable semi-monthly: 8000 - SSS - PH - HDMF — well below ₱10,417
      expect(slip.withholdingTax).toBe(0);
      // SSS MSC for 16k → 16,000 → ee 800/mo → 400 semi-monthly
      expect(slip.sssEe).toBe(400);
    });
  });
});
