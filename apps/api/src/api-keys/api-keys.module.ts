import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyStrategy } from '../auth/strategies/api-key.strategy';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

/**
 * Sprint 25 — Solo Pro / Suite T2+ API key issuance and authentication.
 * Exports the strategy + guard so `@UseApiKey()` can be applied anywhere
 * (most notably under `apps/api/src/public-api`).
 */
@Module({
  controllers: [ApiKeysController],
  providers:   [ApiKeysService, ApiKeyStrategy, ApiKeyGuard],
  exports:     [ApiKeysService, ApiKeyStrategy, ApiKeyGuard],
})
export class ApiKeysModule {}
