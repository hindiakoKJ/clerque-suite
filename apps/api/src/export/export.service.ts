import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounting/accounts.service';
import { JournalService } from '../accounting/journal.service';
import { ExpensesService } from '../ap/expenses.service';
import { ArService } from '../ar/ar.service';
import { ARInvoicesService } from '../ar/ar-invoices.service';
import { ARPaymentsService } from '../ar/ar-payments.service';
import { APBillsService } from '../ap/ap-bills.service';
import { APPaymentsService } from '../ap/ap-payments.service';
import { PayrollService } from '../payroll/payroll.service';
import { BirService } from '../bir/bir.service';
import { AuditService } from '../audit/audit.service';
import { LedgerMetricsService } from '../ledger-metrics/ledger-metrics.service';
import type { AuditAction } from '@prisma/client';

// ── Shared formatting helpers ────────────────────────────────────────────────

const PESO_FMT    = '₱#,##0.00';
const DATE_FMT    = 'DD-MMM-YYYY';
const ROW_FILL_A: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5F3' } };

function applyHeaderStyle(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.fill = HEADER_FILL;
  row.border = {
    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  };
}

function applyAlternatingFill(row: ExcelJS.Row, idx: number) {
  if (idx % 2 === 0) row.fill = ROW_FILL_A;
}

function autoWidth(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((col) => {
    if (!col || !col.eachCell) return;
    let max = (col.header?.toString().length ?? 10) + 2;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value?.toString() ?? '';
      if (v.length > max) max = v.length;
    });
    col.width = Math.min(max + 2, 60);
  });
}

function buildWorkbook(creator = 'Clerque'): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator  = creator;
  wb.created  = new Date();
  wb.modified = new Date();
  return wb;
}

/** Write company name + report title in row 1, date info in row 2, blank row 3.
 *  Returns the worksheet with the cursor at row 4 (data header row). */
function writeReportHeader(
  ws: ExcelJS.Worksheet,
  tenantName: string,
  title: string,
  subtitle: string,
  colCount: number,
) {
  const lastCol = String.fromCharCode(64 + colCount);
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = `${tenantName} — ${title}`;
  titleCell.font  = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  ws.mergeCells(`A2:${lastCol}2`);
  const subCell = ws.getCell('A2');
  subCell.value = subtitle;
  subCell.font  = { italic: true, size: 10 };
  subCell.alignment = { horizontal: 'center' };

  ws.addRow([]); // row 3 — spacer
}

// ── ExportService ────────────────────────────────────────────────────────────

@Injectable()
export class ExportService {
  constructor(
    private prisma:    PrismaService,
    private accounts:  AccountsService,
    private journal:   JournalService,
    private apService: ExpensesService,
    private arService: ArService,
    private payrollService: PayrollService,
    private arInvoices:  ARInvoicesService,
    private arPayments:  ARPaymentsService,
    private apBills:     APBillsService,
    private apPayments:  APPaymentsService,
    private bir:         BirService,
    private audit:       AuditService,
    private ledgerMetrics: LedgerMetricsService,
  ) {}

