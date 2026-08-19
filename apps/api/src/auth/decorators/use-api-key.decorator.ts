import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiKeyGuard, API_KEY_MIN_LEVEL } from '../guards/api-key.guard';
import type { ApiAccessLevel } from '@repo/shared-types';

/**
 * Opt a controller / route into API-key authentication.
 *
 *   @UseApiKey()              // any valid key (read or readwrite)
 *   @UseApiKey('readwrite')   // requires readwrite scope
 */
export function UseApiKey(minLevel: ApiAccessLevel = 'read'): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(API_KEY_MIN_LEVEL, minLevel),
    UseGuards(ApiKeyGuard),
  );
}

/**
 * Declare the minimum API-key scope for a route WITHOUT forcing key-only
 * auth. Use this on dual-auth routes (`JwtOrApiKeyGuard`) that a logged-in
 * person and an ecosystem app both call: a JWT caller is unaffected, and a
 * key caller must meet `minLevel`.
 *
 * `@UseApiKey()` is the key-ONLY variant — it attaches ApiKeyGuard and so
 * would lock a signed-in user out of the route.
 */
export function RequireApiKeyLevel(minLevel: ApiAccessLevel): MethodDecorator & ClassDecorator {
  return SetMetadata(API_KEY_MIN_LEVEL, minLevel);
}
