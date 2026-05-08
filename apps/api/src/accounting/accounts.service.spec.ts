/**
 * AccountsService — Chart of Accounts CRUD with TOCTOU-safe writes.
 *
 * Focuses on the cross-tenant atomic-write fix (update/delete now use
 * updateMany/deleteMany with `{ id, tenantId }` so a TOCTOU race can't mutate
 * another tenant's CoA), plus the "system account" guards.
 */
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function makePrismaMock() {
  return {
    account: {
      findUnique: jest.fn(),
      findFirst:  jest.fn(),
      findMany:   jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
      updateMany: jest.fn(),
      delete:     jest.fn(),
      deleteMany: jest.fn(),
    },
    journalLine: { count: jest.fn() },
  };
}

describe('AccountsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: AccountsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new AccountsService(prisma as any);
  });

  describe('create', () => {
    it('rejects duplicate code within the same tenant', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'ex' });
      await expect(
        service.create(TENANT_A, { code: '1010', name: 'X', type: 'ASSET' as any, normalBalance: 'DEBIT' as any }),
      ).rejects.toThrow(ConflictException);
    });

    it('always sets tenantId from the argument (never from dto)', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      prisma.account.create.mockResolvedValue({ id: 'new' });
      await service.create(TENANT_A, {
        code: '9999',
        name: 'Test',
        type: 'ASSET' as any,
        normalBalance: 'DEBIT' as any,
        // attacker tries to inject a different tenantId in the body
        ...({ tenantId: TENANT_B } as any),
      });
      expect(prisma.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: TENANT_A }),
      });
    });
  });

  describe('update — TOCTOU fix', () => {
    it('uses atomic updateMany scoped by id AND tenantId', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a1', isSystem: false });
      prisma.account.updateMany.mockResolvedValue({ count: 1 });
      prisma.account.findUnique.mockResolvedValue({ id: 'a1' });

      await service.update(TENANT_A, 'a1', { name: 'New' } as any);

      expect(prisma.account.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', tenantId: TENANT_A },
        data:  { name: 'New' },
      });
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('rejects postingControl change on system accounts', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a1', isSystem: true });
      await expect(
        service.update(TENANT_A, 'a1', { postingControl: 'OPEN' as any }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.account.updateMany).not.toHaveBeenCalled();
    });

    it('cross-tenant id throws NotFoundException at the findFirst step', async () => {
      prisma.account.findFirst.mockResolvedValue(null); // not in tenant A
      await expect(service.update(TENANT_A, 'b-acct', {} as any))
        .rejects.toThrow(NotFoundException);
    });

    it('updateMany returning count=0 (race) still 404s', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a1', isSystem: false });
      prisma.account.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.update(TENANT_A, 'a1', {} as any))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('delete — TOCTOU fix', () => {
    it('blocks deletion of system accounts', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a1', isSystem: true });
      await expect(service.delete(TENANT_A, 'a1')).rejects.toThrow(ForbiddenException);
      expect(prisma.account.deleteMany).not.toHaveBeenCalled();
    });

    it('blocks deletion when journal lines exist (scoped via parent JournalEntry.tenantId)', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a1', isSystem: false });
      prisma.journalLine.count.mockResolvedValue(3);
      await expect(service.delete(TENANT_A, 'a1')).rejects.toThrow(ConflictException);
      // The journal-line lookup must filter through journalEntry.tenantId — defends
      // against a deleted account being reported as 'unused' due to cross-tenant lines.
      expect(prisma.journalLine.count).toHaveBeenCalledWith({
        where: { accountId: 'a1', journalEntry: { tenantId: TENANT_A } },
      });
    });

    it('uses deleteMany scoped by id + tenantId when allowed', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a1', isSystem: false });
      prisma.journalLine.count.mockResolvedValue(0);
      prisma.account.deleteMany.mockResolvedValue({ count: 1 });

      await service.delete(TENANT_A, 'a1');

      expect(prisma.account.deleteMany).toHaveBeenCalledWith({
        where: { id: 'a1', tenantId: TENANT_A },
      });
      expect(prisma.account.delete).not.toHaveBeenCalled();
    });

    it('cross-tenant attack: TENANT_A deleting TENANT_B account → NotFound from findFirst', async () => {
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.delete(TENANT_A, 'b-acct')).rejects.toThrow(NotFoundException);
      expect(prisma.account.deleteMany).not.toHaveBeenCalled();
    });
  });
});
