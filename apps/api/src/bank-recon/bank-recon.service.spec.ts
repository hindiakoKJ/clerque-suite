/**
 * BankReconciliationService.upsert — shop isolation.
 *
 * Every shop shares one database, and the save body comes straight from the
 * browser. These tests prove that a reconciliation id, accountId or
 * journalLineId from another shop is refused before anything is written, and
 * that the same shop's own save still works exactly as before.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BankReconciliationService } from './bank-recon.service';

const SHOP_A = 'tenant-a';
const SHOP_B = 'tenant-b';
const USER_A = 'user-a';

// A tiny two-shop stand-in for the database.
const ACCOUNTS = [
  { id: 'acct-a-bank', tenantId: SHOP_A },
  { id: 'acct-b-bank', tenantId: SHOP_B },
];
// Journal lines have no tenantId; they belong to their journal entry's shop.
const JOURNAL_LINES = [
  { id: 'jl-a-1', journalEntry: { tenantId: SHOP_A } },
  { id: 'jl-a-2', journalEntry: { tenantId: SHOP_A } },
  { id: 'jl-b-1', journalEntry: { tenantId: SHOP_B } },
];
const RECONS = [
  { id: 'recon-a', tenantId: SHOP_A },
  { id: 'recon-b', tenantId: SHOP_B },
];

function makePrisma() {
  const tx = {
    bankReconciliation: {
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: 'recon-new', ...data })),
    },
    bankReconciliationItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    account: {
      findFirst: jest.fn(async ({ where }: any) =>
        ACCOUNTS.find((a) => a.id === where.id && a.tenantId === where.tenantId) ?? null),
    },
    journalLine: {
      count: jest.fn(async ({ where }: any) =>
        JOURNAL_LINES.filter((l) =>
          where.id.in.includes(l.id) && l.journalEntry.tenantId === where.journalEntry.tenantId,
        ).length),
    },
    bankReconciliation: {
      findFirst: jest.fn(async ({ where }: any) =>
        RECONS.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  return { prisma, tx };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    accountId:   'acct-a-bank',
    periodStart: '2026-09-01',
    periodEnd:   '2026-09-30',
    bankBalance: 1000,
    glBalance:   1000,
    items: [
      { itemType: 'MATCHED' as const, statementAmount: 500, journalLineId: 'jl-a-1', isMatched: true },
      { itemType: 'JE_LINE' as const, journalLineId: 'jl-a-2', isMatched: false },
    ],
    ...overrides,
  };
}

describe('BankReconciliationService.upsert — shop isolation', () => {
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let tx: ReturnType<typeof makePrisma>['tx'];
  let svc: BankReconciliationService;

  beforeEach(() => {
    ({ prisma, tx } = makePrisma());
    svc = new BankReconciliationService(prisma as any);
  });

  function expectNothingWritten() {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.bankReconciliation.update).not.toHaveBeenCalled();
    expect(tx.bankReconciliation.create).not.toHaveBeenCalled();
    expect(tx.bankReconciliationItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.bankReconciliationItem.createMany).not.toHaveBeenCalled();
  }

  // ── Update path (KNOWN-1) ──────────────────────────────────────────────────

  it("refuses to save over another shop's reconciliation, and touches none of its items", async () => {
    await expect(svc.upsert(SHOP_A, USER_A, body({ id: 'recon-b', complete: true })))
      .rejects.toThrow(NotFoundException);
    expectNothingWritten();
  });

  it("gives the same answer for another shop's id as for an id that does not exist", async () => {
    const foreign = await svc.upsert(SHOP_A, USER_A, body({ id: 'recon-b' })).catch((e) => e);
    const missing = await svc.upsert(SHOP_A, USER_A, body({ id: 'recon-nope' })).catch((e) => e);
    expect(foreign).toBeInstanceOf(NotFoundException);
    expect(missing).toBeInstanceOf(NotFoundException);
    expect(foreign.message).toBe(missing.message);
  });

  it('still saves over the shop’s own reconciliation, scoped to the shop in the write', async () => {
    const res = await svc.upsert(SHOP_A, USER_A, body({ id: 'recon-a', complete: true }));

    expect(res.id).toBe('recon-a');
    const updateArgs = tx.bankReconciliation.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'recon-a', tenantId: SHOP_A });
    expect(updateArgs.data.status).toBe('COMPLETED');
    expect(tx.bankReconciliationItem.deleteMany).toHaveBeenCalledWith({ where: { reconciliationId: 'recon-a' } });
    const items = tx.bankReconciliationItem.createMany.mock.calls[0][0].data;
    expect(items.map((i: any) => i.journalLineId)).toEqual(['jl-a-1', 'jl-a-2']);
  });

  it("refuses an update that adds another shop's journal line, and keeps the saved items", async () => {
    await expect(svc.upsert(SHOP_A, USER_A, body({
      id: 'recon-a',
      items: [{ itemType: 'MATCHED', statementAmount: 1, journalLineId: 'jl-b-1', isMatched: true }],
    }))).rejects.toThrow(ForbiddenException);
    expectNothingWritten();
  });

  // ── Create path (BOOKS-4) ──────────────────────────────────────────────────

  it("refuses to start a reconciliation on another shop's account", async () => {
    await expect(svc.upsert(SHOP_A, USER_A, body({ accountId: 'acct-b-bank', items: [] })))
      .rejects.toThrow(new ForbiddenException('That account is not in your shop.'));
    expectNothingWritten();
  });

  it("refuses to store another shop's journal line on a new reconciliation", async () => {
    await expect(svc.upsert(SHOP_A, USER_A, body({
      items: [
        { itemType: 'JE_LINE', journalLineId: 'jl-a-1', isMatched: false },
        { itemType: 'JE_LINE', journalLineId: 'jl-b-1', isMatched: false },
      ],
    }))).rejects.toThrow(new ForbiddenException('One or more journal lines are not in your shop.'));
    expectNothingWritten();
  });

  it('still creates a new reconciliation on the shop’s own account and lines', async () => {
    const res = await svc.upsert(SHOP_A, USER_A, body({
      // The same line twice (matched and listed) counts once.
      items: [
        { itemType: 'MATCHED', statementAmount: 500, journalLineId: 'jl-a-1', isMatched: true },
        { itemType: 'JE_LINE', journalLineId: 'jl-a-1', isMatched: false },
        { itemType: 'STATEMENT', statementAmount: 20, statementDesc: 'Bank fee' },
      ],
    }));

    expect(res.id).toBe('recon-new');
    const createArgs = tx.bankReconciliation.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({ tenantId: SHOP_A, accountId: 'acct-a-bank', preparedById: USER_A });
    expect(prisma.journalLine.count).toHaveBeenCalledWith({
      where: { id: { in: ['jl-a-1'] }, journalEntry: { tenantId: SHOP_A } },
    });
    expect(tx.bankReconciliationItem.createMany.mock.calls[0][0].data).toHaveLength(3);
  });

  it('does not look up journal lines when the save has none (statement lines only)', async () => {
    await svc.upsert(SHOP_A, USER_A, body({
      items: [{ itemType: 'STATEMENT', statementAmount: 20, statementDesc: 'Bank fee' }],
    }));
    expect(prisma.journalLine.count).not.toHaveBeenCalled();
    expect(tx.bankReconciliation.create).toHaveBeenCalledTimes(1);
  });
});
