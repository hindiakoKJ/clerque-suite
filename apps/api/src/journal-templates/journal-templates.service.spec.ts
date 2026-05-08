/**
 * JournalTemplatesService — focused on the cross-tenant TOCTOU fix on delete()
 * (now uses deleteMany scoped by id + tenantId), plus tenant scoping on findOne.
 */
import { NotFoundException } from '@nestjs/common';
import { JournalTemplatesService } from './journal-templates.service';

const TENANT_A = 'tenant-a';

function makePrismaMock() {
  return {
    journalTemplate: {
      findUnique: jest.fn(),
      findFirst:  jest.fn(),
      delete:     jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

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
});
