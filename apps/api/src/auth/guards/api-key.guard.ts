import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyStrategy } from '../strategies/api-key.strategy';
import type { ApiAccessLevel } from '@repo/shared-types';

export const API_KEY_MIN_LEVEL = 'apiKeyMinLevel';

const LEVELS: Record<ApiAccessLevel, number> = { none: 0, read: 1, readwrite: 2 };

/**
 * Guard for `/public-api/v1/*` routes. Authenticates the request via API key
 * and (optionally) enforces a minimum access level read from `@UseApiKey()`.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly strategy:  ApiKeyStrategy,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const principal = await this.strategy.authenticate(req);
    req.user = principal;

    const minLevel = this.reflector.getAllAndOverride<ApiAccessLevel | undefined>(
      API_KEY_MIN_LEVEL,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (minLevel) {
      const have = LEVELS[principal.accessLevel] ?? 0;
      const need = LEVELS[minLevel];
      if (have < need) {
        throw new ForbiddenException({
          code:     'API_KEY_INSUFFICIENT_SCOPE',
          required: minLevel,
          have:     principal.accessLevel,
          message:  `This endpoint requires API access "${minLevel}".`,
        });
      }
    }
    return true;
  }
}
