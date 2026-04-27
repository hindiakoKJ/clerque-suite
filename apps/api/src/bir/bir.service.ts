import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import ExcelJS from 'exceljs';

// ── BIR form result types ────────────────────────────────────────────────────

export interface Bir2550QResult {
  year:        number;
  quarter:     1 | 2 | 3 | 4;
  periodFrom:  string; // ISO date
  periodTo:    string; // ISO date
  /** Total output VAT (credit balance on acct 2020) */
  outputVat:   number;
  /** Total input VAT (debit balance on acct 1040) */
  inputVat:    number;
  /** Net VAT payable (outputVat - inputVat) */
  netVatPayable: number;
  accountingRows: {
    accountCode: string;
    accountName: string;
    debit:       number;
    credit:      number;
    balance:     number;
  }[];
}

export interface Bir1701QResult {
  year:          number;
  quarter:       1 | 2 | 3 | 4;
  periodFrom:    string;
  periodTo:      string;
  grossRevenue:  number;
  totalExpenses: number;
  netIncome:     number;
  revenueLines: { code: string; name: string; balance: number }[];
  expenseLines: { code: string; name: string; balance: number }[];
}

export interface EisLineItem {
  productName:  string;
  quantity:     number;
  unitPrice:    number;
  vatExclusive: number;
  vatAmount:    number;
  lineTotal:    number;
}

export interface EisInvoiceJson {
  invoiceNumber:     string;
  invoiceDate:       string;    // ISO 8601
  sellerTin:         string | null;
  sellerName:        string;
  sellerAddress:     string | null;
  buyerTin:          null;      // walk-in; no buyer TIN captured at POS
  buyerName:         string | null;
  lineItems:         EisLineItem[];
  totalVatExclusive: number;
  vatAmount:         number;
  totalAmount:       number;
  discountAmount:    number;
  transactionType:   'SALES_INVOICE' | 'OFFICIAL_RECEIPT';
  currency:          'PHP';
  generatedAt:       string;    // ISO 8601 timestamp
}

// ── Quarter helpers ──────────────────────────────────────────────────────────

