import { SetMetadata } from '@nestjs/common';
import type { AppCode, AccessLevel } from '@repo/shared-types';
import { APP_ACCESS_KEY, type AppAccessRequirement } from '../guards/app-access.guard';

/**
 * Declares that the decorated route requires the caller to have at least
 * `minLevel` access to `app`.
 *
 * Usage:
 *   @RequireApp('POS', 'OPERATOR')
 *   @Post('orders')
 *   createOrder() { ... }
 */
export const RequireApp = (app: AppCode, minLevel: AccessLevel) =>
  SetMetadata<string, AppAccessRequirement>(APP_ACCESS_KEY, { app, minLevel });
