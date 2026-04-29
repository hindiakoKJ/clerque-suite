import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { AiService } from './ai.service';
import { AccountPickerService } from './account-picker.service';
import { JournalDrafterService } from './journal-drafter.service';
import { JournalGuideService, GuideResult } from './journal-guide.service';
import { OcrReceiptDto, OcrReceiptResult } from './dto/ocr-receipt.dto';
import { SuggestAccountsDto } from './dto/suggest-accounts.dto';
import { DraftJournalDto } from './dto/draft-journal.dto';
import { GuideJournalDto } from './dto/guide-journal.dto';

const RECEIPT_OCR_SYSTEM_PROMPT = `You are a receipt-reading assistant for a Philippine point-of-sale system.

Given a photo of a receipt, extract:
  - amount      total peso amount paid (numeric, no currency symbol)
  - vendor      merchant or store name
  - dateText    date as printed on the receipt (any format)
  - category    one of: 'supplies', 'delivery', 'fuel', 'change_fund', 'tip', 'other'
                (pick the best fit; default 'other' if unclear)
  - reasonHint  one short sentence (≤100 chars) describing what was bought

Rules:
  - amount must be the FINAL TOTAL the customer paid, not subtotal
  - if a field is unclear, return null and lower the corresponding confidence
  - date format the user reads — don't normalise to ISO

Return ONLY valid JSON matching this shape, with no surrounding prose:
{
  "amount":     <number | null>,
  "vendor":     <string | null>,
  "dateText":   <string | null>,
  "category":   <string>,
  "reasonHint": <string>,
  "confidence": {
    "amount":   <0-1>,
    "vendor":   <0-1>,
    "date":     <0-1>,
    "category": <0-1>
  }
}`;

@ApiTags('AI')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai')
export class AiController {
  constructor(
    private ai:           AiService,
    private accountPicker: AccountPickerService,
    private drafter:      JournalDrafterService,
    private guide:        JournalGuideService,
  ) {}

  /**
   * POST /ai/receipt-ocr
   * Body: { imageBase64: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }
   * Returns: parsed receipt fields + per-field confidence.
   *
   * Cashier roles can call this — receipt OCR is for the cash-out flow they
   * already have access to. Server-side budget cap rejects when exceeded.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN')
  @Post('receipt-ocr')
  @HttpCode(HttpStatus.OK)
  async ocrReceipt(
    @CurrentUser() user: JwtPayload,
    @Body() dto: OcrReceiptDto,
  ): Promise<OcrReceiptResult> {
    if (!dto.imageBase64) throw new BadRequestException('imageBase64 is required.');

    // Cap base64 size at ~6MB (raw bytes ~4.5MB) — typical phone photo well under.
    if (dto.imageBase64.length > 6_000_000) {
      throw new BadRequestException('Image too large. Resize and try again.');
    }

    const text = await this.ai.call({
      tenantId:     user.tenantId!,
      userId:       user.sub,
      action:       'receipt_ocr',
      systemPrompt: RECEIPT_OCR_SYSTEM_PROMPT,
      maxTokens:    400,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type:       'base64',
                media_type: dto.mediaType ?? 'image/jpeg',
                data:       dto.imageBase64,
              },
            },
            {
              type: 'text',
              text: 'Extract the receipt fields per the system prompt. Return JSON only.',
            },
          ],
        },
      ],
    });

    // Parse the model's response. If it returns prose around the JSON, salvage
    // the first balanced {...} block.
    let parsed: OcrReceiptResult;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      throw new BadRequestException('Could not parse receipt — try a sharper photo.');
    }

    // Defensive defaults — model is usually good but UI shouldn't crash if
    // confidence is missing.
    parsed.confidence = parsed.confidence ?? { amount: 0, vendor: 0, date: 0, category: 0 };
    return parsed;
  }

  /**
   * POST /ai/suggest-accounts
   * Returns the top 5 most likely Chart-of-Accounts entries for a journal line
   * given the memo, side (debit/credit), and accounts already used in the entry.
   *
   * NOT an LLM call — pure ranking over the tenant's COA + history. Sub-100ms.
   * Roles: anyone who can edit a JE.
   */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'SUPER_ADMIN')
  @Post('suggest-accounts')
  @HttpCode(HttpStatus.OK)
  async suggestAccounts(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SuggestAccountsDto,
  ) {
    return this.accountPicker.suggest(user.tenantId!, {
      memo:       dto.memo,
      side:       dto.side,
      excludeIds: dto.excludeIds,
      limit:      dto.limit ?? 5,
    });
  }

  /**
   * POST /ai/journal-draft
   * Natural-language → balanced JE draft.
   * Returns a draft for human review. Never auto-posts.
   *
   * Tier gate: backend permission check happens at posting time on /accounting/journal.
   * Drafting is allowed for anyone who can post — same role gate.
   */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'SUPER_ADMIN')
  @Post('journal-draft')
  @HttpCode(HttpStatus.OK)
  async draftJournal(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DraftJournalDto,
  ) {
    return this.drafter.draft(user.tenantId!, user.sub, dto.description);
  }

  /**
   * POST /ai/journal-validate
   * Reviews an in-progress JE and returns per-line + entry-level issues.
   * Verdict is OK / WARNINGS / BLOCKING. Each issue may include a one-tap
   * suggestion (swap account, swap side, add line, etc.) the UI can apply.
   */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'SUPER_ADMIN')
  @Post('journal-validate')
  @HttpCode(HttpStatus.OK)
  async validateJournal(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GuideJournalDto,
  ): Promise<GuideResult> {
    return this.guide.validate(user.tenantId!, user.sub, {
      date:      dto.date,
      memo:      dto.memo,
      reference: dto.reference,
      lines:     dto.lines,
    });
  }

  /** Per-tenant AI usage for the current month (cost dashboard). */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get('usage')
  getUsage(@CurrentUser() user: JwtPayload) {
    return this.ai.getMonthlyUsage(user.tenantId!);
  }
}
