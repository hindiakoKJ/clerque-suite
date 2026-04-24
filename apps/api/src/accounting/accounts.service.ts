import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountType, NormalBalance } from '@prisma/client';

export interface CreateAccountDto {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  parentId?: string;
  description?: string;
}

export interface UpdateAccountDto {
  name?: string;
  description?: string;
  parentId?: string;
  isActive?: boolean;
}

// ── Standard PH chart of accounts (seeded on tenant onboard) ──────────────────

export const DEFAULT_ACCOUNTS: Omit<CreateAccountDto & { isSystem: boolean }, 'parentId'>[] = [
  // Assets
  { code: '1010', name: 'Cash on Hand',              type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true },
  { code: '1020', name: 'Cash in Bank',               type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true },
  { code: '1030', name: 'Accounts Receivable',        type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true },
  { code: '1031', name: 'Digital Wallet Receivable',  type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true },
  { code: '1040', name: 'Input VAT',                  type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true },
  { code: '1050', name: 'Merchandise Inventory',      type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true },
  { code: '1060', name: 'Prepaid Expenses',           type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: false },
  // Liabilities
  { code: '2010', name: 'Accounts Payable',           type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false },
  { code: '2020', name: 'Output VAT Payable',         type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: true },
  { code: '2030', name: 'SSS Contributions Payable',  type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false },
  { code: '2040', name: 'PhilHealth Contributions Payable', type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false },
  { code: '2050', name: 'Pag-IBIG Contributions Payable',   type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false },
  { code: '2060', name: 'Withholding Tax Payable',    type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false },
  { code: '2070', name: 'Loans Payable',              type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false },
  // Equity
  { code: '3010', name: "Owner's Capital",            type: 'EQUITY',    normalBalance: 'CREDIT', isSystem: false },
  { code: '3020', name: "Owner's Drawing",            type: 'EQUITY',    normalBalance: 'DEBIT',  isSystem: false },
  { code: '3030', name: 'Retained Earnings',          type: 'EQUITY',    normalBalance: 'CREDIT', isSystem: false },
  // Revenue
  { code: '4010', name: 'Sales Revenue',              type: 'REVENUE',   normalBalance: 'CREDIT', isSystem: true },
  { code: '4020', name: 'Sales Discounts',            type: 'REVENUE',   normalBalance: 'DEBIT',  isSystem: true }, // contra
  { code: '4030', name: 'Sales Returns',              type: 'REVENUE',   normalBalance: 'DEBIT',  isSystem: false }, // contra
  // COGS
  { code: '5010', name: 'Cost of Goods Sold',         type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: true },
  // Expenses
  { code: '6010', name: 'Salaries and Wages',         type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false },
  { code: '6020', name: 'SSS Employer Contribution',  type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false },
  { code: '6030', name: 'PhilHealth Employer Contribution', type: 'EXPENSE', normalBalance: 'DEBIT', isSystem: false },
  { code: '6040', name: 'Pag-IBIG Employer Contribution',  type: 'EXPENSE', normalBalance: 'DEBIT', isSystem: false },
  { code: '6050', name: 'Rent Expense',               type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false },
  { code: '6060', name: 'Utilities Expense',          type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false },
  { code: '6070', name: 'Office Supplies Expense',    type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false },
  { code: '6080', name: 'Depreciation Expense',       type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false },
];

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  // ── Seed defaults for a new tenant ──────────────────────────────────────────

  async seedDefaultAccounts(tenantId: string): Promise<void> {
    const existing = await this.prisma.account.count({ where: { tenantId } });
    if (existing > 0) return; // already seeded

    await this.prisma.account.createMany({
      data: DEFAULT_ACCOUNTS.map((a) => ({ ...a, tenantId })),
      skipDuplicates: true,
    });
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async findAll(tenantId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { tenantId },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: { parent: { select: { id: true, code: true, name: true } } },
    });

    // Ensure default accounts are seeded on first access
    if (accounts.length === 0) {
      await this.seedDefaultAccounts(tenantId);
      return this.findAll(tenantId);
    }
    return accounts;
  }

  async findOne(tenantId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, tenantId },
      include: {
        parent: { select: { id: true, code: true, name: true } },
        children: { select: { id: true, code: true, name: true, isActive: true } },
      },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async findByCode(tenantId: string, code: string) {
    return this.prisma.account.findUnique({ where: { tenantId_code: { tenantId, code } } });
  }

  async create(tenantId: string, dto: CreateAccountDto) {
    const existing = await this.prisma.account.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Account code ${dto.code} already exists`);

    return this.prisma.account.create({
      data: { ...dto, tenantId },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAccountDto) {
    const account = await this.prisma.account.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Account not found');

    return this.prisma.account.update({ where: { id }, data: dto });
  }

  async delete(tenantId: string, id: string) {
    const account = await this.prisma.account.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.isSystem) throw new ForbiddenException('System accounts cannot be deleted');

    const usedInLines = await this.prisma.journalLine.count({ where: { accountId: id } });
    if (usedInLines > 0) throw new ConflictException('Account has journal entries and cannot be deleted. Deactivate it instead.');

    return this.prisma.account.delete({ where: { id } });
  }

  // ── Trial Balance ────────────────────────────────────────────────────────────

  async getTrialBalance(tenantId: string, asOf?: string) {
    const dateFilter = asOf ? { lte: new Date(asOf) } : undefined;

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: {
        journalLines: {
          where: {
            journalEntry: {
              tenantId,
              status: 'POSTED',
              ...(dateFilter ? { date: dateFilter } : {}),
            },
          },
          select: { debit: true, credit: true },
        },
      },
    });

    let totalDebits = 0;
    let totalCredits = 0;

    const rows = accounts.map((acct) => {
      const debit  = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
      const credit = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
      totalDebits  += debit;
      totalCredits += credit;
      return {
        id: acct.id,
        code: acct.code,
        name: acct.name,
        type: acct.type,
        normalBalance: acct.normalBalance,
        debit,
        credit,
        balance: acct.normalBalance === 'DEBIT' ? debit - credit : credit - debit,
      };
    });

    return { rows, totalDebits, totalCredits, isBalanced: Math.abs(totalDebits - totalCredits) < 0.01 };
  }

  // ── P&L Summary ──────────────────────────────────────────────────────────────

  async getPLSummary(tenantId: string, from: string, to: string) {
    const accounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true, type: { in: ['REVENUE', 'EXPENSE'] } },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: {
        journalLines: {
          where: {
            journalEntry: {
              tenantId,
              status: 'POSTED',
              date: { gte: new Date(from), lte: new Date(to) },
            },
          },
          select: { debit: true, credit: true },
        },
      },
    });

    let totalRevenue = 0;
    let totalExpenses = 0;

    const revenueAccounts: { id: string; code: string; name: string; balance: number }[] = [];
    const expenseAccounts: { id: string; code: string; name: string; balance: number }[] = [];

    for (const acct of accounts) {
      const debit  = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
      const credit = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
      const balance = acct.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
      const row = { id: acct.id, code: acct.code, name: acct.name, balance };

      if (acct.type === 'REVENUE') {
        revenueAccounts.push(row);
        totalRevenue += balance;
      } else {
        expenseAccounts.push(row);
        totalExpenses += balance;
      }
    }

    return {
      from,
      to,
      revenueAccounts,
      expenseAccounts,
      totalRevenue,
      totalExpenses,
      netIncome: totalRevenue - totalExpenses,
    };
  }
}
