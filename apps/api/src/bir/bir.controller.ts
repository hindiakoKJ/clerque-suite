import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BirService } from './bir.service';

@ApiTags('BIR')
@ApiBearerAuth('access-token')
@Controller('bir')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BirController {
  constructor(private readonly svc: BirService) {}

  /**
   * GET /bir/2550q?year=2025&quarter=1
   * Returns structured data for the BIR 2550Q Quarterly VAT Return.
   * Requires BIR-registered tenant; returns 403 otherwise.
   */
  @Get('2550q')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'SUPER_ADMIN')
  get2550Q(
    @CurrentUser() user: JwtPayload,
    @Query('year')    yearStr:    string,
    @Query('quarter') quarterStr: string,
  ) {
    const year    = parseInt(yearStr, 10) || new Date().getFullYear();
    const quarter = (parseInt(quarterStr, 10) || 1) as 1 | 2 | 3 | 4;
    return this.svc.get2550QData(user.tenantId!, year, quarter);
  }

  /**
   * GET /bir/1701q?year=2025&quarter=1
   * Returns structured data for the BIR 1701Q Quarterly Income Tax Return.
   * Requires BIR-registered tenant; returns 403 otherwise.
   */
  @Get('1701q')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'SUPER_ADMIN')
  get1701Q(
    @CurrentUser() user: JwtPayload,
    @Query('year')    yearStr:    string,
    @Query('quarter') quarterStr: string,
  ) {
    const year    = parseInt(yearStr, 10) || new Date().getFullYear();
    const quarter = (parseInt(quarterStr, 10) || 1) as 1 | 2 | 3 | 4;
    return this.svc.get1701QData(user.tenantId!, year, quarter);
  }

  /**
   * GET /bir/2551q?year=2025&quarter=1
   * Returns structured data for the BIR 2551Q Quarterly Percentage Tax Return.
   * Applicable to NON_VAT-registered tenants (3% on gross receipts).
   * Requires BIR-registered tenant; returns 403 otherwise.
   */
  @Get('2551q')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'SUPER_ADMIN')
  get2551Q(
    @CurrentUser() user: JwtPayload,
    @Query('year')    yearStr:    string,
    @Query('quarter') quarterStr: string,
  ) {
    const year    = parseInt(yearStr, 10) || new Date().getFullYear();
    const quarter = (parseInt(quarterStr, 10) || 1) as 1 | 2 | 3 | 4;
    return this.svc.get2551QData(user.tenantId!, year, quarter);
  }

  /**
   * GET /bir/eis/:orderId
   * Returns BIR-compliant EIS (Electronic Invoicing System) JSON for a single order.
   * Triggers a JSON file download via Content-Disposition header.
   * Requires BIR-registered tenant; returns 403 otherwise.
   */
  @Get('eis/:orderId')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'CASHIER', 'SUPER_ADMIN')
  async getEisInvoice(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Res() res: Response,
  ) {
    const invoice = await this.svc.generateEisInvoice(user.tenantId!, orderId);
    const filename = `eis-${invoice.invoiceNumber}.json`;
    res.set({
      'Content-Type':        'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.json(invoice);
  }
}
