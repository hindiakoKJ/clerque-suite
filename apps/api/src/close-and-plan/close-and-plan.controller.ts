/**
 * Close & Plan — controller layer.
 *
 * Three primary endpoints power the evening flow:
 *   GET    /close-and-plan/summary?branchId=&date=
 *   POST   /close-and-plan/check-duplicate
 *   POST   /close-and-plan/batch-receive
 *   GET    /close-and-plan/briefing/text?branchId=&date=
 *   POST   /close-and-plan/briefing/print?branchId=&date=
 *
 * All endpoints require the standard JWT auth + tenant scoping.
 */
import {
  Body, Controller, Get, Post, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CloseAndPlanService, type ReceiveLineInput } from './close-and-plan.service';

@ApiTags('close-and-plan')
@ApiBearerAuth()
@Controller('close-and-plan')
@UseGuards(JwtAuthGuard)
export class CloseAndPlanController {
  constructor(private svc: CloseAndPlanService) {}

  @Get('summary')
  summary(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId: string,
    @Query('date')     date?: string,
  ) {
    return this.svc.getDaySummary(user.tenantId!, branchId, date);
  }

  @Post('check-duplicate')
  @HttpCode(HttpStatus.OK)
  checkDuplicate(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      branchId:        string;
      rawMaterialId:   string;
      qtyReceived:     number;
      expirationDate?: string | null;
    },
  ) {
    return this.svc.checkDuplicate(user.tenantId!, body.branchId, {
      rawMaterialId:  body.rawMaterialId,
      qtyReceived:    body.qtyReceived,
      expirationDate: body.expirationDate,
    });
  }

  @Post('batch-receive')
  @HttpCode(HttpStatus.OK)
  batchReceive(
    @CurrentUser() user: JwtPayload,
    @Body() body: { branchId: string; lines: ReceiveLineInput[] },
  ) {
    return this.svc.batchReceive(user.tenantId!, body.branchId, user.sub, body.lines);
  }

  @Get('briefing/text')
  async briefingText(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId: string,
    @Query('date')     date?: string,
  ) {
    const text = await this.svc.buildBriefingText(user.tenantId!, branchId, date);
    return { text };
  }

  /**
   * Returns the ESC/POS byte stream as base64 — the caller pipes it
   * to whatever printer driver they own (counter mobile via Bluetooth,
   * or a USB ESC/POS bridge from the web). We don't bundle a printer
   * driver in the API; we just produce bytes.
   */
  @Post('briefing/print')
  @HttpCode(HttpStatus.OK)
  async briefingPrint(
    @CurrentUser() user: JwtPayload,
    @Body() body: { branchId: string; date?: string },
  ) {
    // Lazy-import the EscPosBuilder from a sibling helper so the API
    // tree-shake is clean. The escpos helpers live in counter/src/receipt
    // which the API repo doesn't directly depend on; instead we use a
    // tiny inline builder that matches the wire format.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { InlineEscPosBuilder } = require('./inline-escpos');
    const bytes = await this.svc.buildBriefingEscPos(
      user.tenantId!,
      body.branchId,
      InlineEscPosBuilder,
      body.date,
    );
    return {
      base64: Buffer.from(bytes).toString('base64'),
      length: bytes.byteLength,
    };
  }
}
