import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyStrategy } from '../auth/strategies/api-key.strategy';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';

/**
 * Sprint 25 — Solo Pro / Suite T2+ API key issuance and authentication.
 * Exports the strategy + guard so `@UseApiKey()` can be applied anywhere
 * (most notably under `apps/api/src/public-api`).
 *
 * Also exports `JwtOrApiKeyGuard` — the dual-auth guard used by the shared
 * commerce routes that both the POS UI and ecosystem apps call.
 */
@Module({
  controllers: [ApiKeysController],
  providers:   [ApiKeysService, ApiKeyStrategy, ApiKeyGuard, JwtAuthGuard, JwtOrApiKeyGuard],
  // JwtAuthGuard is exported because Nest instantiates a @UseGuards class in
  // the module that hosts the CONTROLLER, not here — so any module using
  // JwtOrApiKeyGuard must be able to resolve its constructor deps too.
  exports:     [ApiKeysService, ApiKeyStrategy, ApiKeyGuard, JwtAuthGuard, JwtOrApiKeyGuard],
})
export class ApiKeysModule {}
