import { Module } from '@nestjs/common';
import { PublicApiController } from './public-api.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';

/**
 * Sprint 25 — Read-only public API surface, authenticated via API keys.
 * Lives at /public-api/v1/* (under the global `api/v1` prefix → effective
 * mount at `/api/v1/public-api/v1/...`).
 */
@Module({
  imports:     [ApiKeysModule],
  controllers: [PublicApiController],
})
export class PublicApiModule {}
