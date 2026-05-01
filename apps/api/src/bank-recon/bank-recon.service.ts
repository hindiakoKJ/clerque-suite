/**
 * BankReconciliationService — bank statement to GL matching.
 *
 * Workflow:
 *   1. User picks a cash/bank GL account + period
 *   2. Service returns all unreconciled JE lines for that account in the period
 *   3. User uploads / pastes bank statement lines (CSV)
 *   4. User manually matches each statement line to one or more JE lines
 *   5. System saves the reconciliation; unmatched items become "outstanding"
 *      checks (we recorded but bank hasn't cleared) or "deposits in transit"
 *      (bank received but we haven't booked).
 *
 * Until LLM-assisted auto-match is added, matching is manual.
 */

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface StatementLineInput {
  date:        string;   // ISO date
  description: string;
  amount:      number;   // positive = credit (deposit), negative = debit (withdrawal)
}

interface SaveItemInput {
  itemType:        'STATEMENT' | 'JE_LINE' | 'MATCHED';
  statementDate?:  string;
  statementDesc?:  string;
  statementAmount?: number;
  journalLineId?:  string;
  isMatched?:      boolean;
  notes?:          string;
}

@Injectable()
export class BankReconciliationService {
  constructor(private prisma: PrismaService) {}

  /** List all reconciliations for the tenant (recent first). */
  async list(tenantId: string) {
    return this.prisma.bankReconciliation.findMany({
      where: { tenantId },
      orderBy: { periodEnd: 'desc' },
      include: {
        account:    { select: { code: true, name: true } },
        preparedBy: { select: { name: true } },
        _count:     { select: { items: true } },
      },
    });
  }

  /** Return a draft reconciliation worksheet — fetch JE lines for the account in the period. */
  async draft(
    tenantId: string,
    accountId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    const acct = await this.prisma.account.findFirst({
      where: { id: accountId, tenantId },
      select: { id: true, code: true, name: true, normalBalance: true },
    });
    if (!acct) throw new NotFoundException('Account not found.');

    const from = new Date(periodStart);
    const to   = new Date(periodEnd);
    to.setHours(23, 59, 59, 999);

    // Fetch every JE line on this account, posted, within the period
    const jeLines = await this.prisma.journalLine.findMany({
      where: {
        accountId,
        journalEntry: {
          tenantId,
          status: 'POSTED',
          OR: [
            { postingDate: { gte: from, lte: to } },
            { postingDate: null, date: { gte: from, lte: to } },
          ],
        },
      },
      include: {
        journalEntry: { select: { entryNumber: true, date: true, postingDate: true, description: true } },
      },
      orderBy: { journalEntry: { date: 'asc' } },
    });

    // GL balance for this account up to periodEnd
    const allLinesUpTo = await this.prisma.journalLine.aggregate({
      where: {
        accountId,
        journalEntry: {
          tenantId,
          status: 'POSTED',
          OR: [
            { postingDate: { lte: to } },
            { postingDate: null, date: { lte: to } },
          ],
        },
      },
      _sum: { debit: true, credit: true },
    });
    const totalDebit  = Number(allLinesUpTo._sum.debit  ?? 0);
    const totalCredit = Number(allLinesUpTo._sum.credit ?? 0);
    const glBalance = acct.normalBalance === 'DEBIT' ? totalDebit - totalCredit : totalCredit - totalDebit;

    return {
      account: acct,
      periodStart, periodEnd,
      glBalance,
      jeLines: jeLines.map((l) => ({
        id:           l.id,
        date:         l.journalEntry.postingDate ?? l.journalEntry.date,
        entryNumber:  l.journalEntry.entryNumber,
        description:  l.description ?? l.journalEntry.description,
        debit:        Number(l.debit),
        credit:       Number(l.credit),
        signedAmount: acct.normalBalance === 'DEBIT'
          ? Number(l.debit) - Number(l.credit)
          : Number(l.credit) - Number(l.debit),
      })),
    };
  }

  /** Create / update a reconciliation. */
  async upsert(
    tenantId: string,
    userId: string,
    args: {
      id?:           string;
      accountId:     string;
      periodStart:   string;
      periodEnd:     string;
      bankBalance:   number;
      glBalance:     number;
      notes?:        string;
      items:         SaveItemInput[];
      complete?:     boolean;
    },
  ) {
    if (!args.accountId) throw new BadRequestException('accountId is required.');

    const matchedAmount = args.items
      .filter((i) => i.isMatched && i.statementAmount != null)
      .reduce((s, i) => s + Math.abs(Number(i.statementAmount)), 0);

    return this.prisma.$transaction(async (tx) => {
      const recon = args.id
        ? await tx.bankReconciliation.update({
            where: { id: args.id },
            data: {
              periodStart:   new Date(args.periodStart),
              periodEnd:     new Date(args.periodEnd),
              bankBalance:   args.bankBalance,
              glBalance:     args.glBalance,
              matchedAmount,
              notes:         args.notes,
              status:        args.complete ? 'COMPLETED' : 'IN_PROGRESS',
              completedAt:   args.complete ? new Date() : null,
            },
          })
        : await tx.bankReconciliation.create({
            data: {
              tenantId,
              accountId:    args.accountId,
              periodStart:  new Date(args.periodStart),
              periodEnd:    new Date(args.periodEnd),
              bankBalance:  args.bankBalance,
              glBalance:    args.glBalance,
              matchedAmount,
              notes:        args.notes,
              preparedById: userId,
              status:       args.complete ? 'COMPLETED' : 'IN_PROGRESS',
              completedAt:  args.complete ? new Date() : null,
            },
          });

      // Replace items wholesale (simpler than diffing for an MVP)
      await tx.bankReconciliationItem.deleteMany({ where: { reconciliationId: recon.id } });
      if (args.items.length > 0) {
        await tx.bankReconciliationItem.createMany({
          data: args.items.map((it) => ({
            reconciliationId: recon.id,
            itemType:         it.itemType,
            statementDate:    it.statementDate ? new Date(it.statementDate) : null,
            statementDesc:    it.statementDesc ?? null,
            statementAmount:  it.statementAmount ?? null,
            journalLineId:    it.journalLineId ?? null,
            isMatched:        it.isMatched ?? false,
            notes:            it.notes ?? null,
          })),
        });
      }
      return recon;
    });
  }

  /** Get a saved reconciliation with all items. */
  async findOne(tenantId: string, id: string) {
    const recon = await this.prisma.bankReconciliation.findFirst({
      where:   { id, tenantId },
      include: {
        account:    { select: { code: true, name: true } },
        preparedBy: { select: { name: true } },
        items:      { orderBy: { statementDate: 'asc' } },
      },
    });
    if (!recon) throw new NotFoundException('Reconciliation not found.');
    return recon;
  }
}
