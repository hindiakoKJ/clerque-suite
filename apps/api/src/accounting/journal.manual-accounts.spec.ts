/**
 * JournalService.create — every account on an entry must be the shop's own.
 *
 * All shops share one database. assertPostingControl only inspects the
 * accounts it finds inside the shop, so an id from another shop used to be
 * "not found", pass the guard, and be written onto the line as given
 * (KNOWN-2). Journal templates post through this same create(), so this also
 * covers entries the nightly template job makes.
 */
import { ForbiddenException } from '@nestjs/common';
import { JournalService } from './journal.service';

const SHOP_A = 'tenant-a';
const SHOP_B = 'tenant-b';

// A tiny two-shop chart of accounts.
const ACCOUNTS = [
  { id: 'a-cash', tenantId: SHOP_A, code: '1010', name: 'Cash on Hand', postingControl: 'OPEN' },
  { id: 'a-rent', tenantId: SHOP_A, code: '6010', name: 'Rent Expense', postingControl: 'OPEN' },
  { id: 'b-cash', tenantId: SHOP_B, code: '1010', name: 'Cash on Hand', postingControl: 'OPEN' },
];

function inShop(where: any) {
  return ACCOUNTS.filter((a) => where.id.in.includes(a.id) && a.tenantId === where.tenantId);
}

function makePrisma() {
  return {
    account: {
      count:    jest.fn(async ({ where }: any) => inShop(where).length),
      findMany: jest.fn(async ({ where }: any) => inShop(where)),
    },
    tenant: { findUnique: jest.fn().mockResolvedValue({ jeApprovalThreshold: 0 }) },
    journalEntry: {
      create: jest.fn(async ({ data }: any) => ({ id: 'je-1', ...data })),
    },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  return new JournalService(
    prisma as any,
    {} as any,                                                      // AccountsService (unused by create)
    { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) } as any,
    { next: jest.fn().mockResolvedValue('JE-202610-0001') } as any,
  );
}

function entry(lines: Array<{ accountId: string; debit?: number; credit?: number }>) {
  return { date: '2026-10-21', description: 'Monthly rent', lines };
}

describe('JournalService.create — accounts must be in the shop', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: JournalService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = makeService(prisma);
  });

  it("refuses a manual entry with a line on another shop's account, and writes nothing", async () => {
    await expect(svc.create(SHOP_A, entry([
      { accountId: 'a-rent', debit: 100 },
      { accountId: 'b-cash', credit: 100 },
    ]), 'user-a')).rejects.toThrow(
      new ForbiddenException('One or more accounts on this entry are not in your shop.'),
    );
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  it('refuses an account id that exists in no shop the same way (nothing to tell them apart)', async () => {
    const foreign = await svc.create(SHOP_A, entry([
      { accountId: 'a-rent', debit: 100 }, { accountId: 'b-cash', credit: 100 },
    ])).catch((e) => e);
    const missing = await svc.create(SHOP_A, entry([
      { accountId: 'a-rent', debit: 100 }, { accountId: 'no-such-acct', credit: 100 },
    ])).catch((e) => e);
    expect(foreign).toBeInstanceOf(ForbiddenException);
    expect(missing).toBeInstanceOf(ForbiddenException);
    expect(foreign.message).toBe(missing.message);
  });

  it('refuses it for sub-ledger sources too, since the lines are written as given', async () => {
    await expect(svc.create(SHOP_A, entry([
      { accountId: 'b-cash', debit: 100 }, { accountId: 'a-cash', credit: 100 },
    ]), 'user-a', 'AP')).rejects.toThrow(ForbiddenException);
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  it("still posts the shop's own entry exactly as before", async () => {
    const je = await svc.create(SHOP_A, entry([
      { accountId: 'a-rent', debit: 100 },
      { accountId: 'a-cash', credit: 100 },
    ]), 'user-a');

    expect(prisma.account.count).toHaveBeenCalledWith({
      where: { id: { in: ['a-rent', 'a-cash'] }, tenantId: SHOP_A },
    });
    expect(je).toMatchObject({ tenantId: SHOP_A, status: 'POSTED', source: 'MANUAL' });
    const lines = prisma.journalEntry.create.mock.calls[0][0].data.lines.create;
    expect(lines.map((l: any) => l.accountId)).toEqual(['a-rent', 'a-cash']);
  });

  it('counts an account used on two lines once, so a same-account entry is not refused', async () => {
    await svc.create(SHOP_A, entry([
      { accountId: 'a-cash', debit: 50 },
      { accountId: 'a-cash', credit: 50 },
    ]), 'user-a');
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(1);
  });
});
