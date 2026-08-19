/**
 * TierQuotaGuard — plan-driven staff cap enforcement.
 *
 * Each test simulates a NestJS ExecutionContext and asserts canActivate's
 * promise resolves or rejects with the structured PLAN_CEILING_REACHED payload
 * the frontend depends on.
 *
 * The ceilings these tests used to assert (1 seat on SOLO_LITE, 20+30 on
 * SUITE_T3) belonged to the retired plan ladder. Seat caps are now a
 * deliberate placeholder pending pricing, so the tests derive the ceiling
 * from PLAN_CAPS rather than hard-coding a number — they verify the
 * MECHANISM, which is what has to keep working when real numbers land.
 */
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { PLAN_CAPS, DEFAULT_PLAN_CODE } from '@repo/shared-types';
import { TierQuotaGuard } from './tier-quota.guard';

const CEILING = PLAN_CAPS[DEFAULT_PLAN_CODE].maxTotal;

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
    prisma.tenant.findUnique.mockResolvedValue({ planCode: DEFAULT_PLAN_CODE, staffSeatAddons: 0 });
    prisma.user.count.mockResolvedValue(CEILING - 1);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects with PLAN_CEILING_REACHED payload when at the cap', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ planCode: DEFAULT_PLAN_CODE, staffSeatAddons: 0 });
    prisma.user.count.mockResolvedValue(CEILING);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({
        code:         'PLAN_CEILING_REACHED',
        planCode:     DEFAULT_PLAN_CODE,
        currentCount: CEILING,
        ceiling:      CEILING,
      }),
    });
  });

  it('respects purchased addons when computing the ceiling', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ planCode: DEFAULT_PLAN_CODE, staffSeatAddons: 2 });
    prisma.user.count.mockResolvedValue(CEILING - 1);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('caps at PLAN_CAPS.maxTotal even if addons exceed maxAddons', async () => {
    // A tenant row with more addons than the plan sells must not raise the
    // ceiling above maxTotal.
    prisma.tenant.findUnique.mockResolvedValue({ planCode: DEFAULT_PLAN_CODE, staffSeatAddons: 99_999 });
    prisma.user.count.mockResolvedValue(CEILING);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ ceiling: CEILING, maxAllowed: CEILING }),
    });
  });

  it('resolves a null planCode onto the package rather than throwing', async () => {
    // A null or legacy planCode used to fall back to the lowest tier, which
    // silently gave the tenant a 1-seat ceiling. It now resolves onto the
    // package like every other unrecognised value.
    prisma.tenant.findUnique.mockResolvedValue({ planCode: null, staffSeatAddons: 0 });
    prisma.user.count.mockResolvedValue(0);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('still enforces the ceiling for a legacy planCode', async () => {
    // The fallback must not be silently permissive: a stored SUITE_T2 row
    // gets the package ceiling, and being at it still rejects.
    prisma.tenant.findUnique.mockResolvedValue({ planCode: 'SUITE_T2', staffSeatAddons: 0 });
    prisma.user.count.mockResolvedValue(CEILING);
    const ctx = makeCtx({ tenantId: 't1' }, { role: 'CASHIER' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ ceiling: CEILING }),
    });
  });

  it('does not count BUSINESS_OWNER toward the seat cap (filter in user.count where)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ planCode: 'SUITE_T3', staffSeatAddons: 0 });
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
