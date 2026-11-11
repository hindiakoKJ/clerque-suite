import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LedgerBalancesService } from './ledger-balances.service';

describe('LedgerBalancesService', () => {
  const T = 't1';
  function build(accounts: any[], sums: any[]) {
    const prisma: any = {
      account: { findMany: jest.fn().mockResolvedValue(accounts) },
      journalLine: { groupBy: jest.fn().mockResolvedValue(sums) },
    };
    return { prisma, svc: new LedgerBalancesService(prisma) };
  }
  const inv = { id: 'a1', code: '1300', name: 'Inventory - Raw materials', normalBalance: 'DEBIT' };
  const ap = { id: 'a2', code: '2010', name: 'Accounts Payable', normalBalance: 'CREDIT' };

  it('answers each account on its normal side, pesos as strings with 2 decimals, in the order asked', async () => {
    const { svc } = build([inv, ap], [
      { accountId: 'a1', _sum: { debit: new Prisma.Decimal('50000.5'), credit: new Prisma.Decimal('1790') } },
      { accountId: 'a2', _sum: { debit: new Prisma.Decimal('100'), credit: new Prisma.Decimal('2400.25') } },
    ]);
    await expect(svc.balances(T, { accounts: '2010,1300', asOf: '2026-11-30' })).resolves.toEqual({
      asOf: '2026-11-30',
      accounts: [
        { code: '2010', name: 'Accounts Payable', balance: '2300.25' },
        { code: '1300', name: 'Inventory - Raw materials', balance: '48210.50' },
      ],
    });
  });

  it('an account with no posted lines reads 0.00', async () => {
    const { svc } = build([inv], []);
    const r = await svc.balances(T, { accounts: '1300', asOf: '2026-11-30' });
    expect(r.accounts[0].balance).toBe('0.00');
  });

  it('looks accounts up in the key tenant only, and counts POSTED entries up to the end of the Manila day', async () => {
    const { prisma, svc } = build([inv], []);
    await svc.balances(T, { accounts: '1300', asOf: '2026-11-30' });
    expect(prisma.account.findMany.mock.calls[0][0].where).toEqual({ tenantId: T, code: { in: ['1300'] } });
    const where = prisma.journalLine.groupBy.mock.calls[0][0].where;
    expect(where.journalEntry.tenantId).toBe(T);
    expect(where.journalEntry.status).toBe('POSTED');
    expect(where.journalEntry.OR[0].postingDate.lte.toISOString()).toBe('2026-11-30T15:59:59.999Z');
  });

  it('refuses a code the tenant does not have, by name, instead of answering zero', async () => {
    const { svc } = build([inv], []);
    await expect(svc.balances(T, { accounts: '1300,9999', asOf: '2026-11-30' })).rejects.toThrow('Unknown account code(s): 9999.');
  });

  it.each([[{}], [{ accounts: '1300', asOf: '30/11/2026' }], [{ accounts: "1300'; drop" }]])('refuses %j', async (q) => {
    const { svc } = build([inv], []);
    await expect(svc.balances(T, q)).rejects.toThrow(BadRequestException);
  });
});
