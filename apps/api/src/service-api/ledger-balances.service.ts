import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DAY_MS, manilaDayOf, manilaDayStart } from '../ingredient-reports/daily-usage';
import { money2, requireDay } from './format';

/** One question at a time is enough: a reviewer reads a handful of accounts. */
const MAX_ACCOUNTS = 50;

/**
 * GET /service/ledger/balances?accounts=1300,1301&asOf=YYYY-MM-DD
 *
 * Each account's balance from POSTED entries up to the end of `asOf` (Manila
 * day), on its normal side -- the same rule as the trial balance: an entry
 * counts by its posting date, or its document date when it has none. Drafts,
 * entries waiting for approval and voided entries are not the books and are
 * left out.
 *
 * Accounts are named by code and looked up inside the key's own tenant only,
 * so another tenant's chart is unreachable. A code the tenant does not have
 * is refused by name rather than answered with a zero that looks real.
 */
@Injectable()
export class LedgerBalancesService {
  constructor(private readonly prisma: PrismaService) {}

  async balances(tenantId: string, query: { accounts?: unknown; asOf?: unknown }, now: Date = new Date()) {
    const raw = typeof query.accounts === 'string' ? query.accounts : '';
    const codes = [...new Set(raw.split(',').map((c) => c.trim()).filter(Boolean))];
    if (!codes.length) throw new BadRequestException('accounts is required: account codes separated by commas.');
    if (codes.length > MAX_ACCOUNTS) throw new BadRequestException(`Ask for at most ${MAX_ACCOUNTS} accounts at a time.`);
    if (codes.some((c) => !/^[A-Za-z0-9._-]{1,32}$/.test(c))) {
      throw new BadRequestException('An account code may only hold letters, digits, dot, dash and underscore.');
    }
    const asOf = query.asOf == null || query.asOf === '' ? manilaDayOf(now) : requireDay(query.asOf, 'asOf');
    const cutoff = new Date(manilaDayStart(asOf).getTime() + DAY_MS - 1);

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, code: { in: codes } },
      select: { id: true, code: true, name: true, normalBalance: true },
    });
    const unknown = codes.filter((c) => !accounts.some((a) => a.code === c));
    if (unknown.length) throw new BadRequestException(`Unknown account code(s): ${unknown.join(', ')}.`);

    const sums = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        journalEntry: {
          tenantId,
          status: 'POSTED',
          OR: [
            { postingDate: { lte: cutoff } },
            { postingDate: null, date: { lte: cutoff } },
          ],
        },
      },
      _sum: { debit: true, credit: true },
    });
    const byId = new Map(sums.map((s) => [s.accountId, s._sum]));

    return {
      asOf,
      // In the order asked for.
      accounts: codes.map((code) => {
        const a = accounts.find((x) => x.code === code)!;
        const s = byId.get(a.id);
        const debit = new Prisma.Decimal(s?.debit ?? 0);
        const credit = new Prisma.Decimal(s?.credit ?? 0);
        const balance = a.normalBalance === 'DEBIT' ? debit.minus(credit) : credit.minus(debit);
        return { code: a.code, name: a.name, balance: money2(balance) };
      }),
    };
  }
}
