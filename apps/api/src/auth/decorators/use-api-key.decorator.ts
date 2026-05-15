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
