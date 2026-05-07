import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload, PlanFeatures, ApiAccessLevel } from '@repo/shared-types';

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
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlanFeatureRequirement | undefined>(
      PLAN_FEATURE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;

    const user: JwtPayload = ctx.switchToHttp().getRequest().user;
    if (!user) return false;
    if (user.isSuperAdmin) return true; // platform admin bypass

    const features = user.planFeatures;
    if (!features) {
      // Legacy JWT (pre-Sprint 9) — be permissive. Once tokens cycle, the
      // post-Sprint-9 JWT carries planFeatures and the guard becomes strict.
      return true;
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
