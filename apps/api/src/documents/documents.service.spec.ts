import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

/**
 * SOD gate on document deletion — documents attached to orders/expenses are
 * BIR supporting records, so frontline roles must not be able to hard-delete
 * them (previously ANY authenticated tenant user could).
 */
describe('DocumentsService.delete — SOD gate', () => {
  const doc = {
    id: 'doc-1',
    tenantId: 't1',
    entityType: 'ORDER',
    entityId: 'o1',
    filename: 'receipt.pdf',
    storagePath: 'uploads/t1/receipt.pdf',
  };

  let prisma: { document: { findFirst: jest.Mock; delete: jest.Mock } };
  let storage: { delete: jest.Mock };
  let service: DocumentsService;

  beforeEach(() => {
    prisma = {
      document: {
        findFirst: jest.fn().mockResolvedValue(doc),
        delete: jest.fn().mockResolvedValue(doc),
      },
    };
    storage = { delete: jest.fn().mockResolvedValue(undefined) };
    service = new DocumentsService(prisma as any, storage as any);
  });

  it.each(['CASHIER', 'SALES_LEAD', 'WAREHOUSE_STAFF'] as const)(
    'rejects %s with ForbiddenException before touching the document',
    async (role) => {
      await expect(service.delete('t1', 'doc-1', 'u1', role)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.document.findFirst).not.toHaveBeenCalled();
      expect(prisma.document.delete).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );

  it.each(['BUSINESS_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'BOOKKEEPER'] as const)(
    'allows %s to delete (tenant-scoped)',
    async (role) => {
      await expect(service.delete('t1', 'doc-1', 'u1', role)).resolves.toEqual({
        deleted: true,
        id: 'doc-1',
      });
      expect(prisma.document.findFirst).toHaveBeenCalledWith({
        where: { id: 'doc-1', tenantId: 't1' },
      });
      expect(storage.delete).toHaveBeenCalledWith(doc.storagePath);
    },
  );

  it('lets customPermissions grant delete to an otherwise-blocked role', async () => {
    await expect(
      service.delete('t1', 'doc-1', 'u1', 'CASHIER', ['document:delete']),
    ).resolves.toEqual({ deleted: true, id: 'doc-1' });
  });

  it('still 404s on a cross-tenant / missing document for an allowed role', async () => {
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(
      service.delete('t1', 'nope', 'u1', 'BUSINESS_OWNER'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.document.delete).not.toHaveBeenCalled();
  });
});
