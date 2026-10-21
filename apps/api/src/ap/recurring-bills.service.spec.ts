/**
 * RecurringBillsService.update — a new branchId must be the shop's own
 * (BOOKS-3). create() already checked it; update() wrote it as given, and the
 * cron copies it onto every bill the template makes.
 */
import { ForbiddenException } from '@nestjs/common';
import { RecurringBillsService } from './recurring-bills.service';

const TENANT = 'tenant-1';
const USER   = 'user-1';

// Branches of two shops, for the branchId check.
const BRANCHES = [
  { id: 'branch-own',     tenantId: TENANT },
  { id: 'branch-foreign', tenantId: 'tenant-2' },
];

function makePrisma() {
  const prisma: any = {
    branch: {
      findFirst: jest.fn(async ({ where }: any) =>
        BRANCHES.find((b) => b.id === where.id && b.tenantId === where.tenantId) ?? null),
    },
    recurringBillTemplate: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'tpl-1', tenantId: TENANT, status: 'ACTIVE',
        startDate: new Date('2026-06-01'), lines: [],
      }),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    recurringBillTemplateLine: { deleteMany: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  return prisma;
}

describe('RecurringBillsService.update — branch must be in the shop', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: RecurringBillsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new RecurringBillsService(prisma, { next: jest.fn() } as any);
  });

  it("refuses another shop's branchId, and changes nothing", async () => {
    await expect(svc.update(TENANT, 'tpl-1', USER, { branchId: 'branch-foreign' }))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.recurringBillTemplate.update).not.toHaveBeenCalled();
  });

  it("still saves the shop's own branchId", async () => {
    await svc.update(TENANT, 'tpl-1', USER, { branchId: 'branch-own' });
    expect(prisma.branch.findFirst).toHaveBeenCalledWith({
      where: { id: 'branch-own', tenantId: TENANT }, select: { id: true },
    });
    expect(prisma.recurringBillTemplate.update.mock.calls[0][0].data.branchId).toBe('branch-own');
  });

  it('does not look up a branch when the update leaves it alone', async () => {
    await svc.update(TENANT, 'tpl-1', USER, { name: 'Office rent' });
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    expect(prisma.recurringBillTemplate.update).toHaveBeenCalledTimes(1);
  });
});
