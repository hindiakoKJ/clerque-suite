import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyStrategy } from '../strategies/api-key.strategy';
import { API_KEY_MIN_LEVEL } from './api-key.guard';
import type { ApiAccessLevel } from '@repo/shared-types';

const LEVELS: Record<ApiAccessLevel, number> = { none: 0, read: 1, readwrite: 2 };

/**
 * Auth for the commerce routes that both a person and an ecosystem app may
 * call: the POS UI signs in with a JWT, a booking app presents an API key,
 * and both land on the SAME handler.
 *
 * That shared path is the point. Building a parallel `/public-api` write
 * surface would mean two implementations of the same invariants (VAT,
 * period locks, OR numbering, inventory) and they would drift. One code
 * path, one set of rules, two ways to authenticate.
 *
 * Resolution order:
 *   1. JWT bearer — the normal login. Wins if present and valid.
 *   2. API key from `X-API-Key`, or `Authorization: Bearer clq_live_...`.
 *      Yields a service principal (see ApiKeyStrategy) with role 'SERVICE'.
 *
 * This guard only AUTHENTICATES. Authorization still runs afterwards:
 * RolesGuard rejects the service principal unless the route names 'SERVICE'
 * in @Roles(...), and `@UseApiKey('readwrite')` is enforced here for key
 * callers so a read-only key cannot reach a write route.
 *
 * Known limit (slice 2): keys are tenant-wide, not branch- or scope-scoped.
 * A key can act on any branch its payload names, subject to the usual
 * tenant-ownership checks. Do not expose read routes that leak cross-branch
 * data to keys until scoped keys land.
 */
@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    private readonly jwt:       JwtAuthGuard,
    private readonly apiKey:    ApiKeyStrategy,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    // 1. A JWT is what the first-party apps send — try it first and fall
    //    through quietly, since a failure here just means "not a person".
    const auth = String(req.headers['authorization'] ?? '');
    const looksLikeApiKey =
      !!req.headers['x-api-key'] ||
      /^bearer\s+clq_live_/i.test(auth);

    if (!looksLikeApiKey) {
      try {
        const ok = (await this.jwt.canActivate(ctx)) as boolean;
        if (ok && req.user) return true;
      } catch {
        // fall through to the API-key path
      }
    }

    // 2. API key.
    const principal = await this.apiKey.authenticate(req);
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

    if (!req.user) throw new UnauthorizedException('Not authenticated.');
    return true;
  }
}
