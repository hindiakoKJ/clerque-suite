import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ExpenseStatus } from '@prisma/client';
import { CreateExpenseDto, UpdateExpenseDto, RecordPaymentDto } from './dto/expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private computeAmounts(gross: number, whtRate: number): { whtAmount: number; netAmount: number } {
    const whtAmount = Math.round(gross * whtRate * 10000) / 10000;
    const netAmount = Math.round((gross - whtAmount) * 10000) / 10000;
    return { whtAmount, netAmount };
  }

  private async findAccount(tenantId: string, code: string) {
    return this.prisma.account.findFirst({ where: { tenantId, code } });
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    opts: {
      vendorId?: string;
      status?: ExpenseStatus;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { vendorId, status, from, to, page = 1, limit = 50 } = opts;
    const take = Math.min(limit, 200);
    const skip = (page - 1) * take;

    const where: Prisma.ExpenseEntryWhereInput = {
      tenantId,
      ...(vendorId ? { vendorId } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? {
            expenseDate: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.expenseEntry.count({ where }),
      this.prisma.expenseEntry.findMany({
        where,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          vendor: { select: { id: true, name: true, tin: true } },
        },
      }),
    ]);

    return { data, total, page, pages: Math.ceil(total / take) };
  }

  async findOne(id: string, tenantId: string) {
    const expense = await this.prisma.expenseEntry.findFirst({
      where: { id, tenantId },
      include: {
        vendor: true,
      },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async create(tenantId: string, userId: string, dto: CreateExpenseDto) {
    const gross = Number(dto.grossAmount);
    const whtRate = dto.whtRate ? Number(dto.whtRate) : 0;
    const { whtAmount, netAmount } = this.computeAmounts(gross, whtRate);
    const inputVat = Number(dto.inputVat ?? 0);

    return this.prisma.expenseEntry.create({
      data: {
        tenantId,
        branchId: dto.branchId ?? null,
        vendorId: dto.vendorId ?? null,
        description: dto.description,
        expenseDate: new Date(dto.expenseDate),
        grossAmount: new Prisma.Decimal(gross),
        atcCode: dto.atcCode ?? null,
        whtRate: whtRate ? new Prisma.Decimal(whtRate) : null,
        whtAmount: new Prisma.Decimal(whtAmount),
        netAmount: new Prisma.Decimal(netAmount),
        inputVat: new Prisma.Decimal(inputVat),
        referenceNumber: dto.referenceNumber ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        status: 'DRAFT',
        notes: dto.notes ?? null,
        createdById: userId,
        updatedById: userId,
      },
      include: { vendor: { select: { id: true, name: true } } },
    });
  }

  async update(id: string, tenantId: string, userId: string, dto: UpdateExpenseDto) {
    const expense = await this.prisma.expenseEntry.findFirst({ where: { id, tenantId } });
    if (!expense) throw new NotFoundException('Expense not found');
    if (expense.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT expenses can be edited');
    }

    // Recompute if gross or whtRate changes
    const gross = dto.grossAmount !== undefined ? Number(dto.grossAmount) : Number(expense.grossAmount);
    const whtRate =
      dto.whtRate !== undefined
        ? Number(dto.whtRate)
        : expense.whtRate !== null
        ? Number(expense.whtRate)
        : 0;
    const { whtAmount, netAmount } = this.computeAmounts(gross, whtRate);
    const inputVat =
      dto.inputVat !== undefined ? Number(dto.inputVat) : Number(expense.inputVat);

    return this.prisma.expenseEntry.update({
      where: { id },
      data: {
        ...(dto.vendorId !== undefined ? { vendorId: dto.vendorId } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.expenseDate !== undefined ? { expenseDate: new Date(dto.expenseDate) } : {}),
        grossAmount: new Prisma.Decimal(gross),
        ...(dto.atcCode !== undefined ? { atcCode: dto.atcCode } : {}),
        whtRate: whtRate ? new Prisma.Decimal(whtRate) : null,
        whtAmount: new Prisma.Decimal(whtAmount),
        netAmount: new Prisma.Decimal(netAmount),
        inputVat: new Prisma.Decimal(inputVat),
        ...(dto.referenceNumber !== undefined ? { referenceNumber: dto.referenceNumber } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedById: userId,
      },
      include: { vendor: { select: { id: true, name: true } } },
    });
  }

  async post(id: string, tenantId: string, userId: string) {
    const expense = await this.prisma.expenseEntry.findFirst({
      where: { id, tenantId },
      include: { vendor: true },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    if (expense.status !== 'DRAFT') {
      throw new BadRequestException(`Expense is already ${expense.status} — only DRAFT expenses can be posted`);
    }

    // Get tenant info to check VAT status
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { taxStatus: true },
    });
    const isVatRegistered = tenant?.taxStatus === 'VAT';

    const gross = Number(expense.grossAmount);
    const whtAmount = Number(expense.whtAmount);
    const inputVat = Number(expense.inputVat);

    // Find GL accounts
    const [apAccount, whtPayableAccount, inputVatAccount, expenseAccount] = await Promise.all([
      this.findAccount(tenantId, '2010'),
      this.findAccount(tenantId, '2060'),
      this.findAccount(tenantId, '1040'),
      this.findAccount(tenantId, '6140'), // Miscellaneous Expense as fallback
    ]);

    if (!apAccount) throw new BadRequestException('Account 2010 (Accounts Payable) not found — seed chart of accounts');
    if (!whtPayableAccount) throw new BadRequestException('Account 2060 (Withholding Tax Payable) not found — seed chart of accounts');
    if (!expenseAccount) throw new BadRequestException('Account 6140 (Expense) not found — seed chart of accounts');

    type JournalLine = {
      accountId: string;
      description: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      currency: string;
      exchangeRate: number;
    };

    const lines: JournalLine[] = [];

    // DR: Expense account (gross - inputVat or gross)
    const expenseAmount = isVatRegistered && inputVat > 0 ? gross - inputVat : gross;
    lines.push({
      accountId: expenseAccount.id,
      description: expense.description,
      debit: new Prisma.Decimal(expenseAmount),
      credit: new Prisma.Decimal(0),
      currency: 'PHP',
      exchangeRate: 1,
    });

    // DR: Input VAT if vat-registered and inputVat > 0
    if (isVatRegistered && inputVat > 0 && inputVatAccount) {
      lines.push({
        accountId: inputVatAccount.id,
        description: 'Input VAT',
        debit: new Prisma.Decimal(inputVat),
        credit: new Prisma.Decimal(0),
        currency: 'PHP',
        exchangeRate: 1,
      });
    }

    // CR: Accounts Payable = netAmount (gross - whtAmount). Vendor is paid net of WHT.
    // Input VAT is reclaimed from BIR, not deducted from vendor payment.
    lines.push({
      accountId: apAccount.id,
      description: `AP: ${expense.description}`,
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(Number(expense.netAmount)),
      currency: 'PHP',
      exchangeRate: 1,
    });

    // CR: WHT Payable (if whtAmount > 0)
    if (whtAmount > 0) {
      lines.push({
        accountId: whtPayableAccount.id,
        description: `WHT: ${expense.atcCode ?? ''}`,
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(whtAmount),
        currency: 'PHP',
        exchangeRate: 1,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.journalEntry.create({
        data: {
          tenantId,
          entryNumber: `AP-${Date.now()}`,
          date: expense.expenseDate,
          postingDate: new Date(),
          description: `AP: ${expense.description}`,
          reference: expense.referenceNumber ?? null,
          status: 'POSTED',
          source: 'AP',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: { create: lines },
        },
      });

      await tx.expenseEntry.update({
        where: { id },
        data: { status: 'POSTED', updatedById: userId },
      });
    });

    return this.findOne(id, tenantId);
  }

  async void(id: string, tenantId: string, userId: string) {
    const expense = await this.prisma.expenseEntry.findFirst({
      where: { id, tenantId },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    if (expense.status === 'VOIDED') {
      throw new BadRequestException('Expense is already voided');
    }

    if (expense.status === 'DRAFT') {
      // Simply mark as VOIDED
      return this.prisma.expenseEntry.update({
        where: { id },
        data: { status: 'VOIDED', updatedById: userId },
      });
    }

    // POSTED → create reversal JE
    const [apAccount, whtPayableAccount, inputVatAccount, expenseAccount] = await Promise.all([
      this.findAccount(tenantId, '2010'),
      this.findAccount(tenantId, '2060'),
      this.findAccount(tenantId, '1040'),
      this.findAccount(tenantId, '6140'),
    ]);

    if (!apAccount || !expenseAccount) {
      throw new BadRequestException('Required GL accounts not found — cannot create reversal');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { taxStatus: true },
    });
    const isVatRegistered = tenant?.taxStatus === 'VAT';

    const gross = Number(expense.grossAmount);
    const whtAmount = Number(expense.whtAmount);
    const inputVat = Number(expense.inputVat);
    const netAmount = Number(expense.netAmount);

    type ReversalLine = {
      accountId: string;
      description: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      currency: string;
      exchangeRate: number;
    };

    const reversalLines: ReversalLine[] = [];

    // CR: Expense (reverse the debit)
    const expenseAmount = isVatRegistered && inputVat > 0 ? gross - inputVat : gross;
    reversalLines.push({
      accountId: expenseAccount.id,
      description: `Void: ${expense.description}`,
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(expenseAmount),
      currency: 'PHP',
      exchangeRate: 1,
    });

    // CR: Input VAT (reverse)
    if (isVatRegistered && inputVat > 0 && inputVatAccount) {
      reversalLines.push({
        accountId: inputVatAccount.id,
        description: 'Void: Input VAT',
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(inputVat),
        currency: 'PHP',
        exchangeRate: 1,
      });
    }

    // DR: Accounts Payable (reverse the credit)
    reversalLines.push({
      accountId: apAccount.id,
      description: `Void AP: ${expense.description}`,
      debit: new Prisma.Decimal(netAmount),
      credit: new Prisma.Decimal(0),
      currency: 'PHP',
      exchangeRate: 1,
    });

    // DR: WHT Payable (reverse)
    if (whtAmount > 0 && whtPayableAccount) {
      reversalLines.push({
        accountId: whtPayableAccount.id,
        description: `Void WHT: ${expense.atcCode ?? ''}`,
        debit: new Prisma.Decimal(whtAmount),
        credit: new Prisma.Decimal(0),
        currency: 'PHP',
        exchangeRate: 1,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.journalEntry.create({
        data: {
          tenantId,
          entryNumber: `AP-VOID-${Date.now()}`,
          date: new Date(),
          postingDate: new Date(),
          description: `Void AP: ${expense.description}`,
          reference: expense.referenceNumber ?? null,
          status: 'POSTED',
          source: 'AP',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: { create: reversalLines },
        },
      });

      await tx.expenseEntry.update({
        where: { id },
        data: { status: 'VOIDED', updatedById: userId },
      });
    });

    return this.findOne(id, tenantId);
  }

  async recordPayment(
    id: string,
    tenantId: string,
    userId: string,
    dto: RecordPaymentDto,
  ) {
    const expense = await this.prisma.expenseEntry.findFirst({
      where: { id, tenantId },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    if (expense.status !== 'POSTED') {
      throw new BadRequestException('Only POSTED expenses can be paid');
    }

    const paidAmount = Number(dto.paidAmount);
    const netAmount = Number(expense.netAmount);
    const alreadyPaid = Number(expense.paidAmount ?? 0);
    const remaining = netAmount - alreadyPaid;

    if (paidAmount <= 0) throw new BadRequestException('Payment amount must be greater than zero');
    if (paidAmount > remaining + 0.01) {
      throw new BadRequestException(
        `Payment amount (${paidAmount}) exceeds outstanding balance (${remaining.toFixed(2)})`,
      );
    }

    // Find AP and Cash accounts
    const [apAccount, cashAccount] = await Promise.all([
      this.findAccount(tenantId, '2010'),
      this.findAccount(tenantId, '1010'),
    ]);

    if (!apAccount) throw new BadRequestException('Account 2010 (Accounts Payable) not found');
    if (!cashAccount) throw new BadRequestException('Account 1010 (Cash) not found');

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    const totalPaid = alreadyPaid + paidAmount;

    await this.prisma.$transaction(async (tx) => {
      await tx.journalEntry.create({
        data: {
          tenantId,
          entryNumber: `AP-PAY-${Date.now()}`,
          date: paidAt,
          postingDate: paidAt,
          description: `Payment to vendor: ${expense.description}`,
          reference: dto.paymentRef,
          status: 'POSTED',
          source: 'AP',
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId: apAccount.id,
                description: `Pay AP: ${expense.description}`,
                debit: new Prisma.Decimal(paidAmount),
                credit: new Prisma.Decimal(0),
                currency: 'PHP',
                exchangeRate: 1,
              },
              {
                accountId: cashAccount.id,
                description: `Cash out: ${dto.paymentRef}`,
                debit: new Prisma.Decimal(0),
                credit: new Prisma.Decimal(paidAmount),
                currency: 'PHP',
                exchangeRate: 1,
              },
            ],
          },
        },
      });

      await tx.expenseEntry.update({
        where: { id },
        data: {
          paidAmount: new Prisma.Decimal(totalPaid),
          paymentRef: dto.paymentRef,
          paidAt,
          updatedById: userId,
        },
      });
    });

    return this.findOne(id, tenantId);
  }

  async getAging(tenantId: string) {
    const now = new Date();

    // Fetch all POSTED, unpaid or partially-paid expenses
    const expenses = await this.prisma.expenseEntry.findMany({
      where: {
        tenantId,
        status: 'POSTED',
      },
      include: {
        vendor: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Filter to those with remaining balance
    const unpaid = expenses.filter((e) => {
      const net = Number(e.netAmount);
      const paid = Number(e.paidAmount ?? 0);
      return net - paid > 0.005;
    });

    // Bucket by vendor
    const vendorMap = new Map<
      string,
      {
        vendorId: string;
        vendorName: string;
        current: number;
        days1_30: number;
        days31_60: number;
        days61_90: number;
        days90plus: number;
        total: number;
      }
    >();

    for (const e of unpaid) {
      const vendorId = e.vendorId ?? '__no_vendor__';
      const vendorName = e.vendor?.name ?? 'No Vendor';
      const balance = Number(e.netAmount) - Number(e.paidAmount ?? 0);

      if (!vendorMap.has(vendorId)) {
        vendorMap.set(vendorId, {
          vendorId,
          vendorName,
          current: 0,
          days1_30: 0,
          days31_60: 0,
          days61_90: 0,
          days90plus: 0,
          total: 0,
        });
      }

      const bucket = vendorMap.get(vendorId)!;
      bucket.total += balance;

      if (!e.dueDate) {
        // No due date → current
        bucket.current += balance;
        continue;
      }

      const dueDate = new Date(e.dueDate);
      const diffMs = now.getTime() - dueDate.getTime();
      const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (daysOverdue <= 0) {
        bucket.current += balance;
      } else if (daysOverdue <= 30) {
        bucket.days1_30 += balance;
      } else if (daysOverdue <= 60) {
        bucket.days31_60 += balance;
      } else if (daysOverdue <= 90) {
        bucket.days61_90 += balance;
      } else {
        bucket.days90plus += balance;
      }
    }

    const rows = Array.from(vendorMap.values());

    // Compute column totals
    const totals = rows.reduce(
      (acc, r) => ({
        current: acc.current + r.current,
        days1_30: acc.days1_30 + r.days1_30,
        days31_60: acc.days31_60 + r.days31_60,
        days61_90: acc.days61_90 + r.days61_90,
        days90plus: acc.days90plus + r.days90plus,
        total: acc.total + r.total,
      }),
      { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days90plus: 0, total: 0 },
    );

    return {
      asOf: now.toISOString(),
      rows,
      totals,
    };
  }
}
