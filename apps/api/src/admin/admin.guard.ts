import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '@repo/shared-types';

/**
 * Guard for the Clerque Console (Admin) app — strictly SUPER_ADMIN only.
 * Tenant owners and accountants are explicitly NOT allowed even though
 * the @Roles RolesGuard would let SUPER_ADMIN bypass; this guard is the
 * defence-in-depth layer that ensures no other role sneaks in via a
 * misconfigured @Roles decorator.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtPayload | undefined;
    // Accept both the explicit isSuperAdmin flag and the SUPER_ADMIN role.
    // This is resilient to JWTs minted before the auth.service fix (which
    // set isSuperAdmin=true for SUPER_ADMIN role).
    const isSuper = user?.isSuperAdmin === true || user?.role === 'SUPER_ADMIN';
    if (!isSuper) {
      throw new ForbiddenException('Clerque Console is restricted to platform super-admins.');
    }
    return true;
  }
}
