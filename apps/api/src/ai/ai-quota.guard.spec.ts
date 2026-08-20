/**
 * AiQuotaGuard — the master switch, then monthly prompt quota enforcement.
 *
 * Verifies the structured 403 payload the frontend uses for upgrade CTAs and
 * confirms platform admins bypass the QUOTA (but not the master switch).
 * Mocks Prisma so no DB is touched.
 *
 * These tests switch AI ON, because otherwise the master switch short-circuits
 * every one of them — which is itself covered, in the "master switch" block
 * at the bottom.
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

  const ORIGINAL_ENV = process.env.AI_FEATURES_ENABLED;

  beforeEach(() => {
    process.env.AI_FEATURES_ENABLED = 'true';
    prisma = makePrismaMock();
    guard  = new AiQuotaGuard(prisma as any);
  });

  afterAll(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.AI_FEATURES_ENABLED;
    else process.env.AI_FEATURES_ENABLED = ORIGINAL_ENV;
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

  it('tells the user what to actually do, without naming a retired plan', async () => {
    // No AI is bundled with the package, so this 403 is the normal first
    // experience rather than an edge case — the message has to be actionable.
    // It used to name TIER_5, then Team / Pair T2 / Suite; none of those
    // plans exist any more.
    const ctx = makeCtx({ tenantId: 't1', aiQuotaMonthly: 0 });
    try {
      await guard.canActivate(ctx);
      fail('expected throw');
    } catch (e: any) {
      const msg = e.response.message as string;
      expect(msg).not.toMatch(/TIER_|\bTeam\b|\bPair\b|\bSuite\b|\bSolo\b/i);
      expect(msg).toMatch(/add-on/i);
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

  describe('master switch', () => {
    // "AI is off" has to mean everyone. If the platform-admin bypass ran
    // first, the deployment would still have a live path to a paid provider.
    const cases: Array<[string, string | undefined]> = [
      ['unset',        undefined],
      ['"false"',      'false'],
      ['"TRUE"',       'TRUE'],     // only the exact lowercase literal counts
      ['empty string', ''],
      ['"1"',          '1'],
    ];

    test.each(cases)('stays off when AI_FEATURES_ENABLED is %s', async (_label, value) => {
      if (value === undefined) delete process.env.AI_FEATURES_ENABLED;
      else process.env.AI_FEATURES_ENABLED = value;

      await expect(guard.canActivate(makeCtx({ tenantId: 't1', aiQuotaMonthly: 500 })))
        .rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_DISABLED' }) });
    });

    it('refuses a platform admin too', async () => {
      process.env.AI_FEATURES_ENABLED = 'false';
      await expect(guard.canActivate(makeCtx({ isSuperAdmin: true, tenantId: 't1' })))
        .rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_DISABLED' }) });
    });

    it('refuses a tenant holding a large SUPER_ADMIN override', async () => {
      process.env.AI_FEATURES_ENABLED = 'false';
      await expect(guard.canActivate(makeCtx({ tenantId: 't1', aiQuotaMonthly: 9_999 })))
        .rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_DISABLED' }) });
    });

    it('never reaches the usage query while off', async () => {
      process.env.AI_FEATURES_ENABLED = 'false';
      await guard.canActivate(makeCtx({ tenantId: 't1', aiQuotaMonthly: 500 })).catch(() => undefined);
      expect(prisma.aiUsage.count).not.toHaveBeenCalled();
    });

    it('lets a quota-holding tenant through once switched on', async () => {
      process.env.AI_FEATURES_ENABLED = 'true';
      prisma.aiUsage.count.mockResolvedValue(0);
      await expect(guard.canActivate(makeCtx({ tenantId: 't1', aiQuotaMonthly: 500 })))
        .resolves.toBe(true);
    });
  });
});
