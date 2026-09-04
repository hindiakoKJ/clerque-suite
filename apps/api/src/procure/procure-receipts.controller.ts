import { Controller, Get, Post, Body, Req, UseGuards, UseInterceptors, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { AiQuotaGuard } from '../ai/ai-quota.guard';
import { ProcureReceiptsService } from './procure-receipts.service';
import { ParseReceiptDto, ConfirmReceiptDto } from './dto/receipts.dto';
import {
  ReceiptReadLimitGuard, ReleaseReceiptReadInterceptor, ReceiptReadLedger, ReceiptReads, receiptReadsToday,
} from './receipt-read-limit.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Both routes move money and stock, so they sit with the roles that already
 * close a request and post it -- not with the kitchen account, which builds
 * the buy list and nothing else.
 */
@ApiTags('Procure')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('procure/receipts')
export class ProcureReceiptsController {
  constructor(
    private readonly receipts: ProcureReceiptsService,
    private readonly prisma:   PrismaService,
    private readonly ledger:   ReceiptReadLedger,
  ) {}

  /**
   * How many reads this shop has left today. The screen shows it beside the
   * Read button, so a person is not surprised by the wall.
   *
   * Behind the monthly gate too: a shop whose plan has no AI, or whose month
   * is spent, gets the same 403 the Read button would -- not "50 of 50 left".
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  @UseGuards(AiQuotaGuard)
  @Get('reads')
  @ApiOperation({ summary: "Today's receipt reads used and the daily cap" })
  async reads(@CurrentUser() user: JwtPayload) {
    const reads = await receiptReadsToday(this.prisma, user.tenantId!);
    return { ...reads, usedToday: reads.usedToday + this.ledger.pending(user.tenantId!) };
  }

  /**
   * Read a photo. Writes nothing; returns what the reader saw, each line
   * matched to an ingredient, for the person to correct before posting.
   * Under the AI quota guard because it spends a prompt.
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  // Monthly quota first (is AI on, does the plan include it), then today's
  // cap. A read that fails either never reaches the provider.
  @UseGuards(AiQuotaGuard, ReceiptReadLimitGuard)
  @UseInterceptors(ReleaseReceiptReadInterceptor)
  @Post('parse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read a receipt photo into lines matched to the shop\'s ingredients (no posting)' })
  async parse(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ParseReceiptDto,
    @Req() req: Request & { receiptReads?: ReceiptReads },
  ) {
    const result = await this.receipts.parse(user.tenantId!, user.sub, dto);
    // The count the guard took was BEFORE this read; the screen wants after.
    const reads = req.receiptReads
      ? { usedToday: req.receiptReads.usedToday + 1, limit: req.receiptReads.limit, resetsAt: req.receiptReads.resetsAt }
      : undefined;
    return { ...result, reads };
  }

  /**
   * Post what the person agreed to: stock lines onto the shelf, expense lines
   * into the books, the photo filed against the request it created.
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  @Post('confirm')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Post a corrected receipt: receive stock, record expenses, file the photo' })
  confirm(@CurrentUser() user: JwtPayload, @Body() dto: ConfirmReceiptDto) {
    return this.receipts.confirm(user.tenantId!, user.sub, user.branchId ?? undefined, dto);
  }
}
