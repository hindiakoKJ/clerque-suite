import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
