import { Controller, Get, Patch, Param, Query, Body, Res, UseGuards } from '@nestjs/common';
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

  // ── OR Sequential Numbering ───────────────────────────────────────────────

  @Get('or-sequence')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  getOrSequence(@CurrentUser() user: JwtPayload) {
    return this.svc.getOrSequence(user.tenantId!);
  }

  @Patch('or-sequence')
  @Roles('BUSINESS_OWNER')
  updateOrSequence(
    @CurrentUser() user: JwtPayload,
    @Body() body: { prefix: string; padLength: number },
  ) {
    return this.svc.updateOrSequence(user.tenantId!, body.prefix, body.padLength);
  }

  // ── EWT / Form 2307 ──────────────────────────────────────────────────────

  @Get('ewt')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  getEwt(
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('quarter') quarter: string,
  ) {
    return this.svc.getEwtData(user.tenantId!, +year, +quarter as 1 | 2 | 3 | 4);
  }

  // ── SAWT Alphalist ────────────────────────────────────────────────────────

  @Get('sawt')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  getSawt(
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('quarter') quarter: string,
  ) {
    return this.svc.getSawtData(user.tenantId!, +year, +quarter as 1 | 2 | 3 | 4);
  }

  // ── Books of Account ──────────────────────────────────────────────────────

  @Get('books/sales')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  async salesBook(
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    const buf = await this.svc.exportSalesBook(user.tenantId!, +year, +month);
    const filename = `sales-book-${year}-${month.padStart(2, '0')}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buf);
  }

  @Get('books/purchases')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  async purchaseBook(
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    const buf = await this.svc.exportPurchaseBook(user.tenantId!, +year, +month);
    const filename = `purchase-book-${year}-${month.padStart(2, '0')}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buf);
  }

  @Get('books/disbursements')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  async cashDisbursements(
    @CurrentUser() user: JwtPayload,
    @Query('year') year: string,
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    const buf = await this.svc.exportCashDisbursements(user.tenantId!, +year, +month);
    const filename = `cash-disbursements-${year}-${month.padStart(2, '0')}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buf);
  }

  // ── BIR 2307 (Certificate of Creditable Tax Withheld) ────────────────────
  @Get('2307/vendors')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AP_ACCOUNTANT', 'BOOKKEEPER')
  list2307Vendors(
    @CurrentUser() user: JwtPayload,
    @Query('year')    year:    string,
    @Query('quarter') quarter: string,
  ) {
    const q = quarter ? Number(quarter) as 1 | 2 | 3 | 4 : null;
    return this.svc.list2307VendorsForPeriod(user.tenantId!, Number(year), q);
  }

  @Get('2307/data')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AP_ACCOUNTANT', 'BOOKKEEPER')
  get2307Data(
    @CurrentUser() user: JwtPayload,
    @Query('vendorId') vendorId: string,
    @Query('year')     year:     string,
    @Query('quarter')  quarter:  string,
  ) {
    const q = quarter ? Number(quarter) as 1 | 2 | 3 | 4 : null;
    return this.svc.get2307Data(user.tenantId!, vendorId, Number(year), q);
  }

  @Get('2307/excel')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  async get2307Excel(
    @CurrentUser() user: JwtPayload,
    @Query('vendorId') vendorId: string,
    @Query('year')     year:     string,
    @Query('quarter')  quarter:  string,
    @Res() res: Response,
  ) {
    const q = quarter ? Number(quarter) as 1 | 2 | 3 | 4 : null;
    const buf = await this.svc.generate2307Excel(user.tenantId!, vendorId, Number(year), q);
    const periodTag = q ? `Q${q}-${year}` : year;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="BIR-2307-${periodTag}-${vendorId}.xlsx"`,
    });
    res.send(buf);
  }
}
