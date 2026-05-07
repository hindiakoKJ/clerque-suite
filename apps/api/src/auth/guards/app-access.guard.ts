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

    // ── Tenant-module gate (modular pricing, 2026-05-08) ──────────────────
    // Reject the entire app if the tenant's plan doesn't include this module,
    // BEFORE checking the user's per-app access level. This is the entitlement
    // wall that separates STD_SOLO (POS only) from PAIR / SUITE plans.
    const moduleEnabled =
      required.app === 'POS'     ? user.modulePos     :
      required.app === 'LEDGER'  ? user.moduleLedger  :
      required.app === 'PAYROLL' ? user.modulePayroll :
      true;
    // Only block when the flag is explicitly false. Undefined (legacy JWTs
    // pre-modular-pricing) is treated as enabled for backward compat.
    if (moduleEnabled === false) {
      throw new ForbiddenException(
        `Module not on your plan: ${required.app}. Upgrade your subscription to enable this app.`,
      );
    }

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
