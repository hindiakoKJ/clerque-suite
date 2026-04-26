import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountType, NormalBalance, PostingControl } from '@prisma/client';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
export { CreateAccountDto, UpdateAccountDto };

// ── Standard PH chart of accounts (seeded on tenant onboard) ──────────────────

export const DEFAULT_ACCOUNTS: Omit<CreateAccountDto & { isSystem: boolean }, 'parentId'>[] = [
  // Assets — Cash & Bank
  { code: '1010', name: 'Cash on Hand',                     type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: true  },
  { code: '1020', name: 'Cash in Bank',                     type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: true  },
  // Assets — Receivables
  { code: '1030', name: 'Accounts Receivable',              type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'AR_ONLY',     isSystem: true  },
  { code: '1031', name: 'Digital Wallet Receivable',        type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'SYSTEM_ONLY', isSystem: true  },
  // Assets — VAT
  { code: '1040', name: 'Input VAT',                        type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  // Assets — Inventory
  { code: '1050', name: 'Merchandise Inventory',            type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: true  },
  // Assets — Prepaid
  { code: '1060', name: 'Prepaid Expenses',                 type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  // Assets — Fixed
  { code: '1070', name: 'Property, Plant & Equipment',      type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1071', name: 'Accumulated Depreciation',         type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  // Liabilities — Payables
  { code: '2010', name: 'Accounts Payable',                 type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'AP_ONLY',     isSystem: false },
  { code: '2020', name: 'Output VAT Payable',               type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'SYSTEM_ONLY', isSystem: true  },
  { code: '2030', name: 'SSS Contributions Payable',        type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2040', name: 'PhilHealth Contributions Payable', type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2050', name: 'Pag-IBIG Contributions Payable',   type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2060', name: 'Withholding Tax Payable',          type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2070', name: 'Loans Payable',                    type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2080', name: 'Accrued Liabilities',              type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  // Equity
  { code: '3010', name: "Owner's Capital",                  type: 'EQUITY',    normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '3020', name: "Owner's Drawing",                  type: 'EQUITY',    normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '3030', name: 'Retained Earnings',                type: 'EQUITY',    normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  // Revenue — locked to system/AR
  { code: '4010', name: 'Sales Revenue',                    type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'SYSTEM_ONLY', isSystem: true  },
  { code: '4020', name: 'Sales Discounts',                  type: 'REVENUE',   normalBalance: 'DEBIT',  postingControl: 'SYSTEM_ONLY', isSystem: true  },
  { code: '4030', name: 'Sales Returns & Allowances',       type: 'REVENUE',   normalBalance: 'DEBIT',  postingControl: 'SYSTEM_ONLY', isSystem: false },
  { code: '4040', name: 'Service Revenue',                  type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '4050', name: 'Other Income',                     type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  // COGS — locked to system
  { code: '5010', name: 'Cost of Goods Sold',               type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'SYSTEM_ONLY', isSystem: true  },
  // Expenses — all OPEN for manual JEs
  { code: '6010', name: 'Salaries and Wages',               type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6020', name: 'SSS Employer Contribution',        type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6030', name: 'PhilHealth Employer Contribution', type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6040', name: 'Pag-IBIG Employer Contribution',   type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6050', name: 'Rent Expense',                     type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6060', name: 'Utilities Expense',                type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6070', name: 'Office Supplies Expense',          type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6080', name: 'Depreciation Expense',             type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6090', name: 'Repairs and Maintenance',          type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6100', name: 'Transportation and Travel',        type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6110', name: 'Communication Expense',            type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6120', name: 'Insurance Expense',                type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6130', name: 'Advertising Expense',              type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6140', name: 'Miscellaneous Expense',            type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
];

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  // ── Seed defaults for a new tenant ──────────────────────────────────────────

  async seedDefaultAccounts(tenantId: string): Promise<void> {
    const existing = await this.prisma.account.count({ where: { tenantId } });
    if (existing > 0) return;

    await this.prisma.account.createMany({
      data: DEFAULT_ACCOUNTS.map((a) => ({ ...a, tenantId })),
      skipDuplicates: true,
    });
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async findAll(tenantId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { tenantId },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: { parent: { select: { id: true, code: true, name: true } } },
    });

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
        parent:   { select: { id: true, code: true, name: true } },
        children: { select: { id: true, code: true, name: true, isActive: true } },
      },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async findByCode(tenantId: string, code: string) {
    return this.prisma.account.findUnique({ where: { tenantId_code: { tenantId, code } } });
  }

  // ── Write (Super Admin only — enforced at controller layer) ─────────────────

  async create(tenantId: string, dto: CreateAccountDto) {
    const existing = await this.prisma.account.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Account code ${dto.code} already exists`);
    return this.prisma.account.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateAccountDto) {
    const account = await this.prisma.account.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.isSystem && dto.postingControl !== undefined) {
      throw new ForbiddenException('Posting control on system accounts cannot be changed');
    }
    return this.prisma.account.update({ where: { id }, data: dto });
  }

  async delete(tenantId: string, id: string) {
    const account = await this.prisma.account.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.isSystem) throw new ForbiddenException('System accounts cannot be deleted');

    const usedInLines = await this.prisma.journalLine.count({ where: { accountId: id } });
    if (usedInLines > 0) {
      throw new ConflictException('Account has journal entries and cannot be deleted. Deactivate it instead.');
    }
    return this.prisma.account.delete({ where: { id } });
  }

  // ── Trial Balance ────────────────────────────────────────────────────────────

  async getTrialBalance(tenantId: string, asOf?: string) {
    // Use postingDate for period filtering; fall back to document date for legacy entries.
    const asOfDate  = asOf ? new Date(asOf) : undefined;
    const jeFilter: Record<string, unknown> = { tenantId, status: 'POSTED' };
    if (asOfDate) {
      jeFilter['OR'] = [
        { postingDate: { lte: asOfDate } },
        { postingDate: null, date: { lte: asOfDate } },
      ];
    }

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: {
        journalLines: {
          where: { journalEntry: jeFilter as any },
          select: { debit: true, credit: true },
        },
      },
    });

    let totalDebits = 0;
    let totalCredits = 0;

    const rows = accounts
      .map((acct) => {
        const debit  = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
        const credit = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
        totalDebits  += debit;
        totalCredits += credit;
        return {
          id:             acct.id,
          code:           acct.code,
          name:           acct.name,
          type:           acct.type,
          normalBalance:  acct.normalBalance,
          postingControl: acct.postingControl,
          debit,
          credit,
          balance: acct.normalBalance === 'DEBIT' ? debit - credit : credit - debit,
        };
      })
      .filter((r) => r.debit > 0 || r.credit > 0); // omit zero-balance accounts

    return { rows, totalDebits, totalCredits, isBalanced: Math.abs(totalDebits - totalCredits) < 0.01 };
  }

  // ── General Ledger (per-account history) ─────────────────────────────────────

  async getAccountLedger(
    tenantId: string,
    accountId: string,
    opts: { from?: string; to?: string; page?: number },
  ) {
    const { from, to, page = 1 } = opts;
    const take = 50;
    const skip = (page - 1) * take;

    const account = await this.findOne(tenantId, accountId);

    // Use postingDate for period filtering; fall back to document date for legacy entries.
    const dateRange = (from || to) ? {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    } : undefined;

    const jeFilter: Record<string, unknown> = { tenantId, status: 'POSTED' as const };
    if (dateRange) {
      jeFilter['OR'] = [
        { postingDate: dateRange },
        { postingDate: null, date: dateRange },
      ];
    }

    const where = {
      accountId,
      journalEntry: jeFilter as any,
    };

    const [total, lines] = await Promise.all([
      this.prisma.journalLine.count({ where }),
      this.prisma.journalLine.findMany({
        where,
        orderBy: { journalEntry: { postingDate: 'asc' } },
        skip,
        take,
        include: {
          journalEntry: {
            select: {
              id:          true,
              entryNumber: true,
              date:        true,
              postingDate: true,
              description: true,
              reference:   true,
              source:      true,
            },
          },
        },
      }),
    ]);

    // Compute running balance; order is by postingDate asc (set in orderBy above)
    let runningBalance = 0;
    const rows = lines.map((l) => {
      const dr = Number(l.debit);
      const cr = Number(l.credit);
      runningBalance += account.normalBalance === 'DEBIT' ? dr - cr : cr - dr;
      return {
        id:            l.id,
        documentDate:  l.journalEntry.date,
        postingDate:   l.journalEntry.postingDate ?? l.journalEntry.date,
        entryNumber:   l.journalEntry.entryNumber,
        entryId:       l.journalEntry.id,
        description:   l.description ?? l.journalEntry.description,
        reference:     l.journalEntry.reference,
        source:        l.journalEntry.source,
        debit:         dr,
        credit:        cr,
        runningBalance,
      };
    });

    return {
      account: {
        id:            account.id,
        code:          account.code,
        name:          account.name,
        type:          account.type,
        normalBalance: account.normalBalance,
      },
      rows,
      total,
      page,
      pages: Math.ceil(total / take),
    };
  }

  // ── P&L Summary ──────────────────────────────────────────────────────────────

  async getPLSummary(tenantId: string, from: string, to: string) {
    // Use postingDate for period filtering; fall back to document date for legacy entries.
    const dateRange = { gte: new Date(from), lte: new Date(to) };
    const plJeFilter = {
      tenantId,
      status: 'POSTED',
      OR: [
        { postingDate: dateRange },
        { postingDate: null, date: dateRange },
      ],
    };

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true, type: { in: ['REVENUE', 'EXPENSE'] } },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: {
        journalLines: {
          where: { journalEntry: plJeFilter as any },
          select: { debit: true, credit: true },
        },
      },
    });

    let totalRevenue = 0;
    let totalExpenses = 0;
    const revenueAccounts: { id: string; code: string; name: string; balance: number }[] = [];
    const expenseAccounts: { id: string; code: string; name: string; balance: number }[] = [];

    for (const acct of accounts) {
      const debit   = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
      const credit  = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
      const balance = acct.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
      const row = { id: acct.id, code: acct.code, name: acct.name, balance };
      if (acct.type === 'REVENUE') { revenueAccounts.push(row); totalRevenue  += balance; }
      else                         { expenseAccounts.push(row); totalExpenses += balance; }
    }

    return { from, to, revenueAccounts, expenseAccounts, totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses };
  }
}
