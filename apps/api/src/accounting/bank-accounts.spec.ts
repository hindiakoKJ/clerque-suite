/**
 * Cash accounts (cash on hand, petty cash, the bank accounts) vs. the rest of
 * the asset side. `isBankAccount` is pinned in close-checklist.bank-recon.spec.
 */
import { isCashAccount, cashAccountWhere, isBankAccount } from './bank-accounts';

describe('isCashAccount', () => {
  it.each([
    ['1010', 'Cash on Hand',                   true],
    ['1011', 'Petty Cash Fund',                true],
    ['1020', 'Cash in Bank – Current Account', true],
    ['1022', 'Cash in Bank – Payroll Account', true],
    ['1025', 'Cash Equivalents',               true],
    ['1005', 'Petty Cash – Kitchen',           true],   // a shop's own numbering, named for what it is
    ['1030', 'Accounts Receivable – Trade',    false],
    ['1031', 'Digital Wallet Receivable',      false],  // feels like cash; is a receivable until settled
    ['1051', 'Raw Materials Inventory',        false],
    ['1075', 'Machinery & Equipment',          false],
    ['1090', 'Goodwill',                       false],
  ])('%s %s → %s', (code, name, expected) => {
    expect(isCashAccount({ code, name, type: 'ASSET' })).toBe(expected);
  });

  it('every bank account is a cash account, but cash on hand is not a bank account', () => {
    expect(isCashAccount({ code: '1020', name: 'Cash in Bank – Current Account', type: 'ASSET' })).toBe(true);
    expect(isBankAccount({ code: '1020', name: 'Cash in Bank – Current Account', type: 'ASSET' })).toBe(true);
    expect(isCashAccount({ code: '1010', name: 'Cash on Hand', type: 'ASSET' })).toBe(true);
    expect(isBankAccount({ code: '1010', name: 'Cash on Hand', type: 'ASSET' })).toBe(false);
  });

  it('a liability is never cash, whatever it is called', () => {
    expect(isCashAccount({ code: '2071', name: 'Bank Loans – Short-term', type: 'LIABILITY' })).toBe(false);
  });
});

describe('cashAccountWhere', () => {
  it('is the same rule as a Prisma filter', () => {
    expect(cashAccountWhere()).toEqual({
      type: 'ASSET',
      OR: [
        { code: { gte: '1000', lt: '1030' } },
        { name: { contains: 'cash on hand', mode: 'insensitive' } },
        { name: { contains: 'petty cash',   mode: 'insensitive' } },
        { name: { contains: 'cash in bank', mode: 'insensitive' } },
      ],
    });
  });
});
