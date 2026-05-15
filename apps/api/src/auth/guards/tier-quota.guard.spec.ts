/**
 * TierQuotaGuard — plan-driven staff cap enforcement.
 *
 * Verifies the rewrite from the legacy SubscriptionTier model to the modular
 * pricing source of truth (PLAN_CAPS + staffSeatAddons). Each test simulates a
 * NestJS ExecutionContext and asserts canActivate's promise resolves or rejects
 * with the structured PLAN_CEILING_REACHED payload the frontend depends on.
 */
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { TierQuotaGuard } from './tier-quota.guard';

function makeCtx(user: any, body: any = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, body }),
    }),
  } as any;
}

function makePrismaMock() {
  return {
    tenant: { findUnique: jest.fn() },
    user:   { count:      jest.fn() },
  };
}

describe('TierQuotaGuard', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let guard: TierQuotaGuard;

  beforeEach(() => {
    prisma = makePrismaMock();
    guard  = new TierQuotaGuard(prisma as any);
  });

  it('bypasses platform admins (isSuperAdmin)', async () => {
    const ctx = makeCtx({ isSuperAdmin: true, tenantId: null });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('bypasses requests with no tenant scope', async () => {
    const ctx = makeCtx({ isSuperAdmin: false, tenantId: null });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('skips the cap when creating a KIOSK_DISPLAY (no seat consumed)', async () => {
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'KIOSK_DISPLAY' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('skips the cap when creating an EXTERNAL_AUDITOR', async () => {
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'external_auditor' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws when tenant is missing', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    const ctx = makeCtx({ tenantId: 't-missing' }, { role: 'CASHIER' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows when current staff < plan ceiling', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ planCode: 'SOLO_PRO', staffSeatAddons: 0 });
    prisma.user.count.mockResolvedValue(3); // ceiling is 5
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects with PLAN_CEILING_REACHED payload when at the cap', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ planCode: 'SOLO_LITE', staffSeatAddons: 0 });
    prisma.user.count.mockResolvedValue(1); // STD_SOLO ceiling = 1
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({
        code:         'PLAN_CEILING_REACHED',
        planCode:     'SOLO_LITE',
        currentCount: 1,
        ceiling:      1,
      }),
    });
  });

  it('respects purchased addons when computing the ceiling', async () => {
    // STD_BIZ base = 10, maxAddons = 15 → buyer has bought 2 seats → ceiling = 12
    prisma.tenant.findUnique.mockResolvedValue({ planCode: 'STD_BIZ', staffSeatAddons: 2 });
    prisma.user.count.mockResolvedValue(11);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('caps at PLAN_CAPS.maxTotal even if addons exceed maxAddons', async () => {
    // STD_SOLO has maxAddons=0; tenant somehow has 99 addons → ceiling stays 1
    prisma.tenant.findUnique.mockResolvedValue({ planCode: 'SOLO_LITE', staffSeatAddons: 99 });
    prisma.user.count.mockResolvedValue(1);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ ceiling: 1, maxAllowed: 1 }),
    });
  });

  it('falls back to SUITE_T2 when planCode is null (legacy tenants)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ planCode: null, staffSeatAddons: 0 });
    prisma.user.count.mockResolvedValue(5);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    // SUITE_T2 ceiling allows 10 → 5 < 10 → pass
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('does not count BUSINESS_OWNER toward the seat cap (filter in user.count where)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ planCode: 'STD_BIZ', staffSeatAddons: 0 });
    prisma.user.count.mockResolvedValue(0);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    await guard.canActivate(ctx);

    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { notIn: expect.arrayContaining(['BUSINESS_OWNER', 'SUPER_ADMIN', 'KIOSK_DISPLAY', 'EXTERNAL_AUDITOR']) },
        }),
      }),
    );
  });
});
