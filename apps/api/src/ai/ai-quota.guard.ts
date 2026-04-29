import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AiQuotaGuard — rejects /ai/* requests when the tenant has hit their monthly
 * prompt quota. Counts AiUsage rows for the current calendar month (UTC).
 *
 * Quota source: JwtPayload.aiQuotaMonthly (set at login from tier + addon).
 *   = 0  → tier doesn't include AI and no addon active. 403 immediately.
 *   > 0  → check current-month usage; reject when count >= quota.
 *
 * Returns a structured 403 the frontend uses for upgrade CTAs:
 *   {
 *     code:        'AI_QUOTA_EXCEEDED' | 'AI_NOT_ENABLED',
 *     monthlyQuota: 200,
 *     usedThisMonth: 200,
 *     message:     '...',
 *   }
 *
 * Smart Account Picker is also under this guard — pure ranking is cheap, but
 * we count it as 0 prompts (handled in the controller, not here). Drafter,
 * Guide, OCR each cost 1 prompt.
 */
@Injectable()
export class AiQuotaGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;

    // Platform admins bypass — useful for support / debugging
    if (user?.isSuperAdmin) return true;

    const quota = user?.aiQuotaMonthly ?? 0;
    const tenantId = user?.tenantId;

    if (quota === 0 || !tenantId) {
      throw new ForbiddenException({
        code:          'AI_NOT_ENABLED',
        monthlyQuota:  0,
        usedThisMonth: 0,
        message:       'AI features are not active. Buy an add-on package or upgrade to TIER_5+ to enable.',
      });
    }

    // Smart Account Picker (no LLM) calls /ai/suggest-accounts — those are
    // free. We DON'T count rows for that action, so they never burn quota.
    // Drafter / Guide / OCR each create one row in AiUsage and DO count.
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const used = await this.prisma.aiUsage.count({
      where: {
        tenantId,
        createdAt: { gte: startOfMonth },
        action:    { in: ['journal_drafter', 'journal_guide', 'receipt_ocr'] },
      },
    });

    if (used >= quota) {
      throw new ForbiddenException({
        code:          'AI_QUOTA_EXCEEDED',
        monthlyQuota:  quota,
        usedThisMonth: used,
        message:       `You've used all ${quota} AI prompts this month. Upgrade your add-on or wait until next month.`,
      });
    }

    // Attach usage info to the request for downstream warning headers
    (req as { aiUsage?: { used: number; quota: number } }).aiUsage = { used, quota };
    return true;
  }
}
