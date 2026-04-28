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
import { OcrReceiptDto, OcrReceiptResult } from './dto/ocr-receipt.dto';

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
  constructor(private ai: AiService) {}

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

  /** Per-tenant AI usage for the current month (cost dashboard). */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get('usage')
  getUsage(@CurrentUser() user: JwtPayload) {
    return this.ai.getMonthlyUsage(user.tenantId!);
  }
}
