/**
 * Period-close checklist — the bank reconciliation check counts BANK accounts
 * the shop actually uses, not every asset account.
 *
 * Before: `code startsWith '10'` matched all 55 seeded asset accounts. The
 * check read "0 of 55 bank accounts reconciled", and once the owner reconciled
 * her one real bank account it turned FAIL (1 of 55) and blocked the close.
 */
import { AccountingPeriodsService } from './accounting-periods.service';
import { isBankAccount } from '../accounting/bank-accounts';

function build(opts: { bankAccounts: Array<{ id: string; code: string; name: string }>; reconciledIds: string[] }) {
  const accountFindMany = jest.fn().mockResolvedValue(opts.bankAccounts);
  const prisma: any = {
    accountingPeriod: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'p1', tenantId: 't1', name: 'September 2026',
        startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30'), status: 'OPEN',
      }),
    },
    shift:           { count: jest.fn().mockResolvedValue(0) },
    aPBill:          { count: jest.fn().mockResolvedValue(0) },
    aRInvoice:       { count: jest.fn().mockResolvedValue(0) },
    expenseClaim:    { count: jest.fn().mockResolvedValue(0) },
    accountingEvent: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    orderItem:       { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    journalEntry:    { count: jest.fn().mockResolvedValue(0) },
    journalLine:     { aggregate: jest.fn().mockResolvedValue({ _sum: { debit: 100, credit: 100 } }) },
    account:         { findMany: accountFindMany },
    bankReconciliation: {
      findFirst: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(opts.reconciledIds.includes(where.accountId) ? { id: 'r1' } : null)),
    },
  };
  const svc = new AccountingPeriodsService(prisma, { log: jest.fn() } as never);
  return { svc, accountFindMany };
}

const bankCheck = async (svc: AccountingPeriodsService) =>
  (await svc.getCloseChecklist('t1', 'p1')).checks.find((c) => c.id === 'bank-recon')!;

describe('close checklist — bank reconciliation', () => {
  it('asks only for bank accounts that have entries, never "every account starting with 10"', async () => {
    const { svc, accountFindMany } = build({ bankAccounts: [], reconciledIds: [] });
    await bankCheck(svc);

    const where = accountFindMany.mock.calls[0][0].where;
    expect(where.code).toBeUndefined();               // the old startsWith('10') is gone
    expect(where.type).toBe('ASSET');
    expect(where.OR).toEqual([
      { code: { gte: '1020', lt: '1030' } },
      { name: { contains: 'cash in bank', mode: 'insensitive' } },
    ]);
    expect(where.journalLines.some.journalEntry.status).toBe('POSTED');
  });

  it('PASSES once the one bank account the shop uses is reconciled', async () => {
    const { svc } = build({
      bankAccounts:  [{ id: 'a1020', code: '1020', name: 'Cash in Bank – Current Account' }],
      reconciledIds: ['a1020'],
    });
    const c = await bankCheck(svc);
    expect(c.status).toBe('PASS');
    expect(c.hint).toBe('1 of 1 bank account reconciled.');
  });

  it('is a manual item (not a blocker) while nothing is reconciled yet, and names what is left', async () => {
    const { svc } = build({
      bankAccounts:  [{ id: 'a1020', code: '1020', name: 'Cash in Bank – Current Account' }],
      reconciledIds: [],
    });
    const c = await bankCheck(svc);
    expect(c.status).toBe('MANUAL');
    expect(c.hint).toContain('Still to do: 1020 Cash in Bank – Current Account');
  });

  it('is not applicable when no bank account has any entries', async () => {
    const { svc } = build({ bankAccounts: [], reconciledIds: [] });
    const c = await bankCheck(svc);
    expect(c.status).toBe('N_A');
  });
});

describe('isBankAccount', () => {
  it.each([
    ['1020', 'Cash in Bank – Current Account', true],
    ['1021', 'Cash in Bank – Savings Account', true],
    ['1023', 'BDO Savings',                    true],
    ['1015', 'Cash in Bank – BPI',             true],
    ['1010', 'Cash on Hand',                   false],
    ['1011', 'Petty Cash Fund',                false],
    ['1030', 'Accounts Receivable – Trade',    false],
    ['1031', 'Digital Wallet Receivable',      false],
    ['1051', 'Raw Materials Inventory',        false],
    ['1077', 'Furniture & Fixtures',           false],
  ])('%s %s → %s', (code, name, expected) => {
    expect(isBankAccount({ code, name, type: 'ASSET' })).toBe(expected);
  });

  it('a liability is never a bank account, whatever it is called', () => {
    expect(isBankAccount({ code: '2071', name: 'Bank Loans – Short-term', type: 'LIABILITY' })).toBe(false);
  });
});
