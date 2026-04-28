import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

/**
 * AiModule — single home for all LLM-backed features.
 *
 * Today: receipt OCR (used by POS Cash Paid-Out).
 * Future: ledger JE drafter, time-anomaly resolver, dashboard variance
 * explainer. All call AiService.call() to inherit cost tracking + budget
 * caps + audit logging for free.
 */
@Module({
  providers:   [AiService],
  controllers: [AiController],
  exports:     [AiService],
})
export class AiModule {}