  private async tenantName(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { name: true },
    });
    return t?.name ?? 'Unknown Business';
  }

  // ── Trial Balance ──────────────────────────────────────────────────────────

  async exportTrialBalance(tenantId: string, asOf?: string): Promise<Buffer> {
    const [name, data] = await Promise.all([
      this.tenantName(tenantId),
      this.accounts.getTrialBalance(tenantId, asOf),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Trial Balance', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF2AA198' };

    const asOfLabel = asOf ?? new Date().toISOString().slice(0, 10);
    writeReportHeader(ws, name, 'Trial Balance', `As of ${asOfLabel}   |   Generated: ${new Date().toLocaleString()}`, 5);

    ws.columns = [
      { key: 'code',    header: 'Code',         width: 10 },
      { key: 'name',    header: 'Account Name',  width: 40 },
      { key: 'type',    header: 'Type',          width: 14 },
      { key: 'debit',   header: 'Debit',         width: 18, style: { numFmt: PESO_FMT } },
      { key: 'credit',  header: 'Credit',        width: 18, style: { numFmt: PESO_FMT } },
    ];

    // Row 4 is the header row injected by ws.columns; style it
    applyHeaderStyle(ws.getRow(4));

    data.rows.forEach((r, idx) => {
      const row = ws.addRow({
        code:   r.code,
        name:   r.name,
        type:   r.type,
        debit:  r.debit,
        credit: r.credit,
      });
      applyAlternatingFill(row, idx);
    });

    // Totals row
    const totRow = ws.addRow({
      code:   '',
      name:   'TOTAL',
      type:   '',
      debit:  data.totalDebits,
      credit: data.totalCredits,
    });
    totRow.font   = { bold: true };
    totRow.border = { top: { style: 'thin' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Journal Entries ────────────────────────────────────────────────────────

  async exportJournal(
    tenantId: string,
    opts: { from?: string; to?: string; status?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const result = await this.journal.findAll(tenantId, {
      from:   opts.from,
      to:     opts.to,
      status: opts.status as any,
    });
    const entries = result.data;

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Journal Entries', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF6C71C4' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'Journal Entries', `${range}   |   Generated: ${new Date().toLocaleString()}`, 7);

    ws.columns = [
      { key: 'entryNumber',  header: 'Entry #',       width: 16 },
      { key: 'postingDate',  header: 'Posting Date',  width: 16, style: { numFmt: DATE_FMT } },
      { key: 'docDate',      header: 'Doc Date',      width: 16, style: { numFmt: DATE_FMT } },
      { key: 'description',  header: 'Description',   width: 40 },
      { key: 'reference',    header: 'Reference',     width: 20 },
      { key: 'source',       header: 'Source',        width: 14 },
      { key: 'status',       header: 'Status',        width: 12 },
    ];

    applyHeaderStyle(ws.getRow(4));

    entries.forEach((entry, idx) => {
      const row = ws.addRow({
        entryNumber:  entry.entryNumber,
        postingDate:  entry.postingDate ? new Date(entry.postingDate) : new Date(entry.date),
        docDate:      new Date(entry.date),
        description:  entry.description,
        reference:    entry.reference ?? '',
        source:       entry.source,
        status:       entry.status,
      });
      applyAlternatingFill(row, idx);
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Account Ledger (FBL3N) ─────────────────────────────────────────────────

  async exportAccountLedger(
    tenantId: string,
    accountId: string,
    opts: { from?: string; to?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    // Fetch all rows (no pagination for export)
    const data = await this.accounts.getAccountLedger(tenantId, accountId, {
      from: opts.from,
      to:   opts.to,
      page: 1,
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Account Ledger', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FFCB4B16' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(
      ws,
      name,
      `${data.account.code} ${data.account.name}`,
      `${range}   |   Generated: ${new Date().toLocaleString()}`,
      8,
    );

    ws.columns = [
      { key: 'entryNumber',     header: 'Entry #',         width: 16 },
      { key: 'postingDate',     header: 'Posting Date',    width: 16, style: { numFmt: DATE_FMT } },
      { key: 'docDate',         header: 'Doc Date',        width: 16, style: { numFmt: DATE_FMT } },
      { key: 'description',     header: 'Description',     width: 40 },
      { key: 'reference',       header: 'Reference',       width: 20 },
      { key: 'debit',           header: 'Debit',           width: 18, style: { numFmt: PESO_FMT } },
      { key: 'credit',          header: 'Credit',          width: 18, style: { numFmt: PESO_FMT } },
      { key: 'runningBalance',  header: 'Running Balance', width: 18, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    data.rows.forEach((r, idx) => {
      const row = ws.addRow({
        entryNumber:    r.entryNumber,
        postingDate:    new Date(r.postingDate),
        docDate:        new Date(r.documentDate),
        description:    r.description ?? '',
        reference:      r.reference ?? '',
        debit:          r.debit,
        credit:         r.credit,
        runningBalance: r.runningBalance,
      });
      applyAlternatingFill(row, idx);
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── P&L Summary ───────────────────────────────────────────────────────────

  async exportPLSummary(tenantId: string, from: string, to: string): Promise<Buffer> {
    const [name, data] = await Promise.all([
      this.tenantName(tenantId),
      this.accounts.getPLSummary(tenantId, from, to),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('P&L Summary', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF268BD2' };

    writeReportHeader(
      ws,
      name,
      'Profit & Loss Summary',
      `${from} – ${to}   |   Generated: ${new Date().toLocaleString()}`,
      3,
    );

    ws.columns = [
      { key: 'code',    header: 'Code',    width: 10 },
      { key: 'name',    header: 'Account', width: 44 },
      { key: 'amount',  header: 'Amount',  width: 20, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    // Revenue section
    const revHeader = ws.addRow({ code: '', name: 'REVENUE', amount: null });
    revHeader.font = { bold: true, color: { argb: 'FF268BD2' } };

    data.revenueAccounts.forEach((r, idx) => {
      applyAlternatingFill(ws.addRow({ code: r.code, name: r.name, amount: r.balance }), idx);
    });

    const revTotRow = ws.addRow({ code: '', name: 'Total Revenue', amount: data.totalRevenue });
    revTotRow.font   = { bold: true };
    revTotRow.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };

    ws.addRow([]); // separator

    // Expense section
    const expHeader = ws.addRow({ code: '', name: 'EXPENSES', amount: null });
    expHeader.font = { bold: true, color: { argb: 'FFDC322F' } };

    data.expenseAccounts.forEach((r, idx) => {
      applyAlternatingFill(ws.addRow({ code: r.code, name: r.name, amount: r.balance }), idx);
    });

    const expTotRow = ws.addRow({ code: '', name: 'Total Expenses', amount: data.totalExpenses });
    expTotRow.font   = { bold: true };
    expTotRow.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };

    ws.addRow([]);

    const netRow = ws.addRow({ code: '', name: 'NET INCOME / (LOSS)', amount: data.netIncome });
    netRow.font = { bold: true, size: 12 };
    netRow.getCell('amount').font = {
      bold: true,
      size: 12,
      color: { argb: data.netIncome >= 0 ? 'FF268BD2' : 'FFDC322F' },
    };
    netRow.border = { top: { style: 'medium' }, bottom: { style: 'double' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Chart of Accounts ─────────────────────────────────────────────────────

  async exportChartOfAccounts(tenantId: string): Promise<Buffer> {
    const [name, accts] = await Promise.all([
      this.tenantName(tenantId),
      this.prisma.account.findMany({
        where:   { tenantId, isActive: true },
        include: { parent: { select: { code: true, name: true } } },
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
      }),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Chart of Accounts', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });
    ws.properties.tabColor = { argb: 'FF2AA198' };

    const COL_COUNT = 8;
    writeReportHeader(
      ws,
      name,
      'Chart of Accounts',
      `Generated: ${new Date().toLocaleString()}   |   ${accts.length} active accounts`,
      COL_COUNT,
    );

    ws.columns = [
      { key: 'code',           header: 'Code',            width: 12 },
      { key: 'name',           header: 'Account Name',    width: 44 },
      { key: 'type',           header: 'Type',            width: 14 },
      { key: 'normalBalance',  header: 'Normal Balance',  width: 16 },
      { key: 'postingControl', header: 'Posting Control', width: 18 },
      { key: 'isSystem',       header: 'System Account',  width: 16 },
      { key: 'parentCode',     header: 'Parent Code',     width: 14 },
      { key: 'description',    header: 'Description',     width: 44 },
    ];

    applyHeaderStyle(ws.getRow(4));

    // Group by type with section headers
    const TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
    let rowIdx = 0;

    for (const type of TYPE_ORDER) {
      const group = accts.filter((a) => a.type === type);
      if (!group.length) continue;

      // Section header row
      const secRow = ws.addRow({ code: '', name: type, type: '', normalBalance: '', postingControl: '', isSystem: '', parentCode: '', description: '' });
      secRow.font = { bold: true, size: 11, color: { argb: 'FF2AA198' } };
      secRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5F3' } };

      for (const a of group) {
        const row = ws.addRow({
          code:           a.code,
          name:           a.name,
          type:           a.type,
          normalBalance:  a.normalBalance,
          postingControl: a.postingControl,
          isSystem:       a.isSystem ? 'Yes' : 'No',
          parentCode:     a.parent?.code ?? '',
          description:    a.description ?? '',
        });
        applyAlternatingFill(row, rowIdx++);
        if (a.isSystem) {
          row.getCell('isSystem').font = { italic: true, color: { argb: 'FF888888' } };
        }
      }
    }

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Accountant CSV Export ──────────────────────────────────────────────────
  //
  // Plain CSV of all completed orders for a date range.
  // Intended for manual filing assistance — clearly labeled PRO-FORMA.
  // Includes: order number, date, subtotal, discount, vat, total, payment methods.

  async exportAccountantCsv(tenantId: string, from?: string, to?: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, taxStatus: true },
    });

    // Sprint 7: include PAID orders too (revenue recognized at sale time).
    // Date range on paidAt, not completedAt.
    const where: any = { tenantId, status: { in: ['PAID', 'COMPLETED'] } };
    if (from) where.paidAt = { ...where.paidAt, gte: new Date(`${from}T00:00:00+08:00`) };
    if (to)   where.paidAt = { ...where.paidAt, lte: new Date(`${to}T23:59:59.999+08:00`) };

    const orders = await this.prisma.order.findMany({
      where,
      include: { payments: true },
      orderBy: { paidAt: 'asc' },
    });

    const lines: string[] = [];

    // Header block
    lines.push(`"ACCOUNTANT EXPORT — FOR MANUAL FILING ASSISTANCE ONLY"`);
    lines.push(`"PRO-FORMA / ESTIMATE — NOT AN OFFICIAL BIR DOCUMENT"`);
    lines.push(`"Tenant: ${tenant?.name ?? tenantId}"`);
    lines.push(`"Period: ${from ?? 'All'} to ${to ?? 'All'}"`);
    lines.push(`"Generated: ${new Date().toISOString()}"`);
    lines.push(`"Tax Status: ${tenant?.taxStatus ?? 'UNREGISTERED'}"`);
    lines.push('');

    // Column headers
    lines.push([
      'Order Number',
      'Completed Date (PH)',
      'Subtotal',
      'Discount',
      'VAT',
      'Total Amount',
      'Cash',
      'Non-Cash',
      'Payment Methods',
    ].map((h) => `"${h}"`).join(','));

    // Data rows
    for (const order of orders) {
      const completedAt   = order.completedAt ?? order.createdAt;
      const phDate        = new Date(completedAt.getTime() + 8 * 60 * 60 * 1000)
                              .toISOString().slice(0, 19).replace('T', ' ');
      const cash          = order.payments.filter((p) => p.method === 'CASH')
                              .reduce((s, p) => s + Number(p.amount), 0);
      const nonCash       = order.payments.filter((p) => p.method !== 'CASH')
                              .reduce((s, p) => s + Number(p.amount), 0);
      const methodsSummary = [...new Set(order.payments.map((p) => p.method))].join(' + ');

      lines.push([
        order.orderNumber,
        phDate,
        Number(order.subtotal).toFixed(2),
        Number(order.discountAmount).toFixed(2),
        Number(order.vatAmount).toFixed(2),
        Number(order.totalAmount).toFixed(2),
        cash.toFixed(2),
        nonCash.toFixed(2),
        methodsSummary,
      ].map((v) => `"${v}"`).join(','));
    }

    // Totals row
    const totalGross   = orders.reduce((s, o) => s + Number(o.subtotal),       0);
    const totalDiscount = orders.reduce((s, o) => s + Number(o.discountAmount), 0);
    const totalVat     = orders.reduce((s, o) => s + Number(o.vatAmount),       0);
    const totalNet     = orders.reduce((s, o) => s + Number(o.totalAmount),     0);

    lines.push('');
    lines.push([
      `"TOTALS (${orders.length} orders)"`,
      '""',
      `"${totalGross.toFixed(2)}"`,
      `"${totalDiscount.toFixed(2)}"`,
      `"${totalVat.toFixed(2)}"`,
      `"${totalNet.toFixed(2)}"`,
      '""', '""', '""',
    ].join(','));

    return lines.join('\r\n');
  }

  // ── AP Aging ───────────────────────────────────────────────────────────────

  async exportApAging(tenantId: string): Promise<Buffer> {
    const [name, aging] = await Promise.all([
      this.tenantName(tenantId),
      this.apService.getAging(tenantId),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('AP Aging', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FFDC322F' };

    const COL_COUNT = 7;
    writeReportHeader(
      ws,
      name,
      'AP Aging Report',
      `As of ${new Date(aging.asOf).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}   |   Generated: ${new Date().toLocaleString()}`,
      COL_COUNT,
    );

    ws.columns = [
      { key: 'vendor',     header: 'Vendor',               width: 36 },
      { key: 'total',      header: 'Total Outstanding',    width: 20, style: { numFmt: PESO_FMT } },
      { key: 'current',    header: 'Current (not due)',     width: 20, style: { numFmt: PESO_FMT } },
      { key: 'days1_30',   header: '1–30 Days',            width: 18, style: { numFmt: PESO_FMT } },
      { key: 'days31_60',  header: '31–60 Days',           width: 18, style: { numFmt: PESO_FMT } },
      { key: 'days61_90',  header: '61–90 Days',           width: 18, style: { numFmt: PESO_FMT } },
      { key: 'days90plus', header: '90+ Days',             width: 18, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    aging.rows.forEach((r, idx) => {
      const row = ws.addRow({
        vendor:     r.vendorName,
        total:      r.total,
        current:    r.current,
        days1_30:   r.days1_30,
        days31_60:  r.days31_60,
        days61_90:  r.days61_90,
        days90plus: r.days90plus,
      });
      applyAlternatingFill(row, idx);
      // Color 90+ cell red if amount > 0
      if (r.days90plus > 0) {
        row.getCell('days90plus').font = { color: { argb: 'FFDC322F' }, bold: true };
      }
    });

    // Totals row
    const totRow = ws.addRow({
      vendor:     'TOTAL',
      total:      aging.totals.total,
      current:    aging.totals.current,
      days1_30:   aging.totals.days1_30,
      days31_60:  aging.totals.days31_60,
      days61_90:  aging.totals.days61_90,
      days90plus: aging.totals.days90plus,
    });
    totRow.font   = { bold: true };
    totRow.border = { top: { style: 'thin' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── AR Aging ───────────────────────────────────────────────────────────────

  async exportArAging(tenantId: string): Promise<Buffer> {
    const [name, aging] = await Promise.all([
      this.tenantName(tenantId),
      this.arService.getAging(tenantId),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('AR Aging', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF268BD2' };

    const COL_COUNT = 7;
    writeReportHeader(
      ws,
      name,
      'AR Aging Report',
      `As of ${new Date(aging.asOf).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}   |   Generated: ${new Date().toLocaleString()}`,
      COL_COUNT,
    );

    ws.columns = [
      { key: 'customer',    header: 'Customer',            width: 36 },
      { key: 'total',       header: 'Total Outstanding',   width: 20, style: { numFmt: PESO_FMT } },
      { key: 'notDue',      header: 'Not Due',             width: 18, style: { numFmt: PESO_FMT } },
      { key: 'bucket1_30',  header: '1–30 Days',           width: 18, style: { numFmt: PESO_FMT } },
      { key: 'bucket31_60', header: '31–60 Days',          width: 18, style: { numFmt: PESO_FMT } },
      { key: 'bucket61_90', header: '61–90 Days',          width: 18, style: { numFmt: PESO_FMT } },
      { key: 'bucket90plus',header: '90+ Days',            width: 18, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    aging.rows.forEach((r, idx) => {
      const row = ws.addRow({
        customer:    r.customerName,
        total:       r.total,
        notDue:      r.notDue,
        bucket1_30:  r.bucket1_30,
        bucket31_60: r.bucket31_60,
        bucket61_90: r.bucket61_90,
        bucket90plus: r.bucket90plus,
      });
      applyAlternatingFill(row, idx);
      // Color 90+ cell red if amount > 0
      if (r.bucket90plus > 0) {
        row.getCell('bucket90plus').font = { color: { argb: 'FFDC322F' }, bold: true };
      }
    });

    // Totals row
    const totRow = ws.addRow({
      customer:    'GRAND TOTAL',
      total:       aging.grandTotal.total,
      notDue:      aging.grandTotal.notDue,
      bucket1_30:  aging.grandTotal.bucket1_30,
      bucket31_60: aging.grandTotal.bucket31_60,
      bucket61_90: aging.grandTotal.bucket61_90,
      bucket90plus: aging.grandTotal.bucket90plus,
    });
    totRow.font   = { bold: true };
    totRow.border = { top: { style: 'thin' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Payroll YTD ────────────────────────────────────────────────────────────

  async exportPayrollYtd(tenantId: string, year: number): Promise<Buffer> {
    const [name, allRuns] = await Promise.all([
      this.tenantName(tenantId),
      this.payrollService.getPayRuns(tenantId),
    ]);

    const yearStr = String(year);
    const runs = allRuns.filter(
      (r) => r.status === 'COMPLETED' && r.periodStart.startsWith(yearStr),
    );

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Payroll YTD', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF2AA198' };

    const COL_COUNT = 8;
    writeReportHeader(
      ws,
      name,
      `Payroll Year-to-Date ${yearStr}`,
      `Generated: ${new Date().toLocaleString()}`,
      COL_COUNT,
    );

    ws.columns = [
      { key: 'periodStart',  header: 'Period Start',  width: 18 },
      { key: 'periodEnd',    header: 'Period End',    width: 18 },
      { key: 'label',        header: 'Label',         width: 24 },
      { key: 'frequency',    header: 'Frequency',     width: 16 },
      { key: 'employees',    header: 'Employees',     width: 12 },
      { key: 'grossPay',     header: 'Gross Pay',     width: 20, style: { numFmt: PESO_FMT } },
      { key: 'deductions',   header: 'Deductions',    width: 20, style: { numFmt: PESO_FMT } },
      { key: 'netPay',       header: 'Net Pay',       width: 20, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    let sumGross = 0;
    let sumDeductions = 0;
    let sumNet = 0;

    runs.forEach((r, idx) => {
      sumGross      += r.totalGross;
      sumDeductions += r.totalDeductions;
      sumNet        += r.totalNet;

      const row = ws.addRow({
        periodStart: r.periodStart.slice(0, 10),
        periodEnd:   r.periodEnd.slice(0, 10),
        label:       r.label,
        frequency:   r.frequency,
        employees:   r.employeeCount,
        grossPay:    r.totalGross,
        deductions:  r.totalDeductions,
        netPay:      r.totalNet,
      });
      applyAlternatingFill(row, idx);
    });

    // Totals row
    const totRow = ws.addRow({
      periodStart: '',
      periodEnd:   '',
      label:       'TOTAL',
      frequency:   '',
      employees:   runs.reduce((s, r) => s + r.employeeCount, 0),
      grossPay:    sumGross,
      deductions:  sumDeductions,
      netPay:      sumNet,
    });
    totRow.font   = { bold: true };
    totRow.border = { top: { style: 'thin' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ─── BIR Form 2316 — Annual Compensation Alphalist ──────────────────────────
  /**
   * Generates the BIR 2316 alphalist for a given calendar year.
   * One row per active employee with YTD compensation broken down into
   * statutory taxable, non-taxable contributions, and withheld tax.
   *
   * Output mirrors the BIR alphalist layout for manual upload to BIR's
   * eFPS / Alphalist Data Entry tool. We do NOT submit electronically here.
   */
  async exportBir2316(tenantId: string, year: number): Promise<Buffer> {
    const yStart = new Date(Date.UTC(year, 0, 1));
    const yEnd   = new Date(Date.UTC(year + 1, 0, 1));

    const [name, employees] = await Promise.all([
      this.tenantName(tenantId),
      this.prisma.user.findMany({
        where: {
          tenantId,
          role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR', 'KIOSK_DISPLAY'] },
        },
        select: {
          id:    true, name: true, email: true, hiredAt: true,
          payslips: {
            where: {
              tenantId,
              payRun: { periodStart: { gte: yStart, lt: yEnd } },
            },
            select: {
              basicPay: true, overtimePay: true, allowances: true, grossPay: true,
              sssContrib: true, philhealthContrib: true, pagibigContrib: true,
              withholdingTax: true, otherDeductions: true, netPay: true,
            },
          },
          thirteenthMonths: {
            where:  { tenantId, year },
            select: { amount: true },
          },
        },
      }),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('BIR 2316 Alphalist', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF8B5E3C' };

    writeReportHeader(
      ws,
      name,
      `BIR Form 2316 Alphalist — ${year}`,
      `Generated: ${new Date().toLocaleString()}   |   ${employees.length} employees`,
      11,
    );

    ws.columns = [
      { key: 'employeeName',     header: 'Employee Name',          width: 28 },
      { key: 'email',            header: 'Email',                  width: 28 },
      { key: 'hiredAt',          header: 'Hire Date',              width: 12 },
      { key: 'basicYTD',         header: 'Basic Salary YTD',       width: 18, style: { numFmt: PESO_FMT } },
      { key: 'overtimeYTD',      header: 'Overtime Pay YTD',       width: 16, style: { numFmt: PESO_FMT } },
      { key: 'allowancesYTD',    header: 'Allowances YTD',         width: 16, style: { numFmt: PESO_FMT } },
      { key: 'grossYTD',         header: 'Gross Compensation YTD', width: 20, style: { numFmt: PESO_FMT } },
      { key: 'sssYTD',           header: 'SSS Contributions',      width: 16, style: { numFmt: PESO_FMT } },
      { key: 'philhealthYTD',    header: 'PhilHealth Contribs',    width: 18, style: { numFmt: PESO_FMT } },
      { key: 'pagibigYTD',       header: 'Pag-IBIG Contribs',      width: 18, style: { numFmt: PESO_FMT } },
      { key: 'thirteenthMonth',  header: '13th-Month Pay',         width: 16, style: { numFmt: PESO_FMT } },
      { key: 'whtYTD',           header: 'Withholding Tax YTD',    width: 18, style: { numFmt: PESO_FMT } },
      { key: 'netYTD',           header: 'Net Compensation YTD',   width: 20, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    let sumBasic = 0, sumOT = 0, sumAllow = 0, sumGross = 0,
        sumSss = 0, sumPhic = 0, sumHdmf = 0, sum13th = 0,
        sumWht = 0, sumNet = 0;

    employees.forEach((e, idx) => {
      const sum = (key: keyof typeof e.payslips[number]) =>
        e.payslips.reduce((acc, p) => acc + Number(p[key] ?? 0), 0);

      const basic     = sum('basicPay');
      const overtime  = sum('overtimePay');
      const allow     = sum('allowances');
      const gross     = sum('grossPay');
      const sss       = sum('sssContrib');
      const phic      = sum('philhealthContrib');
      const hdmf      = sum('pagibigContrib');
      const wht       = sum('withholdingTax');
      const net       = sum('netPay');
      const t13       = e.thirteenthMonths.reduce((a, t) => a + Number(t.amount), 0);

      sumBasic += basic; sumOT += overtime; sumAllow += allow; sumGross += gross;
      sumSss   += sss;   sumPhic += phic;    sumHdmf += hdmf;
      sumWht   += wht;   sumNet  += net;     sum13th += t13;

      applyAlternatingFill(
        ws.addRow({
          employeeName:    e.name,
          email:           e.email,
          hiredAt:         e.hiredAt ? e.hiredAt.toISOString().slice(0, 10) : '',
          basicYTD:        basic,
          overtimeYTD:     overtime,
          allowancesYTD:   allow,
          grossYTD:        gross,
          sssYTD:          sss,
          philhealthYTD:   phic,
          pagibigYTD:      hdmf,
          thirteenthMonth: t13,
          whtYTD:          wht,
          netYTD:          net,
        }),
        idx,
      );
    });

    const totRow = ws.addRow({
      employeeName:    'TOTAL',
      email:           '',
      hiredAt:         '',
      basicYTD:        sumBasic,
      overtimeYTD:     sumOT,
      allowancesYTD:   sumAllow,
      grossYTD:        sumGross,
      sssYTD:          sumSss,
      philhealthYTD:   sumPhic,
      pagibigYTD:      sumHdmf,
      thirteenthMonth: sum13th,
      whtYTD:          sumWht,
      netYTD:          sumNet,
    });
    totRow.font   = { bold: true };
    totRow.border = { top: { style: 'thin' }, bottom: { style: 'double' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── New exports (Commit 1) ───────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  // ── Balance Sheet ─────────────────────────────────────────────────────────

  async exportBalanceSheet(tenantId: string, asOf?: string): Promise<Buffer> {
    const [name, data] = await Promise.all([
      this.tenantName(tenantId),
      this.accounts.getBalanceSheet(tenantId, asOf),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Balance Sheet', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF2AA198' };

    writeReportHeader(
      ws,
      name,
      'Balance Sheet',
      `As of ${data.asOf}   |   Generated: ${new Date().toLocaleString()}`,
      3,
    );

    ws.columns = [
      { key: 'code',   header: 'Code',    width: 10 },
      { key: 'name',   header: 'Account', width: 44 },
      { key: 'amount', header: 'Amount',  width: 20, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    const writeSection = (
      title: string,
      colorArgb: string,
      rows: { code: string; name: string; balance: number }[],
      totalLabel: string,
      totalAmount: number,
    ) => {
      const sec = ws.addRow({ code: '', name: title, amount: null });
      sec.font = { bold: true, color: { argb: colorArgb } };

      rows.forEach((r, idx) => {
        applyAlternatingFill(
          ws.addRow({ code: r.code, name: r.name, amount: r.balance }),
          idx,
        );
      });

      const tot = ws.addRow({ code: '', name: totalLabel, amount: totalAmount });
      tot.font   = { bold: true };
      tot.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
      ws.addRow([]);
    };

    writeSection('ASSETS',      'FF2AA198', data.assets,      'Total Assets',      data.totalAssets);
    writeSection('LIABILITIES', 'FFDC322F', data.liabilities, 'Total Liabilities', data.totalLiabilities);
    writeSection('EQUITY',      'FF268BD2', data.equity,      'Total Equity',      data.totalEquity);

    const lePlusE = ws.addRow({
      code: '',
      name: 'TOTAL LIABILITIES + EQUITY',
      amount: data.totalLiabilitiesAndEquity,
    });
    lePlusE.font = { bold: true, size: 12 };
    lePlusE.border = { top: { style: 'medium' }, bottom: { style: 'double' } };

    const balRow = ws.addRow({
      code: '',
      name: data.balanced ? 'BALANCED' : 'UNBALANCED — review entries',
      amount: null,
    });
    balRow.font = {
      bold: true,
      color: { argb: data.balanced ? 'FF2AA198' : 'FFDC322F' },
    };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Cash Flow Statement ───────────────────────────────────────────────────

  async exportCashFlow(tenantId: string, from: string, to: string): Promise<Buffer> {
    const [name, data] = await Promise.all([
      this.tenantName(tenantId),
      this.accounts.getCashFlow(tenantId, from, to),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Cash Flow', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF6C71C4' };

    writeReportHeader(
      ws,
      name,
      'Cash Flow Statement (Indirect Method)',
      `${from} – ${to}   |   Generated: ${new Date().toLocaleString()}`,
      3,
    );

    ws.columns = [
      { key: 'code',   header: 'Code',    width: 10 },
      { key: 'name',   header: 'Item',    width: 50 },
      { key: 'amount', header: 'Amount',  width: 20, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    // Net Income line
    const niRow = ws.addRow({ code: '', name: 'Net Income (from P&L)', amount: data.netIncome });
    niRow.font = { bold: true };
    ws.addRow([]);

    const writeFlowSection = (
      title: string,
      colorArgb: string,
      rows: { code: string; name: string; effectOnCash: number }[],
      totalLabel: string,
      totalAmount: number,
    ) => {
      const sec = ws.addRow({ code: '', name: title, amount: null });
      sec.font = { bold: true, color: { argb: colorArgb } };

      rows.forEach((r, idx) => {
        applyAlternatingFill(
          ws.addRow({ code: r.code, name: r.name, amount: r.effectOnCash }),
          idx,
        );
      });

      const tot = ws.addRow({ code: '', name: totalLabel, amount: totalAmount });
      tot.font   = { bold: true };
      tot.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
      ws.addRow([]);
    };

    writeFlowSection('OPERATING ACTIVITIES', 'FF2AA198', data.operating, 'Net Cash from Operating', data.operatingTotal);
    writeFlowSection('INVESTING ACTIVITIES', 'FF268BD2', data.investing, 'Net Cash from Investing', data.investingTotal);
    writeFlowSection('FINANCING ACTIVITIES', 'FFCB4B16', data.financing, 'Net Cash from Financing', data.financingTotal);

    const openRow = ws.addRow({ code: '', name: 'Opening Cash Balance', amount: data.openingCash });
    openRow.font = { bold: true };
    const netRow = ws.addRow({ code: '', name: 'Net Change in Cash', amount: data.netChange });
    netRow.font = { bold: true };
    netRow.border = { top: { style: 'thin' } };
    const endRow = ws.addRow({ code: '', name: 'Ending Cash Balance', amount: data.endingCash });
    endRow.font = { bold: true, size: 12 };
    endRow.border = { top: { style: 'medium' }, bottom: { style: 'double' } };

    const reconRow = ws.addRow({
      code: '',
      name: data.reconciles ? 'Reconciles with Balance Sheet' : 'DOES NOT RECONCILE — investigate',
      amount: null,
    });
    reconRow.font = {
      bold: true,
      color: { argb: data.reconciles ? 'FF2AA198' : 'FFDC322F' },
    };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Journal Templates ─────────────────────────────────────────────────────

  async exportJournalTemplates(tenantId: string): Promise<Buffer> {
    const [name, templates] = await Promise.all([
      this.tenantName(tenantId),
      this.prisma.journalTemplate.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ frequency: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Journal Templates', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF6C71C4' };

    writeReportHeader(
      ws,
      name,
      'Journal Templates',
      `Generated: ${new Date().toLocaleString()}   |   ${templates.length} active templates`,
      5,
    );

    ws.columns = [
      { key: 'tplName',   header: 'Name',          width: 32 },
      { key: 'frequency', header: 'Frequency',     width: 14 },
      { key: 'nextRunAt', header: 'Next Run',      width: 20 },
      { key: 'lineCount', header: 'Line Count',    width: 12 },
      { key: 'isActive',  header: 'Active',        width: 10 },
    ];

    applyHeaderStyle(ws.getRow(4));

    templates.forEach((t, idx) => {
      const lines = Array.isArray(t.lines) ? t.lines.length : 0;
      applyAlternatingFill(
        ws.addRow({
          tplName:   t.name,
          frequency: t.frequency,
          nextRunAt: t.nextRunAt ? t.nextRunAt.toISOString().slice(0, 16).replace('T', ' ') : '',
          lineCount: lines,
          isActive:  t.isActive ? 'Yes' : 'No',
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── AR Invoice Register ───────────────────────────────────────────────────

  async exportArInvoiceRegister(
    tenantId: string,
    opts: { from?: string; to?: string; status?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const result = await this.arInvoices.findAll(tenantId, {
      from:     opts.from,
      to:       opts.to,
      status:   opts.status as any,
      pageSize: 10_000,
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('AR Invoices', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF268BD2' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'AR Invoice Register', `${range}   |   Generated: ${new Date().toLocaleString()}`, 10);

    ws.columns = [
      { key: 'invoiceNumber', header: 'Invoice #',     width: 16 },
      { key: 'invoiceDate',   header: 'Invoice Date',  width: 14, style: { numFmt: DATE_FMT } },
      { key: 'dueDate',       header: 'Due Date',      width: 14, style: { numFmt: DATE_FMT } },
      { key: 'customerName',  header: 'Customer',      width: 32 },
      { key: 'status',        header: 'Status',        width: 14 },
      { key: 'subtotal',      header: 'Subtotal',      width: 16, style: { numFmt: PESO_FMT } },
      { key: 'vatAmount',     header: 'VAT',           width: 14, style: { numFmt: PESO_FMT } },
      { key: 'totalAmount',   header: 'Total',         width: 16, style: { numFmt: PESO_FMT } },
      { key: 'paidAmount',    header: 'Paid',          width: 14, style: { numFmt: PESO_FMT } },
      { key: 'balanceAmount', header: 'Balance',       width: 16, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    result.data.forEach((inv: any, idx: number) => {
      applyAlternatingFill(
        ws.addRow({
          invoiceNumber: inv.invoiceNumber,
          invoiceDate:   new Date(inv.invoiceDate),
          dueDate:       new Date(inv.dueDate),
          customerName:  inv.customer?.name ?? '',
          status:        inv.status,
          subtotal:      Number(inv.subtotal),
          vatAmount:     Number(inv.vatAmount),
          totalAmount:   Number(inv.totalAmount),
          paidAmount:    Number(inv.paidAmount),
          balanceAmount: Number(inv.balanceAmount),
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Quotes Register ───────────────────────────────────────────────────────

  async exportQuotes(
    tenantId: string,
    opts: { from?: string; to?: string; status?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const where: any = { tenantId };
    if (opts.status) where.status = opts.status;
    if (opts.from)   where.quoteDate = { ...(where.quoteDate ?? {}), gte: new Date(opts.from) };
    if (opts.to)     where.quoteDate = { ...(where.quoteDate ?? {}), lte: new Date(opts.to) };

    const quotes = await this.prisma.quote.findMany({
      where,
      orderBy: [{ quoteDate: 'desc' }, { quoteNumber: 'desc' }],
      include: {
        customer:         { select: { name: true } },
        convertedInvoice: { select: { invoiceNumber: true } },
      },
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Quotes', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF268BD2' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'Quotes Register', `${range}   |   Generated: ${new Date().toLocaleString()}`, 9);

    ws.columns = [
      { key: 'quoteNumber',  header: 'Quote #',         width: 16 },
      { key: 'quoteDate',    header: 'Quote Date',      width: 14, style: { numFmt: DATE_FMT } },
      { key: 'validUntil',   header: 'Valid Until',     width: 14, style: { numFmt: DATE_FMT } },
      { key: 'customerName', header: 'Customer',        width: 32 },
      { key: 'status',       header: 'Status',          width: 14 },
      { key: 'subtotal',     header: 'Subtotal',        width: 16, style: { numFmt: PESO_FMT } },
      { key: 'vatAmount',    header: 'VAT',             width: 14, style: { numFmt: PESO_FMT } },
      { key: 'totalAmount',  header: 'Total',           width: 16, style: { numFmt: PESO_FMT } },
      { key: 'invoiceNumber', header: 'Converted To',   width: 16 },
    ];

    applyHeaderStyle(ws.getRow(4));

    quotes.forEach((q, idx) => {
      applyAlternatingFill(
        ws.addRow({
          quoteNumber:   q.quoteNumber,
          quoteDate:     new Date(q.quoteDate),
          validUntil:    new Date(q.validUntil),
          customerName:  q.customer?.name ?? '',
          status:        q.status,
          subtotal:      Number(q.subtotal),
          vatAmount:     Number(q.vatAmount),
          totalAmount:   Number(q.totalAmount),
          invoiceNumber: q.convertedInvoice?.invoiceNumber ?? '',
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── AR Customer Statement ─────────────────────────────────────────────────

  async exportArCustomerStatement(
    tenantId: string,
    customerId: string,
    opts: { from?: string; to?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });
    if (!customer) {
      throw new Error('Customer not found');
    }

    const dateRange: { gte?: Date; lte?: Date } = {};
    if (opts.from) dateRange.gte = new Date(opts.from);
    if (opts.to)   dateRange.lte = new Date(opts.to);
    const hasRange = Object.keys(dateRange).length > 0;

    const [invoices, payments] = await Promise.all([
      this.prisma.aRInvoice.findMany({
        where: {
          tenantId,
          customerId,
          ...(hasRange ? { invoiceDate: dateRange } : {}),
        },
        orderBy: { invoiceDate: 'asc' },
      }),
      this.prisma.aRPayment.findMany({
        where: {
          tenantId,
          customerId,
          ...(hasRange ? { paymentDate: dateRange } : {}),
        },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Customer Statement', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF268BD2' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(
      ws,
      name,
      `Customer Statement — ${customer.name}`,
      `${range}   |   Generated: ${new Date().toLocaleString()}`,
      6,
    );

    ws.columns = [
      { key: 'date',        header: 'Date',         width: 14, style: { numFmt: DATE_FMT } },
      { key: 'type',        header: 'Type',         width: 12 },
      { key: 'ref',         header: 'Reference',    width: 18 },
      { key: 'description', header: 'Description',  width: 36 },
      { key: 'debit',       header: 'Debit (Inv)',  width: 16, style: { numFmt: PESO_FMT } },
      { key: 'credit',      header: 'Credit (Pmt)', width: 16, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    // Customer master row
    const masterRow = ws.addRow({
      date: '',
      type: 'CUSTOMER',
      ref:  customer.name,
      description: `TIN: ${customer.tin ?? 'N/A'}  |  Email: ${customer.contactEmail ?? 'N/A'}`,
      debit: null,
      credit: null,
    });
    masterRow.font = { bold: true, color: { argb: 'FF268BD2' } };
    ws.addRow([]);

    // Merge chronologically
    type Entry = { date: Date; type: 'INVOICE' | 'PAYMENT'; ref: string; description: string; debit: number; credit: number };
    const entries: Entry[] = [
      ...invoices.map<Entry>((i) => ({
        date: i.invoiceDate, type: 'INVOICE',
        ref: i.invoiceNumber, description: i.description ?? '',
        debit: Number(i.totalAmount), credit: 0,
      })),
      ...payments.map<Entry>((p) => ({
        date: p.paymentDate, type: 'PAYMENT',
        ref: p.paymentNumber, description: p.description ?? `Payment via ${p.method}`,
        debit: 0, credit: Number(p.totalAmount),
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningDebit = 0;
    let runningCredit = 0;
    entries.forEach((e, idx) => {
      runningDebit  += e.debit;
      runningCredit += e.credit;
      applyAlternatingFill(
        ws.addRow({
          date:        e.date,
          type:        e.type,
          ref:         e.ref,
          description: e.description,
          debit:       e.debit || null,
          credit:      e.credit || null,
        }),
        idx,
      );
    });

    const tot = ws.addRow({
      date: '', type: '', ref: '', description: 'BALANCE',
      debit: runningDebit, credit: runningCredit,
    });
    tot.font   = { bold: true };
    tot.border = { top: { style: 'thin' } };

    const netRow = ws.addRow({
      date: '', type: '', ref: '', description: 'NET OUTSTANDING',
      debit: Math.max(0, runningDebit - runningCredit), credit: null,
    });
    netRow.font = { bold: true, size: 12 };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── AR Payments ───────────────────────────────────────────────────────────

  async exportArPayments(
    tenantId: string,
    opts: { from?: string; to?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const result = await this.arPayments.findAll(tenantId, {
      from:     opts.from,
      to:       opts.to,
      pageSize: 10_000,
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('AR Payments', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF268BD2' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'AR Payments', `${range}   |   Generated: ${new Date().toLocaleString()}`, 6);

    ws.columns = [
      { key: 'paymentNumber', header: 'Payment #',    width: 18 },
      { key: 'paymentDate',   header: 'Payment Date', width: 14, style: { numFmt: DATE_FMT } },
      { key: 'customerName',  header: 'Customer',     width: 32 },
      { key: 'method',        header: 'Method',       width: 16 },
      { key: 'totalAmount',   header: 'Amount',       width: 16, style: { numFmt: PESO_FMT } },
      { key: 'apps',          header: 'Applications', width: 14 },
    ];

    applyHeaderStyle(ws.getRow(4));

    result.data.forEach((p: any, idx: number) => {
      applyAlternatingFill(
        ws.addRow({
          paymentNumber: p.paymentNumber,
          paymentDate:   new Date(p.paymentDate),
          customerName:  p.customer?.name ?? '',
          method:        p.method,
          totalAmount:   Number(p.totalAmount),
          apps:          p.applications?.length ?? 0,
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── AP Bill Register ──────────────────────────────────────────────────────

  async exportApBillRegister(
    tenantId: string,
    opts: { from?: string; to?: string; status?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const result = await this.apBills.findAll(tenantId, {
      from:     opts.from,
      to:       opts.to,
      status:   opts.status as any,
      pageSize: 10_000,
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('AP Bills', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FFDC322F' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'AP Bill Register', `${range}   |   Generated: ${new Date().toLocaleString()}`, 11);

    ws.columns = [
      { key: 'billNumber',    header: 'Bill #',        width: 16 },
      { key: 'billDate',      header: 'Bill Date',     width: 14, style: { numFmt: DATE_FMT } },
      { key: 'dueDate',       header: 'Due Date',      width: 14, style: { numFmt: DATE_FMT } },
      { key: 'vendorName',    header: 'Vendor',        width: 32 },
      { key: 'status',        header: 'Status',        width: 14 },
      { key: 'subtotal',      header: 'Subtotal',      width: 16, style: { numFmt: PESO_FMT } },
      { key: 'vatAmount',     header: 'VAT',           width: 14, style: { numFmt: PESO_FMT } },
      { key: 'whtAmount',     header: 'WHT',           width: 14, style: { numFmt: PESO_FMT } },
      { key: 'totalAmount',   header: 'Total',         width: 16, style: { numFmt: PESO_FMT } },
      { key: 'paidAmount',    header: 'Paid',          width: 14, style: { numFmt: PESO_FMT } },
      { key: 'balanceAmount', header: 'Balance',       width: 16, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    result.data.forEach((b: any, idx: number) => {
      applyAlternatingFill(
        ws.addRow({
          billNumber:    b.billNumber,
          billDate:      new Date(b.billDate),
          dueDate:       new Date(b.dueDate),
          vendorName:    b.vendor?.name ?? '',
          status:        b.status,
          subtotal:      Number(b.subtotal),
          vatAmount:     Number(b.vatAmount),
          whtAmount:     Number(b.whtAmount),
          totalAmount:   Number(b.totalAmount),
          paidAmount:    Number(b.paidAmount),
          balanceAmount: Number(b.balanceAmount),
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── AP Vendor Statement ───────────────────────────────────────────────────

  async exportApVendorStatement(
    tenantId: string,
    vendorId: string,
    opts: { from?: string; to?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, tenantId },
    });
    if (!vendor) {
      throw new Error('Vendor not found');
    }

    const dateRange: { gte?: Date; lte?: Date } = {};
    if (opts.from) dateRange.gte = new Date(opts.from);
    if (opts.to)   dateRange.lte = new Date(opts.to);
    const hasRange = Object.keys(dateRange).length > 0;

    const [bills, payments] = await Promise.all([
      this.prisma.aPBill.findMany({
        where: { tenantId, vendorId, ...(hasRange ? { billDate: dateRange } : {}) },
        orderBy: { billDate: 'asc' },
      }),
      this.prisma.aPPayment.findMany({
        where: { tenantId, vendorId, ...(hasRange ? { paymentDate: dateRange } : {}) },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Vendor Statement', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FFDC322F' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(
      ws,
      name,
      `Vendor Statement — ${vendor.name}`,
      `${range}   |   Generated: ${new Date().toLocaleString()}`,
      6,
    );

    ws.columns = [
      { key: 'date',        header: 'Date',          width: 14, style: { numFmt: DATE_FMT } },
      { key: 'type',        header: 'Type',          width: 12 },
      { key: 'ref',         header: 'Reference',     width: 18 },
      { key: 'description', header: 'Description',   width: 36 },
      { key: 'credit',      header: 'Credit (Bill)', width: 16, style: { numFmt: PESO_FMT } },
      { key: 'debit',       header: 'Debit (Pmt)',   width: 16, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    const masterRow = ws.addRow({
      date: '',
      type: 'VENDOR',
      ref:  vendor.name,
      description: `TIN: ${vendor.tin ?? 'N/A'}`,
      credit: null,
      debit: null,
    });
    masterRow.font = { bold: true, color: { argb: 'FFDC322F' } };
    ws.addRow([]);

    type Entry = { date: Date; type: 'BILL' | 'PAYMENT'; ref: string; description: string; credit: number; debit: number };
    const entries: Entry[] = [
      ...bills.map<Entry>((b) => ({
        date: b.billDate, type: 'BILL',
        ref: b.billNumber, description: b.description ?? '',
        credit: Number(b.totalAmount), debit: 0,
      })),
      ...payments.map<Entry>((p) => ({
        date: p.paymentDate, type: 'PAYMENT',
        ref: p.paymentNumber, description: p.description ?? `Payment via ${p.method}`,
        credit: 0, debit: Number(p.totalAmount),
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let totalCredit = 0, totalDebit = 0;
    entries.forEach((e, idx) => {
      totalCredit += e.credit;
      totalDebit  += e.debit;
      applyAlternatingFill(
        ws.addRow({
          date:        e.date,
          type:        e.type,
          ref:         e.ref,
          description: e.description,
          credit:      e.credit || null,
          debit:       e.debit  || null,
        }),
        idx,
      );
    });

    const tot = ws.addRow({
      date: '', type: '', ref: '', description: 'BALANCE',
      credit: totalCredit, debit: totalDebit,
    });
    tot.font   = { bold: true };
    tot.border = { top: { style: 'thin' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── AP Payments ───────────────────────────────────────────────────────────

  async exportApPayments(
    tenantId: string,
    opts: { from?: string; to?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const result = await this.apPayments.findAll(tenantId, {
      from:     opts.from,
      to:       opts.to,
      pageSize: 10_000,
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('AP Payments', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FFDC322F' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'AP Payments', `${range}   |   Generated: ${new Date().toLocaleString()}`, 7);

    ws.columns = [
      { key: 'paymentNumber', header: 'Payment #',    width: 18 },
      { key: 'paymentDate',   header: 'Payment Date', width: 14, style: { numFmt: DATE_FMT } },
      { key: 'vendorName',    header: 'Vendor',       width: 32 },
      { key: 'method',        header: 'Method',       width: 16 },
      { key: 'totalAmount',   header: 'Amount',       width: 16, style: { numFmt: PESO_FMT } },
      { key: 'whtAmount',     header: 'WHT Applied',  width: 14, style: { numFmt: PESO_FMT } },
      { key: 'apps',          header: 'Applications', width: 14 },
    ];

    applyHeaderStyle(ws.getRow(4));

    result.data.forEach((p: any, idx: number) => {
      applyAlternatingFill(
        ws.addRow({
          paymentNumber: p.paymentNumber,
          paymentDate:   new Date(p.paymentDate),
          vendorName:    p.vendor?.name ?? '',
          method:        p.method,
          totalAmount:   Number(p.totalAmount),
          whtAmount:     Number(p.whtAmount ?? 0),
          apps:          p.applications?.length ?? 0,
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── AP Expenses ───────────────────────────────────────────────────────────

  async exportApExpenses(
    tenantId: string,
    opts: { from?: string; to?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const result = await this.apService.findAll(tenantId, {
      from: opts.from,
      to:   opts.to,
      page: 1,
      limit: 200,
    });
    // Fetch any remaining pages if needed (cap at 10k entries)
    const allData: any[] = [...result.data];
    if (result.pages > 1) {
      for (let pg = 2; pg <= result.pages && allData.length < 10_000; pg++) {
        const r = await this.apService.findAll(tenantId, { from: opts.from, to: opts.to, page: pg, limit: 200 });
        allData.push(...r.data);
      }
    }

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('AP Expenses', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FFDC322F' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'AP Expenses', `${range}   |   Generated: ${new Date().toLocaleString()}`, 7);

    ws.columns = [
      { key: 'expenseDate', header: 'Expense Date', width: 14, style: { numFmt: DATE_FMT } },
      { key: 'description', header: 'Description',  width: 40 },
      { key: 'vendorName',  header: 'Vendor',       width: 28 },
      { key: 'grossAmount', header: 'Gross',        width: 14, style: { numFmt: PESO_FMT } },
      { key: 'whtAmount',   header: 'WHT',          width: 14, style: { numFmt: PESO_FMT } },
      { key: 'netAmount',   header: 'Net',          width: 14, style: { numFmt: PESO_FMT } },
      { key: 'status',      header: 'Status',       width: 12 },
    ];

    applyHeaderStyle(ws.getRow(4));

    allData.forEach((e: any, idx: number) => {
      applyAlternatingFill(
        ws.addRow({
          expenseDate: new Date(e.expenseDate),
          description: e.description ?? '',
          vendorName:  e.vendor?.name ?? '',
          grossAmount: Number(e.grossAmount),
          whtAmount:   Number(e.whtAmount),
          netAmount:   Number(e.netAmount),
          status:      e.status,
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Expense Claims ────────────────────────────────────────────────────────

  async exportExpenseClaims(
    tenantId: string,
    opts: { from?: string; to?: string; status?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);

    const where: any = { tenantId };
    if (opts.status) where.status = opts.status;
    if (opts.from || opts.to) {
      where.submittedAt = {};
      if (opts.from) where.submittedAt.gte = new Date(opts.from);
      if (opts.to)   where.submittedAt.lte = new Date(opts.to);
    }

    const claims = await this.prisma.expenseClaim.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: 10_000,
    });

    const submitterIds = [...new Set(claims.map((c) => c.submittedById))];
    const submitters = await this.prisma.user.findMany({
      where: { id: { in: submitterIds }, tenantId },
      select: { id: true, name: true, email: true },
    });
    const submitterMap = new Map(submitters.map((u) => [u.id, u]));

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Expense Claims', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FFCB4B16' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'Expense Claims', `${range}   |   Generated: ${new Date().toLocaleString()}`, 7);

    ws.columns = [
      { key: 'claimNumber',  header: 'Claim #',      width: 18 },
      { key: 'submittedAt',  header: 'Submitted',    width: 16 },
      { key: 'employeeName', header: 'Employee',     width: 28 },
      { key: 'totalAmount',  header: 'Total',        width: 16, style: { numFmt: PESO_FMT } },
      { key: 'status',       header: 'Status',       width: 14 },
      { key: 'approvedAt',   header: 'Approved',     width: 16 },
      { key: 'paidAt',       header: 'Paid',         width: 16 },
    ];

    applyHeaderStyle(ws.getRow(4));

    claims.forEach((c, idx) => {
      const u = submitterMap.get(c.submittedById);
      applyAlternatingFill(
        ws.addRow({
          claimNumber:  c.claimNumber,
          submittedAt:  c.submittedAt ? c.submittedAt.toISOString().slice(0, 10) : '',
          employeeName: u?.name ?? u?.email ?? c.submittedById,
          totalAmount:  Number(c.totalAmount),
          status:       c.status,
          approvedAt:   c.reviewedAt ? c.reviewedAt.toISOString().slice(0, 10) : '',
          paidAt:       c.paidAt ? c.paidAt.toISOString().slice(0, 10) : '',
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Bank Reconciliation ───────────────────────────────────────────────────

  async exportBankReconciliation(
    tenantId: string,
    accountId: string,
    asOf?: string,
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);

    const account = await this.prisma.account.findFirst({
      where: { id: accountId, tenantId },
    });
    if (!account) throw new Error('Account not found');

    const cutoff = asOf ? new Date(asOf) : new Date();

    const recon = await this.prisma.bankReconciliation.findFirst({
      where: { tenantId, accountId, periodEnd: { lte: cutoff } },
      orderBy: { periodEnd: 'desc' },
      include: { items: true },
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Bank Reconciliation', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF2AA198' };

    writeReportHeader(
      ws,
      name,
      `Bank Reconciliation — ${account.code} ${account.name}`,
      `As of ${cutoff.toISOString().slice(0, 10)}   |   Generated: ${new Date().toLocaleString()}`,
      5,
    );

    ws.columns = [
      { key: 'date',       header: 'Date',         width: 14, style: { numFmt: DATE_FMT } },
      { key: 'itemType',   header: 'Type',         width: 14 },
      { key: 'desc',       header: 'Description',  width: 40 },
      { key: 'amount',     header: 'Amount',       width: 16, style: { numFmt: PESO_FMT } },
      { key: 'matched',    header: 'Matched',      width: 12 },
    ];

    applyHeaderStyle(ws.getRow(4));

    if (!recon) {
      ws.addRow({ date: '', itemType: '', desc: 'No reconciliation found for this account as of the given date.', amount: null, matched: '' });
      autoWidth(ws);
      return Buffer.from(await wb.xlsx.writeBuffer());
    }

    // Metadata
    const meta1 = ws.addRow({ date: '', itemType: 'PERIOD', desc: `${recon.periodStart.toISOString().slice(0, 10)} – ${recon.periodEnd.toISOString().slice(0, 10)}`, amount: null, matched: '' });
    meta1.font = { bold: true };
    const meta2 = ws.addRow({ date: '', itemType: 'BANK BAL', desc: 'Closing balance per bank statement', amount: Number(recon.bankBalance), matched: '' });
    meta2.font = { bold: true };
    const meta3 = ws.addRow({ date: '', itemType: 'GL BAL', desc: 'Closing balance per GL', amount: Number(recon.glBalance), matched: '' });
    meta3.font = { bold: true };
    ws.addRow([]);

    // Matched section
    const matchedHdr = ws.addRow({ date: '', itemType: 'MATCHED', desc: '— Matched Items —', amount: null, matched: '' });
    matchedHdr.font = { bold: true, color: { argb: 'FF2AA198' } };
    const matched = recon.items.filter((i) => i.isMatched);
    matched.forEach((i, idx) => {
      applyAlternatingFill(
        ws.addRow({
          date:     i.statementDate ?? '',
          itemType: i.itemType,
          desc:     i.statementDesc ?? i.notes ?? '',
          amount:   i.statementAmount ? Number(i.statementAmount) : null,
          matched:  'Yes',
        }),
        idx,
      );
    });

    ws.addRow([]);

    // Unmatched section
    const unmatchedHdr = ws.addRow({ date: '', itemType: 'UNMATCHED', desc: '— Unmatched Items —', amount: null, matched: '' });
    unmatchedHdr.font = { bold: true, color: { argb: 'FFDC322F' } };
    const unmatched = recon.items.filter((i) => !i.isMatched);
    unmatched.forEach((i, idx) => {
      applyAlternatingFill(
        ws.addRow({
          date:     i.statementDate ?? '',
          itemType: i.itemType,
          desc:     i.statementDesc ?? i.notes ?? '',
          amount:   i.statementAmount ? Number(i.statementAmount) : null,
          matched:  'No',
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Settlement Batches ────────────────────────────────────────────────────

  async exportSettlementBatches(
    tenantId: string,
    opts: { from?: string; to?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);

    const where: any = { tenantId };
    if (opts.from || opts.to) {
      where.periodStart = {};
      if (opts.from) where.periodStart.gte = new Date(opts.from);
      if (opts.to)   where.periodStart.lte = new Date(opts.to);
    }

    const batches = await this.prisma.settlementBatch.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      take: 10_000,
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Settlement Batches', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF6C71C4' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'Settlement Batches', `${range}   |   Generated: ${new Date().toLocaleString()}`, 6);

    ws.columns = [
      { key: 'batchNumber', header: 'Batch Ref',   width: 22 },
      { key: 'batchDate',   header: 'Period Start', width: 16, style: { numFmt: DATE_FMT } },
      { key: 'method',      header: 'Method',       width: 18 },
      { key: 'totalAmount', header: 'Expected',     width: 16, style: { numFmt: PESO_FMT } },
      { key: 'status',      header: 'Status',       width: 14 },
      { key: 'confirmedAt', header: 'Settled At',   width: 18 },
    ];

    applyHeaderStyle(ws.getRow(4));

    batches.forEach((b, idx) => {
      applyAlternatingFill(
        ws.addRow({
          batchNumber: b.referenceNumber ?? b.id,
          batchDate:   b.periodStart,
          method:      b.method,
          totalAmount: Number(b.expectedAmount),
          status:      b.status,
          confirmedAt: b.settledAt ? b.settledAt.toISOString().slice(0, 16).replace('T', ' ') : '',
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Cash Position ─────────────────────────────────────────────────────────

  async exportCashPosition(tenantId: string, asOf?: string): Promise<Buffer> {
    const name = await this.tenantName(tenantId);
    const cutoff = asOf ? new Date(asOf) : new Date();
    cutoff.setHours(23, 59, 59, 999);

    // Cash accounts: type=ASSET + code starts with "10"
    const accounts = await this.prisma.account.findMany({
      where: {
        tenantId,
        isActive: true,
        type: 'ASSET',
        code: { startsWith: '10' },
      },
      orderBy: { code: 'asc' },
      include: {
        journalLines: {
          where: {
            journalEntry: {
              tenantId,
              status: 'POSTED',
              OR: [
                { postingDate: { lte: cutoff } },
                { postingDate: null, date: { lte: cutoff } },
              ],
            },
          },
          select: { debit: true, credit: true },
        },
      },
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Cash Position', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF2AA198' };

    writeReportHeader(
      ws,
      name,
      'Cash Position',
      `As of ${cutoff.toISOString().slice(0, 10)}   |   Generated: ${new Date().toLocaleString()}`,
      3,
    );

    ws.columns = [
      { key: 'code',   header: 'Code',    width: 10 },
      { key: 'name',   header: 'Account', width: 44 },
      { key: 'amount', header: 'Balance', width: 20, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    let total = 0;
    accounts.forEach((a, idx) => {
      const debit  = a.journalLines.reduce((s, l) => s + Number(l.debit),  0);
      const credit = a.journalLines.reduce((s, l) => s + Number(l.credit), 0);
      const balance = a.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
      total += balance;
      applyAlternatingFill(
        ws.addRow({ code: a.code, name: a.name, amount: balance }),
        idx,
      );
    });

    const totRow = ws.addRow({ code: '', name: 'TOTAL CASH', amount: total });
    totRow.font   = { bold: true, size: 12 };
    totRow.border = { top: { style: 'medium' }, bottom: { style: 'double' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── BIR 2550Q (Quarterly VAT) ────────────────────────────────────────────

  async exportBir2550Q(tenantId: string, year: number, quarter: 1 | 2 | 3 | 4): Promise<Buffer> {
    const [name, data] = await Promise.all([
      this.tenantName(tenantId),
      this.bir.get2550QData(tenantId, year, quarter),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('BIR 2550Q', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF8B5E3C' };

    writeReportHeader(
      ws,
      name,
      `BIR 2550Q — Q${quarter} ${year}`,
      `${data.periodFrom} – ${data.periodTo}   |   Generated: ${new Date().toLocaleString()}`,
      3,
    );

    ws.columns = [
      { key: 'code',   header: 'Code',    width: 14 },
      { key: 'name',   header: 'Item',    width: 50 },
      { key: 'amount', header: 'Amount',  width: 20, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    const sec = (title: string, color: string) => {
      const r = ws.addRow({ code: '', name: title, amount: null });
      r.font = { bold: true, color: { argb: color } };
    };

    sec('OUTPUT VAT', 'FFDC322F');
    const out = data.accountingRows.find((r) => r.accountCode === '2020');
    if (out) {
      ws.addRow({ code: out.accountCode, name: out.accountName, amount: out.balance });
    }
    ws.addRow({ code: '', name: 'Total Output VAT', amount: data.outputVat }).font = { bold: true };
    ws.addRow([]);

    sec('INPUT VAT', 'FF2AA198');
    const inp = data.accountingRows.find((r) => r.accountCode === '1040');
    if (inp) {
      ws.addRow({ code: inp.accountCode, name: inp.accountName, amount: inp.balance });
    }
    ws.addRow({ code: '', name: 'Total Input VAT', amount: data.inputVat }).font = { bold: true };
    ws.addRow([]);

    const net = ws.addRow({ code: '', name: 'NET VAT PAYABLE', amount: data.netVatPayable });
    net.font   = { bold: true, size: 12 };
    net.border = { top: { style: 'medium' }, bottom: { style: 'double' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── BIR 1701Q (Quarterly Income Tax) ─────────────────────────────────────

  async exportBir1701Q(tenantId: string, year: number, quarter: 1 | 2 | 3 | 4): Promise<Buffer> {
    const [name, data] = await Promise.all([
      this.tenantName(tenantId),
      this.bir.get1701QData(tenantId, year, quarter),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('BIR 1701Q', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF8B5E3C' };

    writeReportHeader(
      ws,
      name,
      `BIR 1701Q — Q${quarter} ${year}`,
      `${data.periodFrom} – ${data.periodTo}   |   Generated: ${new Date().toLocaleString()}`,
      3,
    );

    ws.columns = [
      { key: 'code',   header: 'Code',    width: 14 },
      { key: 'name',   header: 'Item',    width: 50 },
      { key: 'amount', header: 'Amount',  width: 20, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    const revHdr = ws.addRow({ code: '', name: 'TAXABLE INCOME — Revenue', amount: null });
    revHdr.font = { bold: true, color: { argb: 'FF268BD2' } };
    data.revenueLines.forEach((r, idx) => {
      applyAlternatingFill(ws.addRow({ code: r.code, name: r.name, amount: r.balance }), idx);
    });
    ws.addRow({ code: '', name: 'Gross Revenue', amount: data.grossRevenue }).font = { bold: true };
    ws.addRow([]);

    const expHdr = ws.addRow({ code: '', name: 'LESS: Allowable Expenses', amount: null });
    expHdr.font = { bold: true, color: { argb: 'FFDC322F' } };
    data.expenseLines.forEach((r, idx) => {
      applyAlternatingFill(ws.addRow({ code: r.code, name: r.name, amount: r.balance }), idx);
    });
    ws.addRow({ code: '', name: 'Total Expenses', amount: data.totalExpenses }).font = { bold: true };
    ws.addRow([]);

    const ni = ws.addRow({ code: '', name: 'NET TAXABLE INCOME (Income Tax Due basis)', amount: data.netIncome });
    ni.font   = { bold: true, size: 12 };
    ni.border = { top: { style: 'medium' }, bottom: { style: 'double' } };
    ni.getCell('amount').font = {
      bold: true,
      size: 12,
      color: { argb: data.netIncome >= 0 ? 'FF268BD2' : 'FFDC322F' },
    };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── BIR 2551Q (Quarterly Percentage Tax) ─────────────────────────────────

  async exportBir2551Q(tenantId: string, year: number, quarter: 1 | 2 | 3 | 4): Promise<Buffer> {
    const [name, data] = await Promise.all([
      this.tenantName(tenantId),
      this.bir.get2551QData(tenantId, year, quarter),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('BIR 2551Q', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF8B5E3C' };

    writeReportHeader(
      ws,
      name,
      `BIR 2551Q — Q${quarter} ${year}`,
      `${data.periodFrom} – ${data.periodTo}   |   Generated: ${new Date().toLocaleString()}`,
      3,
    );

    ws.columns = [
      { key: 'code',   header: 'Code',    width: 14 },
      { key: 'name',   header: 'Item',    width: 50 },
      { key: 'amount', header: 'Amount',  width: 20, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    const grHdr = ws.addRow({ code: '', name: 'GROSS RECEIPTS', amount: null });
    grHdr.font = { bold: true, color: { argb: 'FF268BD2' } };
    data.revenueLines.forEach((r, idx) => {
      applyAlternatingFill(ws.addRow({ code: r.code, name: r.name, amount: r.balance }), idx);
    });
    ws.addRow({ code: '', name: 'Total Gross Receipts', amount: data.grossReceipts }).font = { bold: true };
    ws.addRow([]);

    const rateRow = ws.addRow({ code: '', name: `Percentage Tax Rate (${(data.percentageTaxRate * 100).toFixed(1)}%)`, amount: null });
    rateRow.font = { italic: true };

    const tax = ws.addRow({ code: '', name: 'PERCENTAGE TAX DUE', amount: data.percentageTaxAmount });
    tax.font   = { bold: true, size: 12 };
    tax.border = { top: { style: 'medium' }, bottom: { style: 'double' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Z-Read History ───────────────────────────────────────────────────────

  async exportZReadHistory(
    tenantId: string,
    opts: { from?: string; to?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);

    const where: any = { tenantId };
    if (opts.from || opts.to) {
      where.date = {};
      if (opts.from) where.date.gte = new Date(opts.from);
      if (opts.to)   where.date.lte = new Date(opts.to);
    }

    const zReads = await this.prisma.zReadLog.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 10_000,
    });

    const branchIds = [...new Set(zReads.map((z) => z.branchId))];
    const userIds   = [...new Set(zReads.map((z) => z.generatedById).filter((id): id is string => !!id))];
    const [branches, users] = await Promise.all([
      this.prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    ]);
    const branchMap = new Map(branches.map((b) => [b.id, b.name]));
    const userMap   = new Map(users.map((u) => [u.id, u.name || u.email]));

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Z-Read History', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF8B5E3C' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'Z-Read History', `${range}   |   Generated: ${new Date().toLocaleString()}`, 10);

    ws.columns = [
      { key: 'businessDate', header: 'Business Date', width: 14, style: { numFmt: DATE_FMT } },
      { key: 'branchName',   header: 'Branch',        width: 24 },
      { key: 'totalOrders',  header: 'Orders',        width: 10 },
      { key: 'voidCount',    header: 'Voids',         width: 10 },
      { key: 'grossSales',   header: 'Gross Sales',   width: 16, style: { numFmt: PESO_FMT } },
      { key: 'netSales',     header: 'Net Sales',     width: 16, style: { numFmt: PESO_FMT } },
      { key: 'vatAmount',    header: 'VAT',           width: 14, style: { numFmt: PESO_FMT } },
      { key: 'cashAmount',   header: 'Cash',          width: 14, style: { numFmt: PESO_FMT } },
      { key: 'nonCash',      header: 'Non-Cash',      width: 14, style: { numFmt: PESO_FMT } },
      { key: 'generatedBy',  header: 'Generated By',  width: 24 },
    ];

    applyHeaderStyle(ws.getRow(4));

    zReads.forEach((z, idx) => {
      applyAlternatingFill(
        ws.addRow({
          businessDate: z.date,
          branchName:   branchMap.get(z.branchId) ?? z.branchId,
          totalOrders:  z.totalOrders,
          voidCount:    z.voidCount,
          grossSales:   Number(z.grossSales),
          netSales:     Number(z.netSales),
          vatAmount:    Number(z.vatAmount),
          cashAmount:   Number(z.cashAmount),
          nonCash:      Number(z.nonCashAmount),
          generatedBy:  z.generatedById ? (userMap.get(z.generatedById) ?? 'System') : 'System',
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Audit Log ────────────────────────────────────────────────────────────

  async exportAuditLog(
    tenantId: string,
    opts: { from?: string; to?: string; action?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);

    // AuditService.findAll() supports action filter but not date range; paginate
    // and filter by date in memory.
    const all: any[] = [];
    let page = 1;
    while (all.length < 10_000) {
      const res = await this.audit.findAll(tenantId, {
        page,
        action: opts.action as AuditAction | undefined,
      });
      all.push(...res.data);
      if (page >= res.pages) break;
      page++;
    }

    const fromTs = opts.from ? new Date(opts.from).getTime() : null;
    const toTs   = opts.to   ? new Date(opts.to).getTime()   : null;
    const filtered = all.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      if (fromTs !== null && t < fromTs) return false;
      if (toTs   !== null && t > toTs)   return false;
      return true;
    });

    // Resolve user emails for performedBy ids that look like uuids
    const performerIds = [...new Set(
      filtered.map((r) => r.performedBy).filter((p): p is string => typeof p === 'string' && p.length > 20 && !p.includes('@')),
    )];
    const performers = performerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: performerIds } }, select: { id: true, email: true } })
      : [];
    const performerMap = new Map(performers.map((u) => [u.id, u.email]));

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Audit Log', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FFDC322F' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'Audit Log', `${range}   |   Generated: ${new Date().toLocaleString()}`, 7);

    ws.columns = [
      { key: 'createdAt',   header: 'Timestamp',   width: 20 },
      { key: 'action',      header: 'Action',      width: 24 },
      { key: 'entityType',  header: 'Entity Type', width: 18 },
      { key: 'entityId',    header: 'Entity ID',   width: 28 },
      { key: 'performedBy', header: 'Performed By', width: 28 },
      { key: 'ipAddress',   header: 'IP',          width: 18 },
      { key: 'description', header: 'Description', width: 48 },
    ];

    applyHeaderStyle(ws.getRow(4));

    filtered.forEach((r, idx) => {
      const perfRaw = r.performedBy ?? '';
      const perf = performerMap.get(perfRaw) ?? perfRaw;
      applyAlternatingFill(
        ws.addRow({
          createdAt:   new Date(r.createdAt).toISOString().slice(0, 19).replace('T', ' '),
          action:      r.action,
          entityType:  r.entityType,
          entityId:    r.entityId,
          performedBy: perf,
          ipAddress:   r.ipAddress ?? '',
          description: r.description ?? '',
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Accounting Events ────────────────────────────────────────────────────

  async exportAccountingEvents(
    tenantId: string,
    opts: { from?: string; to?: string; status?: string },
  ): Promise<Buffer> {
    const name = await this.tenantName(tenantId);

    const where: any = { tenantId };
    if (opts.status) where.status = opts.status;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = new Date(opts.from);
      if (opts.to)   where.createdAt.lte = new Date(opts.to);
    }

    const events = await this.prisma.accountingEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10_000,
      include: { order: { select: { orderNumber: true } } },
    });

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Accounting Events', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF6C71C4' };

    const range = [opts.from, opts.to].filter(Boolean).join(' – ') || 'All dates';
    writeReportHeader(ws, name, 'Accounting Events', `${range}   |   Generated: ${new Date().toLocaleString()}`, 7);

    ws.columns = [
      { key: 'createdAt',   header: 'Created',      width: 20 },
      { key: 'eventType',   header: 'Type',         width: 22 },
      { key: 'orderNumber', header: 'Order #',      width: 16 },
      { key: 'status',      header: 'Status',       width: 12 },
      { key: 'retryCount',  header: 'Retries',      width: 10 },
      { key: 'lastError',   header: 'Last Error',   width: 40 },
      { key: 'syncedAt',    header: 'Synced At',    width: 20 },
    ];

    applyHeaderStyle(ws.getRow(4));

    events.forEach((e, idx) => {
      applyAlternatingFill(
        ws.addRow({
          createdAt:   e.createdAt.toISOString().slice(0, 19).replace('T', ' '),
          eventType:   e.type,
          orderNumber: e.order?.orderNumber ?? '',
          status:      e.status,
          retryCount:  e.retryCount,
          lastError:   e.lastError ?? '',
          syncedAt:    e.syncedAt ? e.syncedAt.toISOString().slice(0, 19).replace('T', ' ') : '',
        }),
        idx,
      );
    });

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Period Close Summary ─────────────────────────────────────────────────

  async exportPeriodCloseSummary(tenantId: string, periodId: string): Promise<Buffer> {
    const name = await this.tenantName(tenantId);

    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, tenantId },
    });
    if (!period) throw new Error('Period not found');

    const [closedBy, reopenedBy, tb] = await Promise.all([
      period.closedById   ? this.prisma.user.findUnique({ where: { id: period.closedById   }, select: { name: true, email: true } }) : Promise.resolve(null),
      period.reopenedById ? this.prisma.user.findUnique({ where: { id: period.reopenedById }, select: { name: true, email: true } }) : Promise.resolve(null),
      this.accounts.getTrialBalance(tenantId, period.endDate.toISOString().slice(0, 10)),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Period Close Summary', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF2AA198' };

    writeReportHeader(
      ws,
      name,
      `Period Close — ${period.name}`,
      `${period.startDate.toISOString().slice(0, 10)} – ${period.endDate.toISOString().slice(0, 10)}   |   Generated: ${new Date().toLocaleString()}`,
      5,
    );

    ws.columns = [
      { key: 'code',   header: 'Code',    width: 10 },
      { key: 'name',   header: 'Account', width: 40 },
      { key: 'type',   header: 'Type',    width: 14 },
      { key: 'debit',  header: 'Debit',   width: 16, style: { numFmt: PESO_FMT } },
      { key: 'credit', header: 'Credit',  width: 16, style: { numFmt: PESO_FMT } },
    ];

    applyHeaderStyle(ws.getRow(4));

    // Metadata section
    const metaHdr = ws.addRow({ code: '', name: 'PERIOD METADATA', type: '', debit: null, credit: null });
    metaHdr.font = { bold: true, color: { argb: 'FF2AA198' } };

    const addMeta = (k: string, v: string) => {
      ws.addRow({ code: '', name: k, type: v, debit: null, credit: null });
    };
    addMeta('Status',         period.status);
    addMeta('Closed At',      period.closedAt   ? period.closedAt.toISOString().slice(0, 19).replace('T', ' ') : '—');
    addMeta('Closed By',      closedBy ? (closedBy.name || closedBy.email) : '—');
    addMeta('Reopened At',    period.reopenedAt ? period.reopenedAt.toISOString().slice(0, 19).replace('T', ' ') : '—');
    addMeta('Reopened By',    reopenedBy ? (reopenedBy.name || reopenedBy.email) : '—');
    addMeta('Reopen Count',   String(period.reopenCount));
    addMeta('Reopen Reason',  period.reopenReason ?? '—');
    ws.addRow([]);

    // Period-end balances
    const balHdr = ws.addRow({ code: '', name: 'PERIOD-END BALANCES (Trial Balance as of period end)', type: '', debit: null, credit: null });
    balHdr.font = { bold: true, color: { argb: 'FF2AA198' } };

    tb.rows.forEach((r, idx) => {
      applyAlternatingFill(
        ws.addRow({
          code:   r.code,
          name:   r.name,
          type:   r.type,
          debit:  r.debit,
          credit: r.credit,
        }),
        idx,
      );
    });

    const tot = ws.addRow({
      code:   '',
      name:   'TOTAL',
      type:   '',
      debit:  tb.totalDebits,
      credit: tb.totalCredits,
    });
    tot.font   = { bold: true };
    tot.border = { top: { style: 'thin' } };

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Ledger KPI Snapshot ──────────────────────────────────────────────────

  async exportLedgerKpiSnapshot(tenantId: string, _asOf?: string): Promise<Buffer> {
    const [name, metrics] = await Promise.all([
      this.tenantName(tenantId),
      this.ledgerMetrics.getProcessMetrics(tenantId),
    ]);

    const wb = buildWorkbook();
    const ws = wb.addWorksheet('Ledger KPI', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.properties.tabColor = { argb: 'FF268BD2' };

    writeReportHeader(
      ws,
      name,
      'Ledger KPI Snapshot',
      `Generated at ${new Date(metrics.generatedAt).toLocaleString()}`,
      3,
    );

    ws.columns = [
      { key: 'category', header: 'Category', width: 16 },
      { key: 'metric',   header: 'Metric',   width: 40 },
      { key: 'value',    header: 'Value',    width: 24 },
    ];

    applyHeaderStyle(ws.getRow(4));

    const writeKpi = (cat: string, metric: string, value: string | number) => {
      ws.addRow({ category: cat, metric, value });
    };
    const writeSec = (cat: string) => {
      const r = ws.addRow({ category: cat, metric: '', value: '' });
      r.font = { bold: true, color: { argb: 'FF268BD2' } };
    };

    writeSec('TIMELINESS');
    writeKpi('Timeliness', 'Avg Event Lag (ms)',         metrics.timeliness.avgEventLagMs);
    writeKpi('Timeliness', 'Pending Events',             metrics.timeliness.pendingEvents);
    writeKpi('Timeliness', 'Failed Events',              metrics.timeliness.failedEvents);
    writeKpi('Timeliness', 'DSO (days)',                 metrics.timeliness.daysSalesOutstanding);
    writeKpi('Timeliness', 'DPO (days)',                 metrics.timeliness.daysPayableOutstanding);
    writeKpi('Timeliness', 'Days Since Last Close',      metrics.timeliness.daysSinceLastClose ?? '—');
    ws.addRow([]);

    writeSec('ACCURACY');
    writeKpi('Accuracy', 'TB Variance',                  metrics.accuracy.tbVariance);
    writeKpi('Accuracy', 'TB Total Debits',              metrics.accuracy.tbTotalDebits);
    writeKpi('Accuracy', 'TB Total Credits',             metrics.accuracy.tbTotalCredits);
    writeKpi('Accuracy', 'Is Balanced',                  metrics.accuracy.isBalanced ? 'Yes' : 'No');
    writeKpi('Accuracy', 'Voids (last 30d)',             metrics.accuracy.voidsLast30d);
    writeKpi('Accuracy', 'Void Rate (last 30d)',         `${(metrics.accuracy.voidRateLast30d * 100).toFixed(2)}%`);
    writeKpi('Accuracy', 'Period Reopens (last 90d)',    metrics.accuracy.reopensLast90d);
    ws.addRow([]);

    writeSec('VOLUME');
    writeKpi('Volume', 'JEs Today',                      metrics.volume.jesToday);
    writeKpi('Volume', 'JEs This Month',                 metrics.volume.jesThisMonth);
    writeKpi('Volume', 'Events Processed (24h)',         metrics.volume.eventsProcessedLast24h);
    writeKpi('Volume', 'Open AR Invoices',               metrics.volume.openArInvoices);
    writeKpi('Volume', 'Open AR Value',                  metrics.volume.openArValue);
    writeKpi('Volume', 'Open AP Bills',                  metrics.volume.openApBills);
    writeKpi('Volume', 'Open AP Value (net of WHT)',     metrics.volume.openApValue);
    ws.addRow([]);

    writeSec('CONTROL');
    writeKpi('Control', 'Pending Expense Claims',        metrics.control.pendingExpenseClaims);
    writeKpi('Control', 'SOD Overrides (last 30d)',      metrics.control.sodOverridesLast30d);
    writeKpi('Control', 'Products Missing Cost',         metrics.control.productsMissingCost);
    writeKpi('Control', 'Audit Entries (24h)',           metrics.control.auditEntriesLast24h);
    writeKpi('Control', 'Offline Syncs (24h)',           metrics.control.offlineSyncsLast24h);

    autoWidth(ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
