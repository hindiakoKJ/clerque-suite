import { BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';

/**
 * The buy-list copies Clerque files are found again by their label, and the
 * copy as sent is handed to the kitchen without the purchase-cost check. So
 * nobody may upload a file under those labels: a supplier invoice filed as
 * "Buy list — as sent" would be shared to staff, prices and all, as
 * Clerque's own list.
 */
describe('DocumentsService.upload — labels Clerque keeps for itself', () => {
  function build() {
    const prisma: any = { document: { create: jest.fn(({ data }: any) => Promise.resolve({ id: 'd1', ...data })) } };
    const storage: any = { putFromTempPath: jest.fn().mockResolvedValue(undefined) };
    return { svc: new DocumentsService(prisma, storage), prisma, storage };
  }
  const file = (): any => ({ path: 'C:/nonexistent/multer-tmp-upload', originalname: 'invoice.pdf', mimetype: 'application/pdf', size: 1200 });

  it.each(['Buy list — as sent', 'Buy list — as booked', '  buy list — AS SENT '])('refuses an upload labelled %j', async (label) => {
    const { svc, prisma, storage } = build();
    await expect(svc.upload('t1', 'PurchaseRequest', 'req1', file(), label, 'u1')).rejects.toThrow(BadRequestException);
    expect(storage.putFromTempPath).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Receipt', 'Supplier invoice', 'Buy list'])('files an upload labelled %j as before', async (label) => {
    const { svc, prisma, storage } = build();
    await svc.upload('t1', 'PurchaseRequest', 'req1', file(), label, 'u1');
    expect(storage.putFromTempPath).toHaveBeenCalledTimes(1);
    expect(prisma.document.create.mock.calls[0][0].data.label).toBe(label ?? null);
  });
});
