import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload, AppCode, AccessLevel } from '@repo/shared-types';
import { levelValue } from '@repo/shared-types';

export const APP_ACCESS_KEY = 'appAccess';

export interface AppAccessRequirement {
  app: AppCode;
  minLevel: AccessLevel;
}

@Injectable()
export class AppAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppAccessRequirement | undefined>(
      APP_ACCESS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    // No requirement set — allow
    if (!required) return true;

    const user: JwtPayload = ctx.switchToHttp().getRequest().user;
    if (!user) return false;

    // Super admin bypasses all app access checks
    if (user.isSuperAdmin) return true;

    const entry = user.appAccess?.find((a) => a.app === required.app);
    const userLevel  = levelValue(entry?.level);
    const minLevel   = levelValue(required.minLevel);

    if (userLevel < minLevel) {
      throw new ForbiddenException(
        `Insufficient access to ${required.app}. Required: ${required.minLevel}, have: ${entry?.level ?? 'NONE'}.`,
      );
    }

    return true;
  }
}
