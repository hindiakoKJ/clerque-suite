import { Controller, Get, Param, Query, Res, UseGuards, Header } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ExportService } from './export.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res: Response, buffer: Buffer, filename: string) {
  res.set({
    'Content-Type':        XLSX_MIME,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
}

@ApiTags('Export')
@ApiBearerAuth('access-token')
@Controller('export')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'SUPER_ADMIN')
export class ExportController {
  constructor(private readonly svc: ExportService) {}

  /**
   * GET /export/trial-balance?asOf=YYYY-MM-DD
   * Downloads Trial Balance as of the given date (defaults to today).
   */
  @Get('trial-balance')
  async trialBalance(
    @CurrentUser() user: JwtPayload,
    @Query('asOf') asOf: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportTrialBalance(user.tenantId!, asOf);
    const filename = `trial-balance-${asOf ?? 'current'}.xlsx`;
    sendXlsx(res, buffer, filename);
  }

  /**
   * GET /export/journal?from=YYYY-MM-DD&to=YYYY-MM-DD&status=POSTED
   * Downloads journal entries filtered by date range and/or status.
   */
  @Get('journal')
  async journal(
    @CurrentUser() user: JwtPayload,
    @Query('from')   from:   string | undefined,
    @Query('to')     to:     string | undefined,
    @Query('status') status: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportJournal(user.tenantId!, { from, to, status });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `journal-${range}.xlsx`;
    sendXlsx(res, buffer, filename);
  }

  /**
   * GET /export/account-ledger/:id?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Downloads the GL activity (FBL3N equivalent) for a single account.
   */
  @Get('account-ledger/:id')
  async accountLedger(
    @CurrentUser() user: JwtPayload,
    @Param('id')   accountId: string,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportAccountLedger(user.tenantId!, accountId, { from, to });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `ledger-${accountId}-${range}.xlsx`;
    sendXlsx(res, buffer, filename);
  }

  /**
   * GET /export/pl-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Downloads a Profit & Loss summary for the date range.
   */
  @Get('pl-summary')
  async plSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to')   to:   string,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportPLSummary(user.tenantId!, from, to);
    const filename = `pl-summary-${from}_to_${to}.xlsx`;
    sendXlsx(res, buffer, filename);
  }

  /**
   * GET /export/ap-aging
   * Downloads AP Aging report as Excel.
   */
  @Get('ap-aging')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'SUPER_ADMIN', 'FINANCE_LEAD', 'AP_ACCOUNTANT')
  async apAging(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const buffer = await this.svc.exportApAging(user.tenantId!);
    sendXlsx(res, buffer, `ap-aging-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /**
   * GET /export/ar-aging
   * Downloads AR Aging report as Excel.
   */
  @Get('ar-aging')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'SUPER_ADMIN', 'FINANCE_LEAD', 'AR_ACCOUNTANT')
  async arAging(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const buffer = await this.svc.exportArAging(user.tenantId!);
    sendXlsx(res, buffer, `ar-aging-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /**
   * GET /export/payroll-ytd?year=YYYY
   * Downloads Payroll Year-to-Date summary as Excel.
   */
  @Get('payroll-ytd')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'PAYROLL_MASTER')
  async payrollYtd(
    @CurrentUser() user: JwtPayload,
    @Query('year') yearStr: string | undefined,
    @Res() res: Response,
  ) {
    const year   = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
    const buffer = await this.svc.exportPayrollYtd(user.tenantId!, year);
    sendXlsx(res, buffer, `payroll-ytd-${year}.xlsx`);
  }

  /**
   * GET /export/chart-of-accounts
   * Downloads the full Chart of Accounts as Excel (grouped by type).
   * Roles: all accounting roles + BOOKKEEPER + FINANCE_LEAD.
   */
  @Get('chart-of-accounts')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'SUPER_ADMIN', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async chartOfAccounts(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const buffer   = await this.svc.exportChartOfAccounts(user.tenantId!);
    const filename = `chart-of-accounts-${new Date().toISOString().slice(0, 10)}.xlsx`;
    sendXlsx(res, buffer, filename);
  }

  /**
   * GET /export/accountant-csv?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * "Accountant Export" — CSV of all completed orders (revenue) for the date range.
   * Intended for manual filing assistance. Clearly labeled as an estimate,
   * not an official BIR filing document.
   *
   * Roles: BUSINESS_OWNER, ACCOUNTANT, BOOKKEEPER, FINANCE_LEAD (broader than XLSX exports)
   */
  @Get('accountant-csv')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'SUPER_ADMIN')
  async accountantCsv(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to')   to:   string,
    @Res() res: Response,
  ) {
    const csv      = await this.svc.exportAccountantCsv(user.tenantId!, from, to);
    const filename = `accountant-export-${from}_to_${to}.csv`;
    res.set({
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send('﻿' + csv); // UTF-8 BOM for Excel compatibility
  }
}
