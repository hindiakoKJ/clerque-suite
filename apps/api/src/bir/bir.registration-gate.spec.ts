/**
 * BIR registration gate — a NON-VAT shop is BIR-registered.
 *
 * Signup sets taxStatus 'NON_VAT' but leaves the Tenant.isBirRegistered column
 * at its schema default (false). The gate used to read only that column, so a
 * NON-VAT cafe got 403 on every tax estimate and every BIR book while the web
 * app (whose token derives the flag from taxStatus) showed the page as open.
 */
import { ForbiddenException } from '@nestjs/common';
import { BirService, isTenantBirRegistered } from './bir.service';

describe('isTenantBirRegistered', () => {
  it('treats NON_VAT as registered even when the stored column is false', () => {
    expect(isTenantBirRegistered({ taxStatus: 'NON_VAT', isBirRegistered: false })).toBe(true);
  });

  it('treats VAT as registered', () => {
    expect(isTenantBirRegistered({ taxStatus: 'VAT', isBirRegistered: false })).toBe(true);
  });

  it('refuses a truly unregistered shop', () => {
    expect(isTenantBirRegistered({ taxStatus: 'UNREGISTERED', isBirRegistered: false })).toBe(false);
    expect(isTenantBirRegistered(null)).toBe(false);
  });

  it('still honours the legacy column so nothing that worked before breaks', () => {
    expect(isTenantBirRegistered({ isBirRegistered: true })).toBe(true);
    expect(isTenantBirRegistered({ taxStatus: 'UNREGISTERED', isBirRegistered: true })).toBe(true);
  });
});

describe('BirService — NON-VAT shop gets its estimates', () => {
  function makeService(tenantRow: unknown) {
    const prisma = {
      tenant:  { findUnique: jest.fn().mockResolvedValue(tenantRow) },
      account: {
        findMany: jest.fn().mockResolvedValue([
          {
            code: '4010', name: 'Sales Revenue', normalBalance: 'CREDIT',
            journalLines: [{ debit: 0, credit: 1000 }, { debit: 100, credit: 0 }],
          },
        ]),
      },
    };
    return { svc: new BirService(prisma as never), prisma };
  }

  it('returns the 2551Q percentage-tax estimate for NON_VAT with the column still false', async () => {
    const { svc } = makeService({ taxStatus: 'NON_VAT', isBirRegistered: false });
    const r = await svc.get2551QData('t1', 2026, 3);
    expect(r.grossReceipts).toBe(900);
    expect(r.percentageTaxAmount).toBe(27);
  });

  it('returns the 1701Q income-tax estimate for NON_VAT with the column still false', async () => {
    const { svc } = makeService({ taxStatus: 'NON_VAT', isBirRegistered: false });
    await expect(svc.get1701QData('t1', 2026, 3)).resolves.toBeDefined();
  });

  it('refuses an unregistered shop in plain words with the support address', async () => {
    const { svc } = makeService({ taxStatus: 'UNREGISTERED', isBirRegistered: false });
    const err = await svc.get2551QData('t1', 2026, 3).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String(err.message)).toContain('not registered');
    expect(String(err.message)).toContain('devsupport@hnscorpph.com');
  });
});
