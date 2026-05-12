import { Controller, Get, Param, Query, Res, UseGuards, Header, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ExportService } from './export.service';
import { TenantExportService } from './tenant-export.service';
import { AuditService } from '../audit/audit.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res: Response, buffer: Buffer, filename: string) {
  res.set({
    'Content-Type':        XLSX_MIME,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
}

/**
 * Audit D3-07 — record every XLSX/CSV export against the tenant + actor.
 * Fire-and-forget: a failed audit write must not break the download.
 * The reportId becomes the AuditLog.entityId so bulk-export detection can
 * group rows per (tenantId, performedBy, hour) cheaply.
 */
function logDataExport(
  audit: AuditService,
  user: JwtPayload,
  reportId: string,
  reportName: string,
  filename: string,
): void {
  void audit.log({
    tenantId:    user.tenantId!,
    action:      'DATA_EXPORTED',
    entityType:  'Report',
    entityId:    reportId,
    performedBy: user.sub,
    description: `Exported ${reportName}`,
    after:       { reportId, reportName, filename },
  });
}

@ApiTags('Export')
@ApiBearerAuth('access-token')
@Controller('export')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'SUPER_ADMIN')
export class ExportController {
  constructor(
    private readonly svc: ExportService,
    private readonly tenantExport: TenantExportService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Audit D3-07 — send the XLSX buffer AND record a DATA_EXPORTED row.
   * reportId is used as AuditLog.entityId so the D10-D scheduler can
   * group per (tenantId, performedBy) within an hour cheaply.
   */
  private sendAndLog(
    res: Response,
    buffer: Buffer,
    filename: string,
    user: JwtPayload,
    reportId: string,
    reportName: string,
  ) {
    logDataExport(this.audit, user, reportId, reportName, filename);
    sendXlsx(res, buffer, filename);
  }

  /**
   * GET /export/tenant-all
   * One-click "download everything I have" — Excel with one sheet per
   * table. Owner only — sensitive enough that we don't expose it to
   * accountants by default. Sensitive fields stripped.
   */
  @Get('tenant-all')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  async exportTenantAll(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { buffer, filename } = await this.tenantExport.exportAllData(user.tenantId!);
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

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
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
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
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
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
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
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
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
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
   * GET /export/bir-2316?year=YYYY
   * BIR Form 2316 Annual Compensation alphalist — one row per active employee
   * with YTD basic + OT + allowances + statutory contribs + 13th-month + WHT.
   * Output is upload-ready for the BIR Alphalist Data Entry tool.
   */
  @Get('bir-2316')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'PAYROLL_MASTER', 'ACCOUNTANT')
  async bir2316(
    @CurrentUser() user: JwtPayload,
    @Query('year') yearStr: string | undefined,
    @Res() res: Response,
  ) {
    const year   = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
    const buffer = await this.svc.exportBir2316(user.tenantId!, year);
    sendXlsx(res, buffer, `bir-2316-alphalist-${year}.xlsx`);
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
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
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

  // ─────────────────────────────────────────────────────────────────────────
  // ── New endpoints (Commit 1) ─────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  /** GET /export/balance-sheet?asOf=YYYY-MM-DD */
  @Get('balance-sheet')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async balanceSheet(
    @CurrentUser() user: JwtPayload,
    @Query('asOf') asOf: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportBalanceSheet(user.tenantId!, asOf);
    const filename = `balance-sheet-${asOf ?? new Date().toISOString().slice(0, 10)}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD */
  @Get('cash-flow')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async cashFlow(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to')   to:   string,
    @Res() res: Response,
  ) {
    if (!from || !to) throw new BadRequestException('from and to are required');
    const buffer   = await this.svc.exportCashFlow(user.tenantId!, from, to);
    const filename = `cash-flow-${from}_to_${to}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/journal-templates */
  @Get('journal-templates')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async journalTemplates(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const buffer   = await this.svc.exportJournalTemplates(user.tenantId!);
    const filename = `journal-templates-${new Date().toISOString().slice(0, 10)}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/quotes?from=&to=&status= */
  @Get('quotes')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'SALES_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR')
  async quotes(
    @CurrentUser() user: JwtPayload,
    @Query('from') from:   string | undefined,
    @Query('to')   to:     string | undefined,
    @Query('status') status: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportQuotes(user.tenantId!, { from, to, status });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `quotes-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/ar-invoice-register?from=&to=&status= */
  @Get('ar-invoice-register')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR')
  async arInvoiceRegister(
    @CurrentUser() user: JwtPayload,
    @Query('from') from:   string | undefined,
    @Query('to')   to:     string | undefined,
    @Query('status') status: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportArInvoiceRegister(user.tenantId!, { from, to, status });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `ar-invoice-register-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/ar-customer-statement/:customerId?from=&to= */
  @Get('ar-customer-statement/:customerId')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR')
  async arCustomerStatement(
    @CurrentUser() user: JwtPayload,
    @Param('customerId') customerId: string,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportArCustomerStatement(user.tenantId!, customerId, { from, to });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `ar-customer-statement-${customerId}-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/ar-payments?from=&to= */
  @Get('ar-payments')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR')
  async arPayments(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportArPayments(user.tenantId!, { from, to });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `ar-payments-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/ap-bill-register?from=&to=&status= */
  @Get('ap-bill-register')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR')
  async apBillRegister(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Query('status') status: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportApBillRegister(user.tenantId!, { from, to, status });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `ap-bill-register-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/ap-vendor-statement/:vendorId?from=&to= */
  @Get('ap-vendor-statement/:vendorId')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR')
  async apVendorStatement(
    @CurrentUser() user: JwtPayload,
    @Param('vendorId') vendorId: string,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportApVendorStatement(user.tenantId!, vendorId, { from, to });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `ap-vendor-statement-${vendorId}-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/ap-payments?from=&to= */
  @Get('ap-payments')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR')
  async apPayments(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportApPayments(user.tenantId!, { from, to });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `ap-payments-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/ap-expenses?from=&to= */
  @Get('ap-expenses')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR')
  async apExpenses(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportApExpenses(user.tenantId!, { from, to });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `ap-expenses-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/expense-claims?from=&to=&status= */
  @Get('expense-claims')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR')
  async expenseClaims(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Query('status') status: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportExpenseClaims(user.tenantId!, { from, to, status });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `expense-claims-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/bank-reconciliation/:accountId?asOf= */
  @Get('bank-reconciliation/:accountId')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async bankReconciliation(
    @CurrentUser() user: JwtPayload,
    @Param('accountId') accountId: string,
    @Query('asOf') asOf: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportBankReconciliation(user.tenantId!, accountId, asOf);
    const filename = `bank-reconciliation-${accountId}-${asOf ?? new Date().toISOString().slice(0, 10)}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/settlement-batches?from=&to= */
  @Get('settlement-batches')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async settlementBatches(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportSettlementBatches(user.tenantId!, { from, to });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `settlement-batches-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/cash-position?asOf= */
  @Get('cash-position')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async cashPosition(
    @CurrentUser() user: JwtPayload,
    @Query('asOf') asOf: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportCashPosition(user.tenantId!, asOf);
    const filename = `cash-position-${asOf ?? new Date().toISOString().slice(0, 10)}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/bir-2550q?year=&quarter= */
  @Get('bir-2550q')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT')
  @RequirePlanFeature('birForms')
  async bir2550q(
    @CurrentUser() user: JwtPayload,
    @Query('year')    yearStr:    string,
    @Query('quarter') quarterStr: string,
    @Res() res: Response,
  ) {
    const year    = parseInt(yearStr,    10);
    const quarter = parseInt(quarterStr, 10) as 1 | 2 | 3 | 4;
    if (!year || ![1, 2, 3, 4].includes(quarter)) {
      throw new BadRequestException('year and quarter (1-4) are required');
    }
    const buffer   = await this.svc.exportBir2550Q(user.tenantId!, year, quarter);
    const filename = `bir-2550q-${year}-Q${quarter}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/bir-1701q?year=&quarter= */
  @Get('bir-1701q')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT')
  @RequirePlanFeature('birForms')
  async bir1701q(
    @CurrentUser() user: JwtPayload,
    @Query('year')    yearStr:    string,
    @Query('quarter') quarterStr: string,
    @Res() res: Response,
  ) {
    const year    = parseInt(yearStr,    10);
    const quarter = parseInt(quarterStr, 10) as 1 | 2 | 3 | 4;
    if (!year || ![1, 2, 3, 4].includes(quarter)) {
      throw new BadRequestException('year and quarter (1-4) are required');
    }
    const buffer   = await this.svc.exportBir1701Q(user.tenantId!, year, quarter);
    const filename = `bir-1701q-${year}-Q${quarter}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/bir-2551q?year=&quarter= */
  @Get('bir-2551q')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT')
  @RequirePlanFeature('birForms')
  async bir2551q(
    @CurrentUser() user: JwtPayload,
    @Query('year')    yearStr:    string,
    @Query('quarter') quarterStr: string,
    @Res() res: Response,
  ) {
    const year    = parseInt(yearStr,    10);
    const quarter = parseInt(quarterStr, 10) as 1 | 2 | 3 | 4;
    if (!year || ![1, 2, 3, 4].includes(quarter)) {
      throw new BadRequestException('year and quarter (1-4) are required');
    }
    const buffer   = await this.svc.exportBir2551Q(user.tenantId!, year, quarter);
    const filename = `bir-2551q-${year}-Q${quarter}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/bir-2307?vendorId=&year=&quarter=  — single vendor */
  @Get('bir-2307')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @RequirePlanFeature('birForms')
  async bir2307(
    @CurrentUser() user: JwtPayload,
    @Query('vendorId') vendorId: string,
    @Query('year')     yearStr:    string,
    @Query('quarter')  quarterStr: string,
    @Res() res: Response,
  ) {
    if (!vendorId) throw new BadRequestException('vendorId is required');
    const year    = parseInt(yearStr,    10);
    const quarter = parseInt(quarterStr, 10) as 1 | 2 | 3 | 4;
    if (!year || ![1, 2, 3, 4].includes(quarter)) {
      throw new BadRequestException('year and quarter (1-4) are required');
    }
    const buffer   = await this.svc.exportBir2307(user.tenantId!, vendorId, year, quarter);
    const filename = `bir-2307-${year}-Q${quarter}-${vendorId}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/bir-2307-all?year=&quarter=  — one sheet per vendor with WHT in the period */
  @Get('bir-2307-all')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @RequirePlanFeature('birForms')
  async bir2307All(
    @CurrentUser() user: JwtPayload,
    @Query('year')    yearStr:    string,
    @Query('quarter') quarterStr: string,
    @Res() res: Response,
  ) {
    const year    = parseInt(yearStr,    10);
    const quarter = parseInt(quarterStr, 10) as 1 | 2 | 3 | 4;
    if (!year || ![1, 2, 3, 4].includes(quarter)) {
      throw new BadRequestException('year and quarter (1-4) are required');
    }
    const buffer   = await this.svc.exportBir2307All(user.tenantId!, year, quarter);
    const filename = `bir-2307-all-${year}-Q${quarter}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/z-read-history?from=&to= */
  @Get('z-read-history')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async zReadHistory(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string | undefined,
    @Query('to')   to:   string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportZReadHistory(user.tenantId!, { from, to });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `z-read-history-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/audit-log?from=&to=&action= */
  @Get('audit-log')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @RequirePlanFeature('auditLog')
  async auditLog(
    @CurrentUser() user: JwtPayload,
    @Query('from')   from:   string | undefined,
    @Query('to')     to:     string | undefined,
    @Query('action') action: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportAuditLog(user.tenantId!, { from, to, action });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `audit-log-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/accounting-events?status=&from=&to= */
  @Get('accounting-events')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async accountingEvents(
    @CurrentUser() user: JwtPayload,
    @Query('from')   from:   string | undefined,
    @Query('to')     to:     string | undefined,
    @Query('status') status: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportAccountingEvents(user.tenantId!, { from, to, status });
    const range    = [from, to].filter(Boolean).join('_to_') || 'all';
    const filename = `accounting-events-${range}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/period-close-summary?periodId= */
  @Get('period-close-summary')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async periodCloseSummary(
    @CurrentUser() user: JwtPayload,
    @Query('periodId') periodId: string,
    @Res() res: Response,
  ) {
    if (!periodId) throw new BadRequestException('periodId is required');
    const buffer   = await this.svc.exportPeriodCloseSummary(user.tenantId!, periodId);
    const filename = `period-close-summary-${periodId}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }

  /** GET /export/ledger-kpi-snapshot?asOf= */
  @Get('ledger-kpi-snapshot')
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  async ledgerKpiSnapshot(
    @CurrentUser() user: JwtPayload,
    @Query('asOf') asOf: string | undefined,
    @Res() res: Response,
  ) {
    const buffer   = await this.svc.exportLedgerKpiSnapshot(user.tenantId!, asOf);
    const filename = `ledger-kpi-snapshot-${asOf ?? new Date().toISOString().slice(0, 10)}.xlsx`;
    this.sendAndLog(res, buffer, filename, user, filename.replace(/\.xlsx$/, ''), filename.replace(/\.xlsx$/, ''));
  }
}
