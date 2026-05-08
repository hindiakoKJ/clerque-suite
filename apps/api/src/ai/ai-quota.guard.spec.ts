/**
 * AiQuotaGuard — monthly AI prompt quota enforcement.
 *
 * Verifies the structured 403 payload the frontend uses for upgrade CTAs and
 * confirms platform admins bypass. Mocks Prisma so no DB is touched.
 */
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { AiQuotaGuard } from './ai-quota.guard';

function makeCtx(user: any) {
  const req: any = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    _req: req, // exposed for assertions
  } as any;
}

function makePrismaMock() {
  return { aiUsage: { count: jest.fn() } };
}

describe('AiQuotaGuard', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let guard: AiQuotaGuard;

  beforeEach(() => {
    prisma = makePrismaMock();
    guard  = new AiQuotaGuard(prisma as any);
  });

  it('bypasses platform admins', async () => {
    const ctx = makeCtx({ isSuperAdmin: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.aiUsage.count).not.toHaveBeenCalled();
  });

  it('rejects with AI_NOT_ENABLED when quota=0', async () => {
    const ctx = makeCtx({ tenantId: 't1', aiQuotaMonthly: 0 });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({
        code:         'AI_NOT_ENABLED',
        monthlyQuota: 0,
      }),
    });
  });

  it('rejects with AI_NOT_ENABLED when no tenantId', async () => {
    const ctx = makeCtx({ aiQuotaMonthly: 100 });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AI_NOT_ENABLED' }),
    });
  });

  it('uses TIER_5+ language no longer — message references plan tiers / addons', async () => {
    const ctx = makeCtx({ tenantId: 't1', aiQuotaMonthly: 0 });
    try {
      await guard.canActivate(ctx);
      fail('expected throw');
    } catch (e: any) {
      const msg = e.response.message as string;
      expect(msg).not.toMatch(/TIER_/i);
      expect(msg).toMatch(/Team|Pair|Suite|add-on/i);
    }
  });

  it('allows when used < quota and attaches usage to req', async () => {
    prisma.aiUsage.count.mockResolvedValue(50);
    const ctx = makeCtx({ tenantId: 't1', aiQuotaMonthly: 200 });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx._req.aiUsage).toEqual({ used: 50, quota: 200 });
  });

  it('rejects with AI_QUOTA_EXCEEDED when used >= quota', async () => {
    prisma.aiUsage.count.mockResolvedValue(200);
    const ctx = makeCtx({ tenantId: 't1', aiQuotaMonthly: 200 });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({
        code:           'AI_QUOTA_EXCEEDED',
        monthlyQuota:   200,
        usedThisMonth:  200,
      }),
    });
  });

  it('counts only journal_drafter / journal_guide / receipt_ocr — Smart Picker is free', async () => {
    prisma.aiUsage.count.mockResolvedValue(10);
    const ctx = makeCtx({ tenantId: 't1', aiQuotaMonthly: 100 });
    await guard.canActivate(ctx);

    expect(prisma.aiUsage.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          action: { in: ['journal_drafter', 'journal_guide', 'receipt_ocr'] },
        }),
      }),
    );
  });

  it('scopes the count to the current calendar month (UTC)', async () => {
    prisma.aiUsage.count.mockResolvedValue(0);
    const ctx = makeCtx({ tenantId: 't1', aiQuotaMonthly: 50 });
    await guard.canActivate(ctx);

    const call = prisma.aiUsage.count.mock.calls[0][0] as any;
    const gte: Date = call.where.createdAt.gte;
    expect(gte.getUTCDate()).toBe(1);
    expect(gte.getUTCHours()).toBe(0);
    expect(gte.getUTCMinutes()).toBe(0);
  });
});