function quarterBounds(year: number, quarter: 1 | 2 | 3 | 4): { from: Date; to: Date } {
  const starts = [0, 3, 6, 9];
  const from   = new Date(year, starts[quarter - 1]!, 1);
  const to     = new Date(year, starts[quarter - 1]! + 3, 0, 23, 59, 59, 999); // last ms of last month
  return { from, to };
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── BirService ───────────────────────────────────────────────────────────────

@Injectable()
export class BirService {
  constructor(private prisma: PrismaService) {}

  /** Verify tenant has BIR registration; throw 403 otherwise. */
  private async assertBirRegistered(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { isBirRegistered: true },
    });
    if (!tenant?.isBirRegistered) {
      throw new ForbiddenException(
        'BIR features require a registered business account. Enable BIR registration in tenant settings.',
      );
    }
  }

  // ── 2550Q — Quarterly VAT Return ──────────────────────────────────────────

  async get2550QData(
    tenantId: string,
    year:    number,
    quarter: 1 | 2 | 3 | 4,
  ): Promise<Bir2550QResult> {
    await this.assertBirRegistered(tenantId);

    const { from, to } = quarterBounds(year, quarter);

    // Pull the two VAT accounts: 1040 Input VAT, 2020 Output VAT Payable
    const vatAccounts = await this.prisma.account.findMany({
      where: {
        tenantId,
        code: { in: ['1040', '2020'] },
      },
      include: {
        journalLines: {
          where: {
            journalEntry: {
              tenantId,
              status: 'POSTED',
              OR: [
                { postingDate: { gte: from, lte: to } },
                { postingDate: null, date: { gte: from, lte: to } },
              ],
            },
          },
          select: { debit: true, credit: true },
        },
      },
    });

    const accountingRows = vatAccounts.map((acct) => {
      const debit  = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
      const credit = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
      const balance = acct.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
      return { accountCode: acct.code, accountName: acct.name, debit, credit, balance };
    });

    const input  = accountingRows.find((r) => r.accountCode === '1040');
    const output = accountingRows.find((r) => r.accountCode === '2020');

    const inputVat    = input?.balance  ?? 0;
    const outputVat   = output?.balance ?? 0;
    const netVatPayable = outputVat - inputVat;

    return {
      year,
      quarter,
      periodFrom:  toIso(from),
      periodTo:    toIso(to),
      outputVat,
      inputVat,
      netVatPayable,
      accountingRows,
    };
  }

  // ── 1701Q — Quarterly Income Tax Return ───────────────────────────────────

  async get1701QData(
    tenantId: string,
    year:    number,
    quarter: 1 | 2 | 3 | 4,
  ): Promise<Bir1701QResult> {
    await this.assertBirRegistered(tenantId);

    const { from, to } = quarterBounds(year, quarter);

    const plAccounts = await this.prisma.account.findMany({
      where: {
        tenantId,
        isActive: true,
        type: { in: ['REVENUE', 'EXPENSE'] },
      },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: {
        journalLines: {
          where: {
            journalEntry: {
              tenantId,
              status: 'POSTED',
              OR: [
                { postingDate: { gte: from, lte: to } },
                { postingDate: null, date: { gte: from, lte: to } },
              ],
            },
          },
          select: { debit: true, credit: true },
        },
      },
    });

    let grossRevenue  = 0;
    let totalExpenses = 0;
    const revenueLines: Bir1701QResult['revenueLines'] = [];
    const expenseLines: Bir1701QResult['expenseLines'] = [];

    for (const acct of plAccounts) {
      const debit   = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
      const credit  = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
      const balance = acct.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
      if (acct.type === 'REVENUE') {
        grossRevenue += balance;
        revenueLines.push({ code: acct.code, name: acct.name, balance });
      } else {
        totalExpenses += balance;
        expenseLines.push({ code: acct.code, name: acct.name, balance });
      }
    }

    return {
      year,
      quarter,
      periodFrom:  toIso(from),
      periodTo:    toIso(to),
      grossRevenue,
      totalExpenses,
      netIncome: grossRevenue - totalExpenses,
      revenueLines,
      expenseLines,
    };
  }

  // ── 2551Q — Quarterly Percentage Tax (for NON_VAT-registered tenants) ───────
  //
  // BIR Form 2551Q: 3% Percentage Tax on gross receipts for non-VAT businesses.
  // Only applicable when taxStatus = NON_VAT (BIR-registered, not VAT-registered).

  async get2551QData(
    tenantId: string,
    year:    number,
    quarter: 1 | 2 | 3 | 4,
  ) {
    await this.assertBirRegistered(tenantId);

    const { from, to } = quarterBounds(year, quarter);

    // Gross receipts = total net sales for the period (from REVENUE accounts)
    const revenueAccounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true, type: 'REVENUE' },
      include: {
        journalLines: {
          where: {
            journalEntry: {
              tenantId,
              status: 'POSTED',
              OR: [
                { postingDate: { gte: from, lte: to } },
                { postingDate: null, date: { gte: from, lte: to } },
              ],
            },
          },
          select: { debit: true, credit: true },
        },
      },
    });

    let grossReceipts = 0;
    for (const acct of revenueAccounts) {
      const debit  = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
      const credit = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
      const balance = acct.normalBalance === 'CREDIT' ? credit - debit : debit - credit;
      if (balance > 0) grossReceipts += balance;
    }

    const percentageTaxRate   = 0.03;    // 3% BIR Percentage Tax
    const percentageTaxAmount = Math.round(grossReceipts * percentageTaxRate * 100) / 100;

    return {
      year,
      quarter,
      periodFrom:  toIso(from),
      periodTo:    toIso(to),
      grossReceipts,
      percentageTaxRate,
      percentageTaxAmount,
      /**
       * NOTE: This is a computed estimate from journal entries.
       * Actual OSD (Optional Standard Deduction) or allowable deductions may reduce the tax base.
       * Always verify with your accountant before filing.
       */
      revenueLines: revenueAccounts
        .map((acct) => {
          const debit   = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
          const credit  = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
          const balance = acct.normalBalance === 'CREDIT' ? credit - debit : debit - credit;
          return { code: acct.code, name: acct.name, balance: Math.max(0, balance) };
        })
        .filter((r) => r.balance > 0)
        .sort((a, b) => a.code.localeCompare(b.code)),
    };
  }

  // ── OR Sequential Numbering ───────────────────────────────────────────────

  /** Get-or-create the OR sequence for a tenant, then increment and return the next formatted number. */
  async nextOrNumber(tenantId: string): Promise<string> {
    // Ensure the row exists first (no-op if already present).
    await this.prisma.orSequence.upsert({
      where:  { tenantId },
      create: { tenantId, prefix: 'OR', lastNumber: 0, padLength: 8 },
      update: {},
    });
    // Atomic increment — Prisma issues a single UPDATE … RETURNING so no race condition.
    const seq = await this.prisma.orSequence.update({
      where: { tenantId },
      data:  { lastNumber: { increment: 1 } },
    });
    const padded = String(seq.lastNumber).padStart(seq.padLength, '0');
    return `${seq.prefix}-${padded}`; // e.g. "OR-00000001"
  }

  /** Return current sequence info without incrementing (for settings display). */
  async getOrSequence(tenantId: string) {
    return this.prisma.orSequence.upsert({
      where:  { tenantId },
      create: { tenantId, prefix: 'OR', lastNumber: 0, padLength: 8 },
      update: {},
    });
  }

  /** Update OR prefix / pad length (BUSINESS_OWNER only). */
  async updateOrSequence(tenantId: string, prefix: string, padLength: number) {
    return this.prisma.orSequence.upsert({
      where:  { tenantId },
      create: { tenantId, prefix, padLength, lastNumber: 0 },
      update: { prefix, padLength },
    });
  }

  // ── EWT — Expanded Withholding Tax (Form 2307) ────────────────────────────

  /**
   * Generate BIR Form 2307 data — EWT summary per vendor for a period.
   * Pulls from ExpenseEntry records with whtAmount > 0.
   */
  async getEwtData(tenantId: string, year: number, quarter: 1 | 2 | 3 | 4) {
    await this.assertBirRegistered(tenantId);
    const { from, to } = quarterBounds(year, quarter);

    const expenses = await this.prisma.expenseEntry.findMany({
      where: {
        tenantId,
        status: 'POSTED',
        expenseDate: { gte: from, lte: to },
        whtAmount: { gt: 0 },
      },
      include: { vendor: { select: { name: true, tin: true } } },
      orderBy: { expenseDate: 'asc' },
    });

    // Group by vendor
    const vendorMap = new Map<string, {
      vendorName: string; vendorTin: string | null;
      atcCode: string | null; totalGross: number; totalWht: number; entries: number;
    }>();

    for (const e of expenses) {
      const key = e.vendorId ?? `no-vendor-${e.atcCode}`;
      const existing = vendorMap.get(key);
      if (existing) {
        existing.totalGross += Number(e.grossAmount);
        existing.totalWht  += Number(e.whtAmount);
        existing.entries++;
      } else {
        vendorMap.set(key, {
          vendorName: e.vendor?.name ?? 'Unknown Vendor',
          vendorTin:  e.vendor?.tin ?? null,
          atcCode:    e.atcCode,
          totalGross: Number(e.grossAmount),
          totalWht:   Number(e.whtAmount),
          entries:    1,
        });
      }
    }

    return {
      year, quarter,
      periodFrom: toIso(from), periodTo: toIso(to),
      totalWhtAmount: expenses.reduce((s, e) => s + Number(e.whtAmount), 0),
      vendors: Array.from(vendorMap.values()),
    };
  }

  // ── SAWT — Summary Alphalist of Withholding Tax at Source ─────────────────

  /**
   * SAWT — Summary Alphalist of Withholding Tax at Source.
   * Required attachment to BIR income tax returns; lists all vendors from whom you withheld tax.
   */
  async getSawtData(tenantId: string, year: number, quarter: 1 | 2 | 3 | 4) {
    // SAWT is an expanded view of the EWT data — same source, different presentation
    return this.getEwtData(tenantId, year, quarter);
  }

  // ── Books of Account Exports (ExcelJS) ────────────────────────────────────

  /** Sales Book — all completed POS orders for a period, grouped by day */
  async exportSalesBook(tenantId: string, year: number, month: number): Promise<Buffer> {
    await this.assertBirRegistered(tenantId);

    const from = new Date(year, month - 1, 1);
    const to   = new Date(year, month, 0, 23, 59, 59, 999);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, tinNumber: true, businessName: true },
    });

    const orders = await this.prisma.order.findMany({
      where: { tenantId, status: 'COMPLETED', completedAt: { gte: from, lte: to } },
      include: { items: true, payments: true },
      orderBy: { completedAt: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    const ws = wb.addWorksheet('Sales Book', { views: [{ state: 'frozen', ySplit: 4 }] });

    const monthName = from.toLocaleString('en-PH', { month: 'long', year: 'numeric' });
    ws.mergeCells('A1:I1');
    ws.getCell('A1').value = `${tenant?.businessName ?? tenant?.name} — Sales Book — ${monthName}`;
    ws.getCell('A1').font  = { bold: true, size: 13 };
    ws.mergeCells('A2:I2');
    ws.getCell('A2').value = `TIN: ${tenant?.tinNumber ?? 'N/A'} | Generated: ${new Date().toLocaleString('en-PH')}`;
    ws.getCell('A2').font  = { size: 9, color: { argb: 'FF666666' } };

    ws.columns = [
      { header: 'Date',         key: 'date',        width: 12 },
      { header: 'OR/SI No.',    key: 'orNumber',     width: 16 },
      { header: 'Customer',     key: 'customer',     width: 24 },
      { header: 'Gross Sales',  key: 'grossSales',   width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'VAT-Exempt',   key: 'vatExempt',    width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'Zero-Rated',   key: 'zeroRated',    width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'Taxable Sales', key: 'taxable',     width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'Output VAT',   key: 'outputVat',    width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'Total Amount', key: 'totalAmount',  width: 14, style: { numFmt: '₱#,##0.00' } },
    ];

    // Style header row (row 4)
    const headerRow = ws.getRow(4);
    headerRow.font = { bold: true, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    let totalGross = 0, totalVat = 0, totalAmount = 0;
    orders.forEach((o, i) => {
      const gross  = Number(o.totalAmount) - Number(o.vatAmount);
      const vat    = Number(o.vatAmount);
      const total  = Number(o.totalAmount);
      totalGross  += gross; totalVat += vat; totalAmount += total;
      const row = ws.addRow({
        date:        (o.completedAt ?? o.createdAt).toLocaleDateString('en-PH'),
        orNumber:    o.orderNumber,
        customer:    'Walk-in',
        grossSales:  total,
        vatExempt:   0,
        zeroRated:   0,
        taxable:     gross,
        outputVat:   vat,
        totalAmount: total,
      });
      if (i % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
    });

    // Totals row
    const totalsRow = ws.addRow({
      date: 'TOTAL', orNumber: '', customer: '',
      grossSales: totalAmount, vatExempt: 0, zeroRated: 0,
      taxable: totalGross, outputVat: totalVat, totalAmount,
    });
    totalsRow.font = { bold: true };
    totalsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Purchase Book — all posted expense entries for a period */
  async exportPurchaseBook(tenantId: string, year: number, month: number): Promise<Buffer> {
    await this.assertBirRegistered(tenantId);

    const from = new Date(year, month - 1, 1);
    const to   = new Date(year, month, 0, 23, 59, 59, 999);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, tinNumber: true, businessName: true },
    });

    const expenses = await this.prisma.expenseEntry.findMany({
      where: { tenantId, status: 'POSTED', expenseDate: { gte: from, lte: to } },
      include: { vendor: { select: { name: true, tin: true } } },
      orderBy: { expenseDate: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    const monthName = from.toLocaleString('en-PH', { month: 'long', year: 'numeric' });
    const ws = wb.addWorksheet('Purchase Book', { views: [{ state: 'frozen', ySplit: 4 }] });

    ws.mergeCells('A1:H1');
    ws.getCell('A1').value = `${tenant?.businessName ?? tenant?.name} — Purchase Book — ${monthName}`;
    ws.getCell('A1').font  = { bold: true, size: 13 };

    ws.columns = [
      { header: 'Date',          key: 'date',      width: 12 },
      { header: 'Reference No.', key: 'ref',       width: 16 },
      { header: 'Vendor',        key: 'vendor',    width: 28 },
      { header: 'Vendor TIN',    key: 'vendorTin', width: 18 },
      { header: 'Gross Amount',  key: 'gross',     width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'Input VAT',     key: 'inputVat',  width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'WHT Amount',    key: 'wht',       width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'Net Amount',    key: 'net',       width: 14, style: { numFmt: '₱#,##0.00' } },
    ];

    const headerRow = ws.getRow(4);
    headerRow.font = { bold: true, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    let totGross = 0, totVat = 0, totWht = 0, totNet = 0;
    expenses.forEach((e, i) => {
      totGross += Number(e.grossAmount); totVat += Number(e.inputVat);
      totWht   += Number(e.whtAmount);  totNet  += Number(e.netAmount);
      const row = ws.addRow({
        date:      e.expenseDate.toLocaleDateString('en-PH'),
        ref:       e.referenceNumber ?? '',
        vendor:    e.vendor?.name ?? '',
        vendorTin: e.vendor?.tin ?? '',
        gross:     Number(e.grossAmount),
        inputVat:  Number(e.inputVat),
        wht:       Number(e.whtAmount),
        net:       Number(e.netAmount),
      });
      if (i % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
    });

    const totals = ws.addRow({ date: 'TOTAL', ref: '', vendor: '', vendorTin: '', gross: totGross, inputVat: totVat, wht: totWht, net: totNet });
    totals.font = { bold: true };
    totals.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Cash Disbursements Book — all payments made (expense entries with paidAt set) */
  async exportCashDisbursements(tenantId: string, year: number, month: number): Promise<Buffer> {
    await this.assertBirRegistered(tenantId);

    const from = new Date(year, month - 1, 1);
    const to   = new Date(year, month, 0, 23, 59, 59, 999);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, tinNumber: true, businessName: true },
    });

    const payments = await this.prisma.expenseEntry.findMany({
      where: { tenantId, paidAt: { gte: from, lte: to }, status: { in: ['POSTED'] } },
      include: { vendor: { select: { name: true, tin: true } } },
      orderBy: { paidAt: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    const monthName = from.toLocaleString('en-PH', { month: 'long', year: 'numeric' });
    const ws = wb.addWorksheet('Cash Disbursements', { views: [{ state: 'frozen', ySplit: 4 }] });

    ws.mergeCells('A1:G1');
    ws.getCell('A1').value = `${tenant?.businessName ?? tenant?.name} — Cash Disbursements Book — ${monthName}`;
    ws.getCell('A1').font  = { bold: true, size: 13 };

    ws.columns = [
      { header: 'Payment Date',  key: 'paidAt',  width: 14 },
      { header: 'Payment Ref.',  key: 'payRef',  width: 20 },
      { header: 'Payee',         key: 'payee',   width: 28 },
      { header: 'Description',   key: 'desc',    width: 32 },
      { header: 'Amount Paid',   key: 'amount',  width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'WHT Withheld',  key: 'wht',     width: 14, style: { numFmt: '₱#,##0.00' } },
      { header: 'Gross Invoice', key: 'gross',   width: 14, style: { numFmt: '₱#,##0.00' } },
    ];

    const headerRow = ws.getRow(4);
    headerRow.font = { bold: true, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    let totAmount = 0, totWht = 0, totGross = 0;
    payments.forEach((e, i) => {
      totAmount += Number(e.paidAmount ?? e.netAmount);
      totWht    += Number(e.whtAmount);
      totGross  += Number(e.grossAmount);
      const row = ws.addRow({
        paidAt:  e.paidAt!.toLocaleDateString('en-PH'),
        payRef:  e.paymentRef ?? '',
        payee:   e.vendor?.name ?? '',
        desc:    e.description,
        amount:  Number(e.paidAmount ?? e.netAmount),
        wht:     Number(e.whtAmount),
        gross:   Number(e.grossAmount),
      });
      if (i % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
    });

    const totals = ws.addRow({ paidAt: 'TOTAL', payRef: '', payee: '', desc: '', amount: totAmount, wht: totWht, gross: totGross });
    totals.font = { bold: true };
    totals.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── EIS — Per-order e-invoice JSON ────────────────────────────────────────

  async generateEisInvoice(tenantId: string, orderId: string): Promise<EisInvoiceJson> {
    await this.assertBirRegistered(tenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { name: true, tinNumber: true, tin: true, address: true, registeredAddress: true, businessName: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const order = await this.prisma.order.findFirst({
      where:   { id: orderId, tenantId },
      include: {
        items:    true,
        payments: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'COMPLETED') {
      throw new ForbiddenException('EIS invoices can only be generated for completed orders.');
    }

    // Is this a VAT-registered issuance (Sales Invoice) or non-VAT (Official Receipt)?
    // We determine this from the order's vatAmount: if > 0 → Sales Invoice.
    const isVatSale = Number(order.vatAmount) > 0;

    const lineItems: EisLineItem[] = order.items.map((item) => {
      const qty       = Number(item.quantity);
      const lineTotal = Number(item.lineTotal);
      const vatAmt    = Number(item.vatAmount);
      return {
        productName:  item.productName,
        quantity:     qty,
        unitPrice:    Number(item.unitPrice),
        vatExclusive: lineTotal - vatAmt,
        vatAmount:    vatAmt,
        lineTotal,
      };
    });

    const totalVatExclusive = lineItems.reduce((s, l) => s + l.vatExclusive, 0);

    return {
      invoiceNumber:     order.orderNumber,
      invoiceDate:       (order.completedAt ?? order.createdAt).toISOString(),
      sellerTin:         tenant.tinNumber ?? tenant.tin,   // tinNumber is canonical; tin is legacy fallback
      sellerName:        tenant.businessName ?? tenant.name,
      sellerAddress:     tenant.registeredAddress ?? tenant.address,
      buyerTin:          null,
      buyerName:         order.pwdScIdOwnerName,  // if walk-in, null; if PWD/SC, owner name
      lineItems,
      totalVatExclusive,
      vatAmount:         Number(order.vatAmount),
      totalAmount:       Number(order.totalAmount),
      discountAmount:    Number(order.discountAmount),
      transactionType:   isVatSale ? 'SALES_INVOICE' : 'OFFICIAL_RECEIPT',
      currency:          'PHP',
      generatedAt:       new Date().toISOString(),
    };
  }
}
