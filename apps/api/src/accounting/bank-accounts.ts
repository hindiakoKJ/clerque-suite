/**
 * Which chart-of-accounts rows are BANK accounts.
 *
 * The chart has no "is a bank account" flag, and the whole seeded asset side
 * sits in 1010–1099 — so the old test `code startsWith '10'` matched all 55
 * asset accounts (Accounts Receivable, Inventory, Furniture, Goodwill …). The
 * period-close checklist then read "0 of 55 bank accounts reconciled", and the
 * moment an owner reconciled her one real bank account it flipped to FAIL and
 * blocked the close.
 *
 * A bank account is an ASSET that is either
 *   - coded 1020–1029 (seeded: 1020 Current, 1021 Savings, 1022 Payroll,
 *     1025 Cash Equivalents; a shop's own "1023 BDO Savings" lands here too), or
 *   - named "Cash in Bank …" (a shop that numbered its own bank account
 *     somewhere else).
 *
 * Cash on Hand (1010) and Petty Cash (1011) are NOT bank accounts — they are
 * checked by a cash count, not against a bank statement. The Digital Wallet
 * Receivable (1031) is cleared on the Settlement page.
 */
import type { Prisma } from '@prisma/client';

const BANK_CODE_FROM = '1020';
const BANK_CODE_TO_EXCLUSIVE = '1030';
const BANK_NAME = 'cash in bank';

export function isBankAccount(a: { code: string; name?: string | null; type?: string | null }): boolean {
  if (a.type != null && a.type !== 'ASSET') return false;
  const code = (a.code ?? '').trim();
  if (code >= BANK_CODE_FROM && code < BANK_CODE_TO_EXCLUSIVE) return true;
  return (a.name ?? '').toLowerCase().includes(BANK_NAME);
}

/** The same rule as a Prisma filter. Spread into an `account` where clause. */
export function bankAccountWhere(): Prisma.AccountWhereInput {
  return {
    type: 'ASSET',
    OR: [
      { code: { gte: BANK_CODE_FROM, lt: BANK_CODE_TO_EXCLUSIVE } },
      { name: { contains: BANK_NAME, mode: 'insensitive' } },
    ],
  };
}

/**
 * CASH accounts — cash on hand, petty cash and every bank account: the rows a
 * "Cash Position" or a "Cash & Cash Equivalents" line is made of. Seeded:
 * 1010 Cash on Hand, 1011 Petty Cash, 1020–1022 Cash in Bank, 1025 Cash
 * Equivalents — i.e. the 1000–1029 band the cash-flow statement already uses.
 * Receivables start at 1030 and are NOT cash, however a digital wallet feels.
 *
 * The Cash Position export used `code startsWith '10'`, so its "TOTAL CASH"
 * added up receivables, inventory, furniture and goodwill.
 */
const CASH_CODE_FROM = '1000';
const CASH_NAMES = ['cash on hand', 'petty cash', BANK_NAME] as const;

export function isCashAccount(a: { code: string; name?: string | null; type?: string | null }): boolean {
  if (a.type != null && a.type !== 'ASSET') return false;
  const code = (a.code ?? '').trim();
  if (code >= CASH_CODE_FROM && code < BANK_CODE_TO_EXCLUSIVE) return true;
  const name = (a.name ?? '').toLowerCase();
  return CASH_NAMES.some((n) => name.includes(n));
}

/** The same rule as a Prisma filter. Spread into an `account` where clause. */
export function cashAccountWhere(): Prisma.AccountWhereInput {
  return {
    type: 'ASSET',
    OR: [
      { code: { gte: CASH_CODE_FROM, lt: BANK_CODE_TO_EXCLUSIVE } },
      ...CASH_NAMES.map((n) => ({ name: { contains: n, mode: 'insensitive' as const } })),
    ],
  };
}
