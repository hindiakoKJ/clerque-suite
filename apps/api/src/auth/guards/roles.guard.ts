import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, JwtPayload } from '@repo/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    // Fail closed for machine principals. A route with no @Roles means
    // "any authenticated human", which is a reasonable default for staff
    // but a dangerous one for an API key: adding a route would silently
    // widen what every ecosystem app can reach. A service principal only
    // ever passes where 'SERVICE' is named explicitly.
    if (user?.role === 'SERVICE' && !requiredRoles?.includes('SERVICE')) {
      throw new ForbiddenException(
        'This endpoint is not available to API keys.',
      );
    }

    if (!requiredRoles || requiredRoles.length === 0) return true;

    if (user.isSuperAdmin) return true;
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
