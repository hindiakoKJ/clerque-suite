import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TaxCalculatorService, round2 } from './tax.service';

describe('TaxCalculatorService', () => {
  let svc: TaxCalculatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaxCalculatorService],
    }).compile();

    svc = module.get(TaxCalculatorService);
  });

  // ─── round2 helper ────────────────────────────────────────────────────────

  describe('round2()', () => {
    it('rounds .5 away from zero (BIR standard)', () => {
      expect(round2(1.005)).toBe(1.01);
      expect(round2(1.125)).toBe(1.13);
    });

    it('rounds negative values correctly', () => {
      expect(round2(-1.005)).toBe(-1);  // Math.round(-1.004999…) = -1
    });

    it('leaves already-rounded values unchanged', () => {
      expect(round2(100)).toBe(100);
      expect(round2(1.50)).toBe(1.5);
    });
  });

  // ─── computeTaxBreakdown ──────────────────────────────────────────────────

  describe('computeTaxBreakdown()', () => {
    describe('VAT tenant', () => {
      it('extracts 12% VAT from a VAT-inclusive gross', () => {
        // ₱112 gross → ₱100 net + ₱12 VAT
        const result = svc.computeTaxBreakdown(112, 'VAT');
        expect(result.netAmount).toBe(100);
        expect(result.vatAmount).toBe(12);
        expect(result.totalAmount).toBe(112);
      });

      it('populates vatableSales with the gross amount', () => {
        const result = svc.computeTaxBreakdown(112, 'VAT');
        expect(result.vatableSales).toBe(112);
        expect(result.vatExemptSales).toBe(0);
        expect(result.zeroRatedSales).toBe(0);
      });

      it('handles a common POS total (₱85)', () => {
        const result = svc.computeTaxBreakdown(85, 'VAT');
        // net = 85 / 1.12 = 75.89..., rounded = 75.89
        expect(result.netAmount).toBe(round2(85 / 1.12));
        expect(result.vatAmount).toBe(round2(85 - round2(85 / 1.12)));
        expect(result.totalAmount).toBe(85);
      });
    });

    describe('NON_VAT tenant', () => {
      it('has zero VAT and net equals gross', () => {
        const result = svc.computeTaxBreakdown(500, 'NON_VAT');
        expect(result.vatAmount).toBe(0);
        expect(result.netAmount).toBe(500);
        expect(result.grossAmount).toBe(500);
      });

      it('has zero vatableSales', () => {
        const result = svc.computeTaxBreakdown(500, 'NON_VAT');
        expect(result.vatableSales).toBe(0);
      });
    });

    describe('UNREGISTERED tenant', () => {
      it('behaves identically to NON_VAT — zero VAT', () => {
        const result = svc.computeTaxBreakdown(500, 'UNREGISTERED');
        expect(result.vatAmount).toBe(0);
        expect(result.netAmount).toBe(500);
      });
    });
  });

  // ─── assertVatConsistency ─────────────────────────────────────────────────

  describe('assertVatConsistency()', () => {
    it('does not throw for VAT tenant with any vatAmount', () => {
      expect(() => svc.assertVatConsistency(12, 'VAT')).not.toThrow();
      expect(() => svc.assertVatConsistency(0,  'VAT')).not.toThrow();
    });

    it('does not throw for NON_VAT tenant with vatAmount = 0', () => {
      expect(() => svc.assertVatConsistency(0, 'NON_VAT')).not.toThrow();
    });

    it('throws BadRequestException for NON_VAT tenant with vatAmount > 0', () => {
      expect(() => svc.assertVatConsistency(12, 'NON_VAT')).toThrow(BadRequestException);
    });

    it('throws BadRequestException for UNREGISTERED tenant with vatAmount > 0', () => {
      expect(() => svc.assertVatConsistency(0.01, 'UNREGISTERED')).toThrow(BadRequestException);
    });

    it('error message identifies the tenant tax status', () => {
      try {
        svc.assertVatConsistency(5, 'NON_VAT');
      } catch (e) {
        expect((e as BadRequestException).message).toContain('NON_VAT');
      }
    });
  });

  // ─── computePwdScDiscount ────────────────────────────────────────────────

  describe('computePwdScDiscount()', () => {
    describe('VAT tenant', () => {
      it('strips VAT before applying 20% discount (RA 9994)', () => {
        // ₱112 gross → ₱100 VAT-exclusive → 20% discount = ₱20
        const result = svc.computePwdScDiscount(112, 'VAT');
        expect(result.vatExclusiveBase).toBe(100);
        expect(result.discountOnBase).toBe(20);
        expect(result.discountedVatExclusive).toBe(80);
      });

      it('recomputes 12% VAT on the discounted base', () => {
        // ₱80 discounted net → ₱80 × 0.12 = ₱9.60 VAT → ₱89.60 total
        const result = svc.computePwdScDiscount(112, 'VAT');
        expect(result.vatOnDiscounted).toBe(round2(80 * 0.12));
        expect(result.discountedTotal).toBe(round2(80 + 80 * 0.12));
      });

      it('totalSavings = original gross − discounted total', () => {
        const result = svc.computePwdScDiscount(112, 'VAT');
        expect(result.totalSavings).toBe(round2(112 - result.discountedTotal));
      });
    });

    describe('NON_VAT tenant', () => {
      it('applies 20% directly on gross (no VAT stripping)', () => {
        const result = svc.computePwdScDiscount(100, 'NON_VAT');
        expect(result.vatExclusiveBase).toBe(100);
        expect(result.discountOnBase).toBe(20);
        expect(result.discountedTotal).toBe(80);
      });

      it('vatOnDiscounted is always 0', () => {
        const result = svc.computePwdScDiscount(100, 'NON_VAT');
        expect(result.vatOnDiscounted).toBe(0);
      });

      it('totalSavings equals the 20% discount amount', () => {
        const result = svc.computePwdScDiscount(100, 'NON_VAT');
        expect(result.totalSavings).toBe(20);
      });
    });

    describe('UNREGISTERED tenant', () => {
      it('behaves identically to NON_VAT', () => {
        const r1 = svc.computePwdScDiscount(500, 'NON_VAT');
        const r2 = svc.computePwdScDiscount(500, 'UNREGISTERED');
        expect(r1).toEqual(r2);
      });
    });
  });

  // ─── validateTin ─────────────────────────────────────────────────────────

  describe('validateTin()', () => {
    it('accepts a valid 15-char BIR TIN format', () => {
      expect(svc.validateTin('123-456-789-00001')).toBe('123-456-789-00001');
    });

    it('normalises to uppercase and trims whitespace', () => {
      expect(svc.validateTin('  123-456-789-00001  ')).toBe('123-456-789-00001');
    });

    it('throws BadRequestException for 9-segment TIN (missing branch code)', () => {
      expect(() => svc.validateTin('123-456-789')).toThrow(BadRequestException);
    });

    it('throws for TIN with letters', () => {
      expect(() => svc.validateTin('ABC-456-789-00001')).toThrow(BadRequestException);
    });

    it('throws for completely invalid string', () => {
      expect(() => svc.validateTin('not-a-tin')).toThrow(BadRequestException);
    });

    it('error message includes the invalid value', () => {
      try {
        svc.validateTin('bad-tin');
      } catch (e) {
        expect((e as BadRequestException).message).toContain('bad-tin'.toUpperCase());
      }
    });
  });
});
