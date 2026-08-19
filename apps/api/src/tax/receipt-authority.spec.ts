/**
 * receiptAuthority() — what document a POS receipt IS.
 *
 * Owner's rule (KJ): decided by THE TENANT's own status (taxStatus +
 * isPtuHolder), never by HNS's registration and never by the global provider
 * phase alone. The phase is only a safety catch: phase 1 holds everyone at
 * Acknowledgement Receipt; phase 2 must NEVER promote a non-PTU tenant.
 *
 * Pure function — lives in packages/shared-types (no test runner there), so
 * the contract is pinned here. apps/counter/src/receipt/receiptAuthority.ts carries a
 * local mirror of the same function (Counter builds standalone for Expo);
 * if this spec changes, update the mirror in lock-step.
 */
import { receiptAuthority, ACKNOWLEDGEMENT_DISCLAIMER } from '@repo/shared-types';

const AR = {
  kind:         'ACKNOWLEDGEMENT',
  title:        'ACKNOWLEDGEMENT RECEIPT',
  titleFil:     'Resibo ng Pagtanggap',
  numberPrefix: 'AR',
  showVatLine:  false,
  showPtu:      false,
  disclaimer:   ACKNOWLEDGEMENT_DISCLAIMER,
} as const;

describe('receiptAuthority()', () => {
  it('(a) UNREGISTERED → ACKNOWLEDGEMENT regardless of phase / PTU', () => {
    expect(receiptAuthority({ taxStatus: 'UNREGISTERED' })).toEqual(AR);
    expect(receiptAuthority({ taxStatus: 'UNREGISTERED', isPtuHolder: false, phase: 1 })).toEqual(AR);
    expect(receiptAuthority({ taxStatus: 'UNREGISTERED', isPtuHolder: true,  phase: 1 })).toEqual(AR);
    expect(receiptAuthority({ taxStatus: 'UNREGISTERED', isPtuHolder: false, phase: 2 })).toEqual(AR);
    expect(receiptAuthority({ taxStatus: 'UNREGISTERED', isPtuHolder: true,  phase: 2 })).toEqual(AR);
  });

  it('(b) VAT + ptu=false + phase 2 → ACKNOWLEDGEMENT (registration alone is not enough)', () => {
    expect(receiptAuthority({ taxStatus: 'VAT', isPtuHolder: false, phase: 2 })).toEqual(AR);
    // undefined / null PTU flag must fail safe the same way
    expect(receiptAuthority({ taxStatus: 'VAT', phase: 2 })).toEqual(AR);
    expect(receiptAuthority({ taxStatus: 'VAT', isPtuHolder: null, phase: 2 })).toEqual(AR);
    expect(receiptAuthority({ taxStatus: 'NON_VAT', isPtuHolder: false, phase: 2 })).toEqual(AR);
  });

  it('(c) VAT + ptu=true + phase 1 → ACKNOWLEDGEMENT (provider safety catch holds)', () => {
    expect(receiptAuthority({ taxStatus: 'VAT', isPtuHolder: true, phase: 1 })).toEqual(AR);
    expect(receiptAuthority({ taxStatus: 'NON_VAT', isPtuHolder: true, phase: 1 })).toEqual(AR);
  });

  it('(d) VAT + ptu=true + phase 2 → VAT SALES INVOICE, SI, VAT line, PTU, no disclaimer', () => {
    expect(receiptAuthority({ taxStatus: 'VAT', isPtuHolder: true, phase: 2 })).toEqual({
      kind:         'SALES_INVOICE',
      title:        'VAT SALES INVOICE',
      titleFil:     'Resibo ng Benta',
      numberPrefix: 'SI',
      showVatLine:  true,
      showPtu:      true,
      disclaimer:   null,
    });
  });

  it('(e) NON_VAT + ptu=true + phase 2 → SALES INVOICE, no VAT line', () => {
    expect(receiptAuthority({ taxStatus: 'NON_VAT', isPtuHolder: true, phase: 2 })).toEqual({
      kind:         'SALES_INVOICE',
      title:        'SALES INVOICE',
      titleFil:     'Resibo ng Benta',
      numberPrefix: 'SI',
      showVatLine:  false,
      showPtu:      true,
      disclaimer:   null,
    });
  });

  it('never uses "Official Receipt" / "OR" wording (RA 11976 — Sales Invoice is the primary document)', () => {
    const all = (['UNREGISTERED', 'NON_VAT', 'VAT'] as const).flatMap((taxStatus) =>
      ([false, true] as const).flatMap((isPtuHolder) =>
        ([1, 2] as const).map((phase) => receiptAuthority({ taxStatus, isPtuHolder, phase })),
      ),
    );
    for (const a of all) {
      expect(a.title.toUpperCase()).not.toContain('OFFICIAL RECEIPT');
      expect(['AR', 'SI']).toContain(a.numberPrefix);
      // invariants: a Sales Invoice never carries the disclaimer and always shows PTU;
      // an Acknowledgement always carries it and never shows PTU / VAT line
      if (a.kind === 'SALES_INVOICE') {
        expect(a.disclaimer).toBeNull();
        expect(a.showPtu).toBe(true);
        expect(a.numberPrefix).toBe('SI');
      } else {
        expect(a.disclaimer).toBe(ACKNOWLEDGEMENT_DISCLAIMER);
        expect(a.showPtu).toBe(false);
        expect(a.showVatLine).toBe(false);
        expect(a.numberPrefix).toBe('AR');
      }
    }
  });

  it('falls back to getProviderPhase() (env NEXT_PUBLIC_PROVIDER_PHASE, default 1) when phase is omitted', () => {
    const prev = process.env.NEXT_PUBLIC_PROVIDER_PHASE;
    try {
      delete process.env.NEXT_PUBLIC_PROVIDER_PHASE;
      expect(receiptAuthority({ taxStatus: 'VAT', isPtuHolder: true }).kind).toBe('ACKNOWLEDGEMENT');
      process.env.NEXT_PUBLIC_PROVIDER_PHASE = '2';
      expect(receiptAuthority({ taxStatus: 'VAT', isPtuHolder: true }).kind).toBe('SALES_INVOICE');
      // phase 2 from env still never promotes a non-PTU tenant
      expect(receiptAuthority({ taxStatus: 'VAT', isPtuHolder: false }).kind).toBe('ACKNOWLEDGEMENT');
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_PROVIDER_PHASE;
      else process.env.NEXT_PUBLIC_PROVIDER_PHASE = prev;
    }
  });
});
