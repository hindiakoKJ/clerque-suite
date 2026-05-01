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

  // ── BIR 2307 — Certificate of Creditable Tax Withheld at Source ──────────
  //
  // Per RR No. 2-98 + later amendments. We issue this to each vendor at year-end
  // (or per-quarter) summarising the Expanded Withholding Tax (EWT) we withheld
  // on their behalf so they can claim it as a tax credit.
  //
  // Structure: per vendor, summarized by ATC code, broken into monthly rows
  // (BIR 2307 has 3 rows for a quarter, one per month).

  async get2307Data(
    tenantId: string,
    vendorId: string,
    year: number,
    quarter: 1 | 2 | 3 | 4 | null,
  ) {
    await this.assertBirRegistered(tenantId);

    let from: Date, to: Date;
    if (quarter) {
      const b = quarterBounds(year, quarter);
      from = b.from; to = b.to;
    } else {
      from = new Date(Date.UTC(year, 0, 1));
      to   = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: tenantId },
      select: { businessName: true, name: true, tinNumber: true, registeredAddress: true },
    });
    const vendor = await this.prisma.vendor.findFirstOrThrow({
      where:  { id: vendorId, tenantId },
      select: { name: true, tin: true, address: true, defaultAtcCode: true },
    });

    // Pull every posted bill for this vendor in the period that had WHT
    const bills = await this.prisma.aPBill.findMany({
      where: {
        tenantId, vendorId,
        billDate: { gte: from, lte: to },
        status:   { in: ['OPEN', 'PARTIALLY_PAID', 'PAID'] },
        whtAmount: { gt: 0 },
      },
      select: {
        billDate: true, totalAmount: true, whtAmount: true, whtAtcCode: true,
        subtotal: true, vatAmount: true,
      },
      orderBy: { billDate: 'asc' },
    });

    // Aggregate by ATC code → array of { atcCode, monthBreakdown }
    interface AtcRow {
      atcCode:        string;
      months:         Map<number, { taxBase: number; taxWithheld: number }>;
      totalTaxBase:   number;
      totalWithheld:  number;
    }
    const atcMap = new Map<string, AtcRow>();

    for (const b of bills) {
      const atc = b.whtAtcCode || vendor.defaultAtcCode || 'UNCATEGORISED';
      const monthIdx = b.billDate.getUTCMonth(); // 0..11
      let row = atcMap.get(atc);
      if (!row) {
        row = { atcCode: atc, months: new Map(), totalTaxBase: 0, totalWithheld: 0 };
        atcMap.set(atc, row);
      }
      // Tax base (BIR 2307 column 5) = subtotal (gross of VAT excluded)
      // simplification: use subtotal which we already excluded VAT from in APBill
      const base = Number(b.subtotal);
      const wht  = Number(b.whtAmount);
      const m = row.months.get(monthIdx) ?? { taxBase: 0, taxWithheld: 0 };
      m.taxBase     += base;
      m.taxWithheld += wht;
      row.months.set(monthIdx, m);
      row.totalTaxBase  += base;
      row.totalWithheld += wht;
    }

    const atcRows = Array.from(atcMap.values()).map((r) => ({
      atcCode:        r.atcCode,
      months: Array.from(r.months.entries())
        .sort(([a], [b]) => a - b)
        .map(([month, v]) => ({ month, taxBase: v.taxBase, taxWithheld: v.taxWithheld })),
      totalTaxBase:   r.totalTaxBase,
      totalWithheld:  r.totalWithheld,
    }));

    return {
      year, quarter,
      periodFrom: toIso(from), periodTo: toIso(to),
      payor: {
        registeredName: tenant.businessName ?? tenant.name,
        tin:            tenant.tinNumber ?? '',
        address:        tenant.registeredAddress ?? '',
      },
      payee: {
        registeredName: vendor.name,
        tin:            vendor.tin ?? '',
        address:        vendor.address ?? '',
      },
      atcRows,
      grandTotalTaxBase:  bills.reduce((s, b) => s + Number(b.subtotal), 0),
      grandTotalWithheld: bills.reduce((s, b) => s + Number(b.whtAmount), 0),
      billCount:          bills.length,
      generatedAt:        new Date().toISOString(),
    };
  }

  /** Generate the 2307 as an Excel workbook formatted for printing. */
  async generate2307Excel(
    tenantId: string,
    vendorId: string,
    year: number,
    quarter: 1 | 2 | 3 | 4 | null,
  ): Promise<Buffer> {
    const data = await this.get2307Data(tenantId, vendorId, year, quarter);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    const ws = wb.addWorksheet('BIR 2307', { pageSetup: { paperSize: 9 /* A4 */, orientation: 'portrait' } });

    // Title
    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = 'BIR FORM 2307';
    ws.getCell('A1').font  = { bold: true, size: 14, color: { argb: 'FF000000' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    ws.mergeCells('A2:F2');
    ws.getCell('A2').value = 'Certificate of Creditable Tax Withheld at Source';
    ws.getCell('A2').font  = { bold: true, size: 11 };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    ws.mergeCells('A3:F3');
    ws.getCell('A3').value =
      data.quarter
        ? `For the Quarter Ending: Q${data.quarter} ${data.year} (${data.periodFrom} – ${data.periodTo})`
        : `For the Year ${data.year} (${data.periodFrom} – ${data.periodTo})`;
    ws.getCell('A3').alignment = { horizontal: 'center' };

    let row = 5;
    // Payor block
    ws.getCell(`A${row}`).value = 'Payor (Withholding Agent)';
    ws.getCell(`A${row}`).font  = { bold: true };
    row++;
    ws.getCell(`A${row}`).value = 'Registered Name:';
    ws.getCell(`B${row}`).value = data.payor.registeredName;
    row++;
    ws.getCell(`A${row}`).value = 'TIN:';
    ws.getCell(`B${row}`).value = data.payor.tin;
    row++;
    ws.getCell(`A${row}`).value = 'Address:';
    ws.getCell(`B${row}`).value = data.payor.address;
    row += 2;

    // Payee block
    ws.getCell(`A${row}`).value = 'Payee (Vendor)';
    ws.getCell(`A${row}`).font  = { bold: true };
    row++;
    ws.getCell(`A${row}`).value = 'Registered Name:';
    ws.getCell(`B${row}`).value = data.payee.registeredName;
    row++;
    ws.getCell(`A${row}`).value = 'TIN:';
    ws.getCell(`B${row}`).value = data.payee.tin;
    row++;
    ws.getCell(`A${row}`).value = 'Address:';
    ws.getCell(`B${row}`).value = data.payee.address;
    row += 2;

    // Income payments + tax withheld table
    const headerRow = row;
    const headers = ['ATC', 'Income Payments Subject to EWT', '1st Month', '2nd Month', '3rd Month', 'Total', 'Tax Withheld'];
    headers.forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h;
      cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    ws.getRow(headerRow).height = 30;
    row++;

    // Determine the 3 month indexes for the period
    const monthIdxs: number[] = data.quarter
      ? [(data.quarter - 1) * 3, (data.quarter - 1) * 3 + 1, (data.quarter - 1) * 3 + 2]
      : [0, 1, 2]; // for whole-year, default to Jan-Mar (year mode is mostly used as a workaround)

    // Body rows
    for (const atc of data.atcRows) {
      const monthsByIdx = new Map(atc.months.map((m) => [m.month, m]));
      const m1 = monthsByIdx.get(monthIdxs[0])?.taxBase ?? 0;
      const m2 = monthsByIdx.get(monthIdxs[1])?.taxBase ?? 0;
      const m3 = monthsByIdx.get(monthIdxs[2])?.taxBase ?? 0;
      const cells: (string | number)[] = [
        atc.atcCode,
        '',
        m1, m2, m3,
        atc.totalTaxBase,
        atc.totalWithheld,
      ];
      cells.forEach((v, i) => {
        const cell = ws.getCell(row, i + 1);
        cell.value = v;
        if (i >= 2) cell.numFmt = '#,##0.00';
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
      row++;
    }

    // Grand total row
    const totalCells: (string | number)[] = [
      '', 'GRAND TOTAL', '', '', '',
      data.grandTotalTaxBase,
      data.grandTotalWithheld,
    ];
    totalCells.forEach((v, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = v;
      cell.font  = { bold: true };
      if (i >= 2) cell.numFmt = '#,##0.00';
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      cell.border = { top: { style: 'medium' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    row += 3;

    // Signature lines
    ws.getCell(`A${row}`).value = 'Signature of Withholding Agent / Authorised Representative:';
    ws.getCell(`A${row}`).font  = { italic: true, color: { argb: 'FF666666' } };
    row += 3;
    ws.getCell(`A${row}`).value = '___________________________________';
    row++;
    ws.getCell(`A${row}`).value = 'Printed Name + Position + Date';
    ws.getCell(`A${row}`).font  = { italic: true, color: { argb: 'FF666666' } };

    // Footer note
    row += 3;
    ws.mergeCells(`A${row}:G${row}`);
    ws.getCell(`A${row}`).value = `Generated by Clerque on ${new Date(data.generatedAt).toLocaleString('en-PH')}. ` +
      `Bills counted: ${data.billCount}. ` +
      `This Excel is auto-prepared from your AP records — review against vendor copies before issuing.`;
    ws.getCell(`A${row}`).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
    ws.getCell(`A${row}`).alignment = { wrapText: true };

    // Column widths
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 32;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 14;
    ws.getColumn(6).width = 16;
    ws.getColumn(7).width = 16;

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Vendors that have any WHT bills in the requested period — for the picker UI. */
  async list2307VendorsForPeriod(
    tenantId: string,
    year: number,
    quarter: 1 | 2 | 3 | 4 | null,
  ) {
    await this.assertBirRegistered(tenantId);
    let from: Date, to: Date;
    if (quarter) {
      const b = quarterBounds(year, quarter);
      from = b.from; to = b.to;
    } else {
      from = new Date(Date.UTC(year, 0, 1));
      to   = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    }
    const grouped = await this.prisma.aPBill.groupBy({
      by: ['vendorId'],
      where: {
        tenantId,
        billDate: { gte: from, lte: to },
        status:   { in: ['OPEN', 'PARTIALLY_PAID', 'PAID'] },
        whtAmount: { gt: 0 },
      },
      _sum:   { whtAmount: true, subtotal: true },
      _count: { id: true },
    });
    const vendorIds = grouped.map((g) => g.vendorId);
    const vendors = await this.prisma.vendor.findMany({
      where: { tenantId, id: { in: vendorIds } },
      select: { id: true, name: true, tin: true, defaultAtcCode: true },
    });
    const byId = new Map(vendors.map((v) => [v.id, v]));
    return grouped.map((g) => ({
      vendorId:       g.vendorId,
      vendorName:     byId.get(g.vendorId)?.name ?? '(deleted)',
      vendorTin:      byId.get(g.vendorId)?.tin ?? null,
      defaultAtcCode: byId.get(g.vendorId)?.defaultAtcCode ?? null,
      billCount:      g._count.id,
      totalTaxBase:   Number(g._sum.subtotal ?? 0),
      totalWithheld:  Number(g._sum.whtAmount ?? 0),
    })).sort((a, b) => b.totalWithheld - a.totalWithheld);
  }
}
