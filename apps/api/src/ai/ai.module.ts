import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AccountPickerService } from './account-picker.service';
import { JournalDrafterService } from './journal-drafter.service';
import { AiController } from './ai.controller';

/**
 * AiModule — single home for all LLM-backed features and AI-flavoured
 * ranking services.
 *
 * Surfaces today:
 *   - Receipt OCR (POS Cash Paid-Out) — Sonnet 4.6 vision
 *   - Smart Account Picker — pure ranking, no LLM
 *   - JE Drafter — Opus 4.7 with cached system prompt + adaptive thinking
 *
 * All LLM-backed features call AiService.call() to inherit cost tracking,
 * budget caps, prompt caching, and AiUsage logging for free.
 */
@Module({
  providers:   [AiService, AccountPickerService, JournalDrafterService],
  controllers: [AiController],
  exports:     [AiService, AccountPickerService, JournalDrafterService],
})
export class AiModule {}
