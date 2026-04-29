import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '@repo/shared-types';

/**
 * AiEnabledGuard — rejects all /ai/* requests when the tenant doesn't have
 * AI features unlocked. Reads the resolved `aiEnabled` flag from the JWT
 * (baked at login from tier + per-tenant override), so this is one boolean
 * check — no DB roundtrip.
 *
 * Mounted on the AiController; applies to every endpoint inside.
 *
 * Returns a structured 403 the frontend can use to render an upgrade CTA:
 *   { code: 'AI_NOT_ENABLED', message: '...' }
 */
@Injectable()
export class AiEnabledGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;

    // Platform admins bypass — useful for support / debugging
    if (user?.isSuperAdmin) return true;

    if (user?.aiEnabled) return true;

    throw new ForbiddenException({
      code: 'AI_NOT_ENABLED',
      message: 'AI features are available on the Team and Multi plans. Upgrade your subscription or contact your owner to enable.',
    });
  }
}
