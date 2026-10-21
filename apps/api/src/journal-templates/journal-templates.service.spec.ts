/**
 * JournalTemplatesService — focused on the cross-tenant TOCTOU fix on delete()
 * (now uses deleteMany scoped by id + tenantId), plus tenant scoping on findOne,
 * and (S4-7 / KNOWN-2) that a template's accounts must be the shop's own on
 * save and again before every run.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { JournalTemplatesService } from './journal-templates.service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

// A tiny two-shop chart of accounts for the account checks.
const ACCOUNTS = [
  { id: 'a-rent', tenantId: TENANT_A },
  { id: 'a-cash', tenantId: TENANT_A },
  { id: 'b-cash', tenantId: TENANT_B },
];

function makePrismaMock() {
  return {
    journalTemplate: {
      findUnique: jest.fn(),
      findFirst:  jest.fn(),
      create:     jest.fn(async ({ data }: any) => ({ id: 'tpl-new', ...data })),
      update:     jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      delete:     jest.fn(),
      deleteMany: jest.fn(),
    },
    account: {
      count: jest.fn(async ({ where }: any) =>
        ACCOUNTS.filter((a) => where.id.in.includes(a.id) && a.tenantId === where.tenantId).length),
    },
  };
}

const OWN_LINES = [
  { accountId: 'a-rent', debit: 100 },
  { accountId: 'a-cash', credit: 100 },
];
const FOREIGN_LINES = [
  { accountId: 'a-rent', debit: 100 },
  { accountId: 'b-cash', credit: 100 },
];

describe('JournalTemplatesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: JournalTemplatesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new JournalTemplatesService(prisma as any, /* journal */ {} as any);
  });

  describe('delete — TOCTOU fix', () => {
    it('uses atomic deleteMany scoped by id + tenantId', async () => {
      prisma.journalTemplate.deleteMany.mockResolvedValue({ count: 1 });
      await service.delete(TENANT_A, 'tpl-1');
      expect(prisma.journalTemplate.deleteMany).toHaveBeenCalledWith({
        where: { id: 'tpl-1', tenantId: TENANT_A },
      });
      // Legacy unscoped delete must NOT be used.
      expect(prisma.journalTemplate.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when count=0 (cross-tenant id or unknown)', async () => {
      prisma.journalTemplate.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.delete(TENANT_A, 'tpl-from-tenant-b'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe("accounts must be the shop's own", () => {
    const NOT_YOURS = new ForbiddenException('One or more accounts on this template are not in your shop.');
    let journal: { create: jest.Mock };

    beforeEach(() => {
      journal = { create: jest.fn(async () => ({ id: 'je-1', status: 'POSTED' })) };
      service = new JournalTemplatesService(prisma as any, journal as any);
    });

    function stored(lines: unknown, extra: Record<string, unknown> = {}) {
      return {
        id: 'tpl-1', tenantId: TENANT_A, name: 'Monthly rent', isActive: true,
        frequency: 'MONTHLY', lastRunAt: null, lines, ...extra,
      };
    }

    it("create refuses a line on another shop's account, and saves nothing", async () => {
      await expect(service.create(TENANT_A, 'user-a', { name: 'Rent', lines: FOREIGN_LINES }))
        .rejects.toThrow(NOT_YOURS);
      expect(prisma.journalTemplate.create).not.toHaveBeenCalled();
    });

    it("create still saves the shop's own template", async () => {
      const t = await service.create(TENANT_A, 'user-a', { name: 'Rent', lines: OWN_LINES, frequency: 'MONTHLY' });
      expect(prisma.account.count).toHaveBeenCalledWith({
        where: { id: { in: ['a-rent', 'a-cash'] }, tenantId: TENANT_A },
      });
      expect(t).toMatchObject({ tenantId: TENANT_A, lines: OWN_LINES, frequency: 'MONTHLY' });
    });

    it("update refuses new lines on another shop's account, and changes nothing", async () => {
      prisma.journalTemplate.findFirst.mockResolvedValue(stored(OWN_LINES));
      await expect(service.update(TENANT_A, 'tpl-1', { lines: FOREIGN_LINES }))
        .rejects.toThrow(NOT_YOURS);
      expect(prisma.journalTemplate.update).not.toHaveBeenCalled();
    });

    it("update still saves the shop's own lines, and skips the check when lines are not sent", async () => {
      prisma.journalTemplate.findFirst.mockResolvedValue(stored(OWN_LINES));
      await service.update(TENANT_A, 'tpl-1', { lines: OWN_LINES });
      expect(prisma.journalTemplate.update.mock.calls[0][0].data.lines).toEqual(OWN_LINES);

      prisma.account.count.mockClear();
      await service.update(TENANT_A, 'tpl-1', { name: 'Rent (renamed)' });
      expect(prisma.account.count).not.toHaveBeenCalled();
      expect(prisma.journalTemplate.update).toHaveBeenCalledTimes(2);
    });

    it('runNow will not post a template saved earlier with another shop’s account', async () => {
      prisma.journalTemplate.findFirst.mockResolvedValue(stored(FOREIGN_LINES));
      await expect(service.runNow(TENANT_A, 'tpl-1', 'user-a')).rejects.toThrow(NOT_YOURS);
      expect(journal.create).not.toHaveBeenCalled();
      // Not marked as run either, so it stays visible as due.
      expect(prisma.journalTemplate.update).not.toHaveBeenCalled();
    });

    it("runNow still posts the shop's own template", async () => {
      prisma.journalTemplate.findFirst.mockResolvedValue(stored(OWN_LINES));
      await service.runNow(TENANT_A, 'tpl-1', 'user-a', { date: '2026-10-21' });
      expect(journal.create).toHaveBeenCalledTimes(1);
      const [tenantArg, dto] = journal.create.mock.calls[0] as any[];
      expect(tenantArg).toBe(TENANT_A);
      expect(dto.lines.map((l: any) => l.accountId)).toEqual(['a-rent', 'a-cash']);
      expect(prisma.journalTemplate.update).toHaveBeenCalledTimes(1);
    });
  });
});
