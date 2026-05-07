import { SetMetadata } from '@nestjs/common';
import type { PlanFeatures, ApiAccessLevel } from '@repo/shared-types';
import { PLAN_FEATURE_KEY } from '../guards/plan-feature.guard';

/**
 * Restrict a route by the tenant's plan feature flag.
 *
 *   @RequirePlanFeature('auditLog')          // boolean flag
 *   @RequirePlanFeature('apiAccess', 'read') // graded — read | readwrite
 */
export function RequirePlanFeature(
  feature: keyof PlanFeatures,
  minLevel?: ApiAccessLevel,
): MethodDecorator & ClassDecorator {
  return SetMetadata(PLAN_FEATURE_KEY, { feature, minLevel });
}
