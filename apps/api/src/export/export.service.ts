import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounting/accounts.service';
import { JournalService } from '../accounting/journal.service';
import { ExpensesService } from '../ap/expenses.service';
import { ArService } from '../ar/ar.service';
import { PayrollService } from '../payroll/payroll.service';

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

    const where: any = { tenantId, status: 'COMPLETED' };
    if (from) where.completedAt = { ...where.completedAt, gte: new Date(`${from}T00:00:00+08:00`) };
    if (to)   where.completedAt = { ...where.completedAt, lte: new Date(`${to}T23:59:59.999+08:00`) };

    const orders = await this.prisma.order.findMany({
      where,
      include: { payments: true },
      orderBy: { completedAt: 'asc' },
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
}
