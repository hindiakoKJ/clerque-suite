/**
 * APBillsService — vendor bill CRUD + GL posting + status. Mirror of
 * ARInvoicesService for AP.
 *
 * GL posting (on POST):
 *   For VAT-registered tenants on a vatable line:
 *     DR  Expense / Asset (per-line accountId)
 *     DR  Input VAT (account 1040 standard)
 *     CR  AP Payables (sum of line totals + VAT - WHT)
 *     CR  Withholding Tax Payable (if whtAmount > 0)
 *   For NON_VAT / UNREGISTERED tenants:
 *     DR  Expense (line totals)
 *     CR  AP Payables (line totals - WHT)
 *     CR  Withholding Tax Payable (if any)
 *
 * Withholding semantics:
 *   - WHT is withheld on the cash payment (we issue 2307 to the vendor)
 *   - At BILL posting, WHT is recognized as a payable to BIR
 *   - When the vendor is later paid, the cash outflow = total - WHT
 *     (the WHT stays as a payable to BIR until remittance).
 */

import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma, BillStatus, type TaxStatus } from '@prisma/client';
import { CreateAPBillDto } from './dto/ap-bill.dto';

@Injectable()
export class APBillsService {
  constructor(
    private prisma:    PrismaService,
    private journal:   JournalService,
    private periods:   AccountingPeriodsService,
    private numbering: NumberingService,
  ) {}

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  /** AP Payables account — code 2010 standard PH SFRS chart. */
  private async findApPayablesAccount(tenantId: string): Promise<string> {
    const byCode = await this.prisma.account.findFirst({
      where: { tenantId, code: '2010', isActive: true },
      select: { id: true },
    });
    if (byCode) return byCode.id;
    const fallback = await this.prisma.account.findFirst({
      where: {
        tenantId,
        type: 'LIABILITY',
        isActive: true,
        OR: [
          { name: { contains: 'payable', mode: 'insensitive' } },
          { name: { contains: 'AP',      mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (fallback) return fallback.id;
    throw new BadRequestException('No AP Payables account in COA. Add one (e.g. code 2010, type LIABILITY).');
  }

  /** Input VAT — code 1040. */
  private async findInputVatAccount(tenantId: string): Promise<{ id: string } | null> {
    const byCode = await this.prisma.account.findFirst({
      where:  { tenantId, code: '1040', isActive: true },
      select: { id: true },
    });
    if (byCode) return byCode;
    return this.prisma.account.findFirst({
      where:  { tenantId, type: 'ASSET', isActive: true, name: { contains: 'input vat', mode: 'insensitive' } },
      select: { id: true },
    });
  }

  /** Withholding Tax Payable — code 2050 typically. */
  private async findWhtPayableAccount(tenantId: string): Promise<{ id: string } | null> {
    const byCode = await this.prisma.account.findFirst({
      where:  { tenantId, code: '2050', isActive: true },
      select: { id: true },
    });
    if (byCode) return byCode;
    return this.prisma.account.findFirst({
      where:  {
        tenantId, type: 'LIABILITY', isActive: true,
        OR: [
          { name: { contains: 'withholding', mode: 'insensitive' } },
          { name: { contains: 'WHT',          mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateAPBillDto) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Bill must have at least one line.');
    }

    const vendor = await this.prisma.vendor.findFirst({
      where:  { id: dto.vendorId, tenantId, isActive: true },
      select: { id: true, defaultWhtRate: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');

    const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
    const validAccounts = await this.prisma.account.count({
      where: { id: { in: accountIds }, tenantId, isActive: true },
    });
    if (validAccounts !== accountIds.length) {
      throw new BadRequestException('One or more line accounts are invalid for this tenant.');
    }

    const billDate    = new Date(dto.billDate);
    const postingDate = dto.postingDate ? new Date(dto.postingDate) : billDate;
    const termsDays   = dto.termsDays ?? 30;
    const dueDate     = this.addDays(billDate, termsDays);

    const subtotal  = dto.lines.reduce((s, l) => s + (l.lineTotal - (l.taxAmount ?? 0)), 0);
    const vatAmount = dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
    const total     = dto.lines.reduce((s, l) => s + l.lineTotal, 0);
    const whtAmount = dto.whtAmount ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const billNumber = await this.numbering.next(tenantId, 'AP_BILL', null, tx);

      return tx.aPBill.create({
        data: {
          tenantId,
          branchId:        dto.branchId ?? null,
          billNumber,
          vendorBillRef:   dto.vendorBillRef,
          reference:       dto.reference,
          vendorId:        dto.vendorId,
          billDate,
          postingDate,
          dueDate,
          termsDays,
          subtotal:        new Prisma.Decimal(subtotal),
          vatAmount:       new Prisma.Decimal(vatAmount),
          whtAmount:       new Prisma.Decimal(whtAmount),
          whtAtcCode:      dto.whtAtcCode,
          totalAmount:     new Prisma.Decimal(total),
          paidAmount:      new Prisma.Decimal(0),
          balanceAmount:   new Prisma.Decimal(total - whtAmount),
          status:          'DRAFT',
          description:     dto.description,
          notes:           dto.notes,
          createdById:     userId,
          lines: {
            create: dto.lines.map((l) => ({
              accountId:   l.accountId,
              description: l.description,
              quantity:    new Prisma.Decimal(l.quantity ?? 1),
              unitPrice:   new Prisma.Decimal(l.unitPrice),
              taxAmount:   new Prisma.Decimal(l.taxAmount ?? 0),
              lineTotal:   new Prisma.Decimal(l.lineTotal),
            })),
          },
        },
        include: { lines: true, vendor: { select: { id: true, name: true, tin: true } } },
      });
    });
  }

  async post(tenantId: string, billId: string, userId: string) {
    const bill = await this.prisma.aPBill.findFirst({
      where:   { id: billId, tenantId },
      include: { lines: true, vendor: { select: { name: true } } },
    });
    if (!bill) throw new NotFoundException('Bill not found.');
    if (bill.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot post bill in status ${bill.status}.`);
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId }, select: { taxStatus: true },
    });
    const isVatRegistered = (tenant.taxStatus as TaxStatus) === 'VAT';

    const apAccount   = await this.findApPayablesAccount(tenantId);
    const vatAccount  = isVatRegistered ? await this.findInputVatAccount(tenantId) : null;
    const whtAccount  = Number(bill.whtAmount) > 0 ? await this.findWhtPayableAccount(tenantId) : null;

    if (isVatRegistered && Number(bill.vatAmount) > 0 && !vatAccount) {
      throw new BadRequestException('VAT-registered tenant has no Input VAT account in COA.');
    }
    if (Number(bill.whtAmount) > 0 && !whtAccount) {
      throw new BadRequestException('No Withholding Tax Payable account found in COA.');
    }

    return this.prisma.$transaction(async (tx) => {
      const total     = Number(bill.totalAmount);
      const vatAmount = Number(bill.vatAmount);
      const whtAmount = Number(bill.whtAmount);
      const lines: Array<{ accountId: string; debit?: number; credit?: number; description?: string }> = [];

      // Debit each expense line (net of VAT)
      for (const line of bill.lines) {
        const lineNet = Number(line.lineTotal) - Number(line.taxAmount);
        if (lineNet > 0) {
          lines.push({ accountId: line.accountId, debit: lineNet, description: line.description ?? undefined });
        }
      }
      // Debit Input VAT
      if (vatAccount && vatAmount > 0) {
        lines.push({ accountId: vatAccount.id, debit: vatAmount, description: 'Input VAT' });
      }
      // Credit AP Payables (net of WHT — the cash outflow at payment time)
      lines.push({
        accountId:   apAccount,
        credit:      total - whtAmount,
        description: `${bill.vendor.name} - ${bill.billNumber}`,
      });
      // Credit WHT Payable (the portion withheld)
      if (whtAccount && whtAmount > 0) {
        lines.push({
          accountId:   whtAccount.id,
          credit:      whtAmount,
          description: `WHT ${bill.whtAtcCode ?? ''} on ${bill.vendor.name}`,
        });
      }

      const je = await this.journal.create(
        tenantId,
        {
          date:        bill.billDate.toISOString(),
          postingDate: bill.postingDate.toISOString(),
          description: `AP Bill ${bill.billNumber} — ${bill.vendor.name}`,
          reference:   bill.vendorBillRef ?? bill.billNumber,
          saveDraft:   false,
          lines,
        },
        userId,
      );

      return tx.aPBill.update({
        where: { id: bill.id },
        data: {
          status:         'OPEN',
          postedById:     userId,
          postedAt:       new Date(),
          journalEntryId: je.id,
        },
        include: { lines: true, vendor: { select: { id: true, name: true } } },
      });
    }, { timeout: 30_000 });
  }

  async void(tenantId: string, billId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Void reason is required (>= 5 characters).');
    }
    const bill = await this.prisma.aPBill.findFirst({ where: { id: billId, tenantId } });
    if (!bill) throw new NotFoundException('Bill not found.');
    if (!['OPEN', 'PARTIALLY_PAID', 'PAID'].includes(bill.status)) {
      throw new BadRequestException(`Cannot void bill in status ${bill.status}.`);
    }
    if (!bill.journalEntryId) throw new BadRequestException('Bill has no posted JE to reverse.');

    return this.prisma.$transaction(async (tx) => {
      await this.journal.reverse(tenantId, bill.journalEntryId!, userId);
      return tx.aPBill.update({
        where: { id: bill.id },
        data: { status: 'VOIDED', voidedById: userId, voidedAt: new Date(), voidReason: reason.trim() },
      });
    }, { timeout: 30_000 });
  }

  async cancel(tenantId: string, billId: string, userId: string, reason: string) {
    const bill = await this.prisma.aPBill.findFirst({ where: { id: billId, tenantId } });
    if (!bill) throw new NotFoundException('Bill not found.');
    if (bill.status !== 'DRAFT') {
      throw new ForbiddenException('Only DRAFT bills can be cancelled. Use Void for posted bills.');
    }
    return this.prisma.aPBill.update({
      where: { id: billId },
      data: { status: 'CANCELLED', voidedById: userId, voidedAt: new Date(), voidReason: reason },
    });
  }

  async findAll(
    tenantId: string,
    opts: {
      page?:        number;
      pageSize?:    number;
      vendorId?:    string;
      status?:      BillStatus | BillStatus[];
      from?:        string;
      to?:          string;
      onlyOpen?:    boolean;
      onlyOverdue?: boolean;
      /** "1-30" | "31-60" | "61-90" | "90+" — bucket-precise aging filter */
      dueBucket?:   '1-30' | '31-60' | '61-90' | '90+';
    },
  ) {
    const page     = opts.page     ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const where: Prisma.APBillWhereInput = { tenantId };
    if (opts.vendorId)   where.vendorId  = opts.vendorId;
    if (opts.status)     where.status    = Array.isArray(opts.status) ? { in: opts.status } : opts.status;
    if (opts.from || opts.to) {
      where.postingDate = {};
      if (opts.from) (where.postingDate as { gte?: Date }).gte = new Date(opts.from);
      if (opts.to)   (where.postingDate as { lte?: Date }).lte = new Date(opts.to);
    }
    if (opts.onlyOpen)    where.status = { in: ['OPEN', 'PARTIALLY_PAID'] };
    if (opts.onlyOverdue) {
      where.status  = { in: ['OPEN', 'PARTIALLY_PAID'] };
      where.dueDate = { lt: new Date() };
    }
    if (opts.dueBucket) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const day = 86_400_000;
      const t = today.getTime();
      let from: Date, to: Date;
      switch (opts.dueBucket) {
        case '1-30':  from = new Date(t - 30 * day); to = new Date(t - 1  * day); break;
        case '31-60': from = new Date(t - 60 * day); to = new Date(t - 31 * day); break;
        case '61-90': from = new Date(t - 90 * day); to = new Date(t - 61 * day); break;
        case '90+':   from = new Date(0);            to = new Date(t - 91 * day); break;
      }
      where.status  = { in: ['OPEN', 'PARTIALLY_PAID'] };
      where.dueDate = { gte: from, lte: to };
    }

    const [data, total] = await Promise.all([
      this.prisma.aPBill.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { billNumber: 'desc' }],
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: {
          vendor: { select: { id: true, name: true, tin: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.aPBill.count({ where }),
    ]);
    return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  /**
   * Aging summary for open vendor bills, bucketed by days-past-due.
   * Net payable basis (totalAmount − whtAmount), since WHT is paid to BIR
   * separately, not to the vendor.
   */
  async getAging(tenantId: string) {
    const bills = await this.prisma.aPBill.findMany({
      where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
      select: {
        id: true, dueDate: true, totalAmount: true, paidAmount: true, whtAmount: true,
        vendorId: true, vendor: { select: { name: true } },
      },
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const buckets = { notDue: 0, bucket1_30: 0, bucket31_60: 0, bucket61_90: 0, bucket90plus: 0, total: 0 };
    const vendors = new Map<string, { id: string; name: string; balance: number; daysPastDue: number }>();

    for (const b of bills) {
      const net = Number(b.totalAmount) - Number(b.whtAmount);
      const balance = net - Number(b.paidAmount);
      if (balance <= 0) continue;
      const due = new Date(b.dueDate); due.setHours(0, 0, 0, 0);
      const daysPastDue = Math.floor((today.getTime() - due.getTime()) / 86400000);

      if      (daysPastDue <= 0)  buckets.notDue       += balance;
      else if (daysPastDue <= 30) buckets.bucket1_30   += balance;
      else if (daysPastDue <= 60) buckets.bucket31_60  += balance;
      else if (daysPastDue <= 90) buckets.bucket61_90  += balance;
      else                         buckets.bucket90plus += balance;
      buckets.total += balance;

      const vid = b.vendorId;
      const cur = vendors.get(vid) ?? { id: vid, name: b.vendor?.name ?? '—', balance: 0, daysPastDue: 0 };
      cur.balance += balance;
      cur.daysPastDue = Math.max(cur.daysPastDue, daysPastDue);
      vendors.set(vid, cur);
    }

    return {
      ...buckets,
      vendors: Array.from(vendors.values()).sort((a, b) => b.balance - a.balance),
    };
  }

  async findOne(tenantId: string, billId: string) {
    const bill = await this.prisma.aPBill.findFirst({
      where: { id: billId, tenantId },
      include: {
        lines:    { include: { account: { select: { code: true, name: true } } } },
        vendor:   true,
        branch:   { select: { id: true, name: true } },
        applications: {
          include: { payment: { select: { id: true, paymentNumber: true, paymentDate: true, method: true } } },
          orderBy: { appliedAt: 'asc' },
        },
        journalEntry: { select: { id: true, entryNumber: true, status: true } },
      },
    });
    if (!bill) throw new NotFoundException('Bill not found.');
    return bill;
  }
}
