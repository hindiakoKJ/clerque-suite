import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload, PlanFeatures, ApiAccessLevel, PlanCode } from '@repo/shared-types';
import { PLAN_FEATURES } from '@repo/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

export const PLAN_FEATURE_KEY = 'planFeature';

/**
 * Feature-key gate. Tenants whose plan has the named feature flag set to false
 * (or to insufficient level for `apiAccess`) get a 403 with PLAN_FEATURE_LOCKED.
 *
 * Usage:
 *   @RequirePlanFeature('auditLog')
 *   @RequirePlanFeature('apiAccess', 'readwrite')
 */
type PlanFeatureRequirement =
  | { feature: keyof PlanFeatures; minLevel?: undefined }
  | { feature: 'apiAccess'; minLevel: ApiAccessLevel };

const API_LEVELS: Record<ApiAccessLevel, number> = { none: 0, read: 1, readwrite: 2 };

@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma:    PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PlanFeatureRequirement | undefined>(
      PLAN_FEATURE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;

    const user: JwtPayload = ctx.switchToHttp().getRequest().user;
    if (!user) return false;
    if (user.isSuperAdmin) return true; // platform admin bypass

    // Resolve features. Prefer JWT-baked (fast path); fall back to DB lookup
    // for legacy JWTs issued before Sprint 9 so the gate doesn't become
    // silently permissive after deploy. DB lookup happens once per request
    // for legacy tokens — acceptable until they expire (≤ 8h).
    let features = user.planFeatures;
    if (!features && user.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: user.tenantId },
        select: { planCode: true },
      });
      const pc = (tenant?.planCode ?? 'SUITE_T2') as PlanCode;
      features = PLAN_FEATURES[pc];
    }
    if (!features) {
      // No tenant context (e.g. registration flow) — deny by default.
      throw new ForbiddenException({
        code:    'PLAN_FEATURE_LOCKED',
        feature: required.feature,
        message: 'Cannot determine plan features for this session.',
      });
    }

    if (required.feature === 'apiAccess') {
      const have = API_LEVELS[features.apiAccess] ?? 0;
      const need = API_LEVELS[required.minLevel ?? 'read'];
      if (have < need) {
        throw new ForbiddenException({
          code:        'PLAN_FEATURE_LOCKED',
          feature:     'apiAccess',
          required:    required.minLevel,
          have:        features.apiAccess,
          message:     `This endpoint requires API access (${required.minLevel}). Your plan offers "${features.apiAccess}". Upgrade to enable.`,
        });
      }
      return true;
    }

    const value = features[required.feature];
    if (value !== true) {
      throw new ForbiddenException({
        code:    'PLAN_FEATURE_LOCKED',
        feature: required.feature,
        message: `Feature "${String(required.feature)}" is not on your plan. Upgrade to enable.`,
      });
    }
    return true;
  }
}
