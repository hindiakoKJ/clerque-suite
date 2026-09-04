import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '@repo/shared-types';
import { isAiEnabled } from './ai-availability';
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

    // Master switch first — ahead of the platform-admin bypass below, because
    // "AI is off" has to mean everyone, including support. Anything less and
    // the deployment still has a live path to a paid provider.
    if (!isAiEnabled()) {
      throw new ForbiddenException({
        code:          'AI_DISABLED',
        monthlyQuota:  0,
        usedThisMonth: 0,
        message:       'AI features are temporarily unavailable.',
      });
    }

    // Platform admins bypass — useful for support / debugging
    if (user?.isSuperAdmin) return true;

    const quota = user?.aiQuotaMonthly ?? 0;
    const tenantId = user?.tenantId;

    if (quota === 0 || !tenantId) {
      throw new ForbiddenException({
        code:          'AI_NOT_ENABLED',
        monthlyQuota:  0,
        usedThisMonth: 0,
        // Named Team / Pair T2 / Suite before — plans that no longer exist.
        // With no AI bundled into the package, this is the normal state for a
        // new tenant, so the message has to say what to actually do.
        message:       'AI features are not active on this account. Add an AI add-on to enable them.',
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
        // Procure's receipt reader spends a prompt like the others and is
        // counted like the others; left off this list it was free.
        action:    { in: ['journal_drafter', 'journal_guide', 'receipt_ocr', 'procure_receipt_lines'] },
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
