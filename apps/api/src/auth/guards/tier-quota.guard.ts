import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PLAN_CAPS, effectiveSeatCeiling, type PlanCode } from '@repo/shared-types';
import type { JwtPayload } from '@repo/shared-types';

/**
 * TierQuotaGuard — enforces the staff cap for the current tenant's plan.
 *
 * Renamed semantically from the old "tier" model: the source of truth is now
 * `Tenant.planCode` + `staffSeatAddons` resolved through PLAN_CAPS. The
 * legacy `Tenant.tier` enum is no longer consulted.
 *
 * Apply to POST /users to reject creation when the tenant has already hit
 * the plan's staff cap. The frontend disables the "Add Staff" button via the
 * same logic, but this guard is the authoritative check.
 *
 * Owners (BUSINESS_OWNER) and SUPER_ADMIN are NOT counted toward the cap.
 *
 * Throws ForbiddenException with structured payload:
 *   { code: 'PLAN_CEILING_REACHED', planCode, currentCount, ceiling, message }
 */
@Injectable()
export class TierQuotaGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;
    if (!user || user.isSuperAdmin) return true; // platform admins bypass
    if (!user.tenantId) return true;             // no tenant scope to check

    // Service / display accounts (KIOSK_DISPLAY, EXTERNAL_AUDITOR) don't take
    // a seat. Skip the quota check entirely when creating one of those.
    const newRole = (req.body?.role ?? '').toUpperCase();
    if (['KIOSK_DISPLAY', 'EXTERNAL_AUDITOR'].includes(newRole)) return true;

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: user.tenantId },
      select: { planCode: true, staffSeatAddons: true },
    });
    if (!tenant) {
      throw new ForbiddenException('Tenant not found.');
    }

    const planCode = (tenant.planCode ?? 'SUITE_T2') as PlanCode;
    const ceiling  = effectiveSeatCeiling(planCode, tenant.staffSeatAddons ?? 0);

    // Count active non-owner / non-machine staff.
    const currentCount = await this.prisma.user.count({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        role: { notIn: ['BUSINESS_OWNER', 'SUPER_ADMIN', 'KIOSK_DISPLAY', 'EXTERNAL_AUDITOR'] },
      },
    });

    if (currentCount < ceiling) return true;

    const cap = PLAN_CAPS[planCode];
    throw new ForbiddenException({
      code:          'PLAN_CEILING_REACHED',
      planCode,
      currentCount,
      ceiling,
      maxAllowed:    cap.maxTotal,
      message:
        `Your ${planCode} plan allows up to ${ceiling} staff. ` +
        (cap.maxAddons > 0
          ? `Buy additional seats from Settings → Subscription, or upgrade to a higher plan.`
          : `Upgrade to a higher plan to add more staff.`),
    });
  }
}
