import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { wouldExceedStaffCap, nextTier, type TierId } from '@repo/shared-types';
import type { JwtPayload } from '@repo/shared-types';

/**
 * TierQuotaGuard — enforces the staff cap for the current tenant's tier.
 *
 * Apply to POST /users to reject creation when the tenant has already hit
 * tier.maxStaff non-owner staff. The frontend disables the "Add Staff" button
 * via the same logic, but this guard is the authoritative check.
 *
 * Owners (BUSINESS_OWNER) and SUPER_ADMIN are NOT counted toward the cap.
 *
 * Throws ForbiddenException with structured payload that the frontend can
 * use to render the upgrade CTA with the correct target tier:
 *   { code: 'TIER_QUOTA_EXCEEDED', currentTier, requiredTier, currentCount, cap }
 */
@Injectable()
export class TierQuotaGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;
    if (!user || user.isSuperAdmin) return true; // platform admins bypass
    if (!user.tenantId) return true;             // no tenant scope to check

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: user.tenantId },
      select: { tier: true },
    });
    if (!tenant) {
      throw new ForbiddenException('Tenant not found.');
    }

    // Count active non-owner staff. BUSINESS_OWNER is the tenant admin and
    // not subject to the cap (multiple co-owners allowed without taking seats).
    const currentCount = await this.prisma.user.count({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        role: { notIn: ['BUSINESS_OWNER', 'SUPER_ADMIN'] },
      },
    });

    const tierId = tenant.tier as TierId;
    if (!wouldExceedStaffCap(tierId, currentCount)) return true;

    const upgradeTo = nextTier(tierId);
    throw new ForbiddenException({
      code:         'TIER_QUOTA_EXCEEDED',
      currentTier:  tierId,
      requiredTier: upgradeTo?.id ?? null,
      currentCount,
      cap:          currentCount, // cap == count when blocked
      message:
        upgradeTo
          ? `Your ${tierId} subscription allows ${currentCount} staff. Upgrade to ${upgradeTo.id} to add more.`
          : `Your ${tierId} subscription has reached its staff limit.`,
    });
  }
}
