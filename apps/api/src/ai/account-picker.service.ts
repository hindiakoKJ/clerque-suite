/**
 * AccountPickerService — context-aware ranking of Chart of Accounts entries
 * for the Journal Entry editor.
 *
 * NOT an LLM call. Pure ranking over the tenant's COA + history. Designed
 * to feel instant (sub-100ms) and to cost nothing per lookup. The LLM-backed
 * Drafter / Guide live in ai.controller.ts and use AiService.
 *
 * Ranking signal (in priority order):
 *   1. Recent-similar history     — accounts the user posted on JEs whose
 *                                   memo text overlaps with the current memo
 *   2. Token-overlap score        — simple bag-of-words score of memo against
 *                                   account name + code + description
 *   3. Side bias                  — debits favour expense/asset/contra-revenue
 *                                   accounts; credits favour revenue/liability/
 *                                   contra-asset accounts. Reduces false top-5
 *                                   when the memo is generic.
 *   4. Frequency boost            — accounts the user posts on most often get
 *                                   a small lift so common ones bubble up
 *
 * The output is a list of {accountId, score, reason} ordered by score, plus
 * an "alsoConsidered" list with the next 5 for a "Show all" expander.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'paid', 'received',
  'sale', 'sales', 'purchase', 'expense', 'amount', 'date', 'inv', 'or',
  'php', 'peso', 'pesos', 'cash', 'bank', 'check', 'cheque', 'a', 'an', 'to',
  'of', 'in', 'on', 'at', 'by', 'is', 'be', 'as', 'no', 'note',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export interface RankedAccount {
  accountId:     string;
  code:          string;
  name:          string;
  type:          string;
  normalBalance: 'DEBIT' | 'CREDIT';
  score:         number;
  reasons:       string[];
}

@Injectable()
export class AccountPickerService {
  constructor(private prisma: PrismaService) {}

  /**
   * Suggest the top accounts for the line the user is editing.
   *
   * @param tenantId    Caller's tenant.
   * @param memo        Free-text memo of the entry being drafted.
   * @param side        Whether this line is a debit or credit. Skews ranking
   *                    toward accounts whose normal balance matches.
   * @param excludeIds  Account ids already used in other lines of this entry —
   *                    excluded from the result.
   * @param limit       Top-N to return as primary suggestions. Default 5.
   *
   * Returns suggestions + alsoConsidered (next 5).
   */
  async suggest(
    tenantId: string,
    opts: {
      memo:        string;
      side:        'DEBIT' | 'CREDIT';
      excludeIds?: string[];
      limit?:      number;
    },
  ) {
    const limit = opts.limit ?? 5;
    const excludeSet = new Set(opts.excludeIds ?? []);
    const memoTokens = tokenize(opts.memo);

    // Pull active accounts. Cheap (~200 rows max for an MSME COA).
    const accounts = await this.prisma.account.findMany({
      where:  { tenantId, isActive: true },
      select: {
        id: true, code: true, name: true, type: true,
        normalBalance: true, description: true,
      },
    });

    // History signal: accounts used on the user's last 30 posted entries
    // where the memo overlaps with the current memo. We weigh older entries
    // less (linear decay).
    const recentEntries = memoTokens.length
      ? await this.prisma.journalEntry.findMany({
          where:   { tenantId, status: 'POSTED' },
          orderBy: { date: 'desc' },
          take:    30,
          select:  {
            description: true,
            lines: { select: { accountId: true } },
          },
        })
      : [];

    const historyBoost = new Map<string, number>();
    recentEntries.forEach((entry, idx) => {
      const entryTokens = tokenize(entry.description);
      if (entryTokens.length === 0) return;
      const overlap = memoTokens.filter((t) => entryTokens.includes(t)).length;
      if (overlap === 0) return;
      // Recency weight: newest gets full credit, decays linearly to 0.5 at idx 30.
      const recencyWeight = 1 - (idx / 60);
      const score = overlap * recencyWeight;
      for (const line of entry.lines) {
        historyBoost.set(line.accountId, (historyBoost.get(line.accountId) ?? 0) + score);
      }
    });

    // Frequency signal: how many lines this account has been used on overall.
    // Only fetch if we don't have a strong history match — keeps queries cheap.
    let frequency: Map<string, number> = new Map();
    if (historyBoost.size < 3 && memoTokens.length > 0) {
      const grouped = await this.prisma.journalLine.groupBy({
        by:    ['accountId'],
        where: { journalEntry: { tenantId, status: 'POSTED' } },
        _count: { accountId: true },
      });
      frequency = new Map(grouped.map((g) => [g.accountId, g._count.accountId]));
    }

    // Score every account.
    const ranked: RankedAccount[] = [];
    for (const a of accounts) {
      if (excludeSet.has(a.id)) continue;
      const reasons: string[] = [];
      let score = 0;

      // 1. History boost (strongest signal)
      const histScore = historyBoost.get(a.id) ?? 0;
      if (histScore > 0) {
        score += histScore * 5;
        reasons.push('used on similar past entries');
      }

      // 2. Token overlap on name + code + description
      const accountTokens = tokenize(`${a.code} ${a.name} ${a.description ?? ''}`);
      if (memoTokens.length > 0 && accountTokens.length > 0) {
        const overlap = memoTokens.filter((t) => accountTokens.includes(t)).length;
        if (overlap > 0) {
          score += overlap * 2;
          reasons.push(`name match (${overlap})`);
        }
      }

      // 3. Side bias
      const matchesSide = a.normalBalance === opts.side;
      // Debits feel right on EXPENSE / ASSET; credits on REVENUE / LIABILITY / EQUITY
      const sideMatchesType =
        (opts.side === 'DEBIT'  && (a.type === 'EXPENSE' || a.type === 'ASSET'))     ||
        (opts.side === 'CREDIT' && (a.type === 'REVENUE' || a.type === 'LIABILITY' || a.type === 'EQUITY'));
      if (matchesSide || sideMatchesType) {
        score += 0.5;
      }

      // 4. Frequency lift (only when history+name didn't already pick a clear winner)
      const freq = frequency.get(a.id) ?? 0;
      if (freq > 0) {
        // log-scale so a heavy account doesn't drown out a perfect match
        score += Math.min(0.5, Math.log10(1 + freq) / 4);
      }

      if (score === 0) continue;

      ranked.push({
        accountId:     a.id,
        code:          a.code,
        name:          a.name,
        type:          a.type,
        normalBalance: a.normalBalance,
        score:         Number(score.toFixed(3)),
        reasons,
      });
    }

    ranked.sort((a, b) => b.score - a.score);

    return {
      suggestions:     ranked.slice(0, limit),
      alsoConsidered:  ranked.slice(limit, limit + 5),
      memoTokens,                          // useful for debug / "show why"
      totalCandidates: ranked.length,
    };
  }
}
