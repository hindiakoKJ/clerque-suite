import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { PassThrough, Readable } from 'stream';
import { DocumentsService, archiveEntryName, parseDay, MAX_ARCHIVE_FILES } from './documents.service';

/** A response the zip can be piped into, and read back. */
function sink() {
  const res: any = new PassThrough();
  res.setHeader = jest.fn();
  res.on('error', () => undefined);   // destroy(err) emits; the test reads `destroyed`
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => res.on('end', () => resolve(Buffer.concat(chunks))));
  return { res, done };
}

/** The entry names in a zip, straight from its local file headers. */
function entryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let at = 0;
  while ((at = zip.indexOf('PK\u0003\u0004', at)) >= 0) {
    const nameLen = zip.readUInt16LE(at + 26);
    names.push(zip.toString('utf8', at + 30, at + 30 + nameLen));
    at += 30 + nameLen;
  }
  return names;
}

/**
 * "All the receipts for August" used to mean thirty requests and thirty
 * clicks. One zip now — and the rules around it matter more than the zip:
 * the range is refused rather than trimmed when it is too big, a file that
 * cannot be read is NAMED inside the archive rather than skipped, and staff
 * who may not see prices may not download the photos of them either.
 */
describe('Receipt archive', () => {
  const TENANT = 't1';

  describe('a file\'s name inside the zip', () => {
    it('leads with the Manila day, then the request, then the original name', () => {
      // 2026-08-31 23:30 Manila is already 2026-08-31T15:30Z; the name must say the 31st.
      const doc = { createdAt: new Date('2026-08-31T15:30:00Z'), filename: 'IMG_2201.jpg' };
      expect(archiveEntryName(doc, 'REQ-20260831-004')).toBe('2026-08-31_REQ-20260831-004_IMG_2201.jpg');
    });

    it('rolls a late-night UTC time forward to the right Manila day', () => {
      // 2026-08-31T20:00Z is 04:00 on 1 Sept in Manila.
      const doc = { createdAt: new Date('2026-08-31T20:00:00Z'), filename: 'r.jpg' };
      expect(archiveEntryName(doc, 'REQ-1')).toMatch(/^2026-09-01_/);
    });

    it('survives a filename a file manager would choke on', () => {
      const doc = { createdAt: new Date('2026-08-01T00:00:00Z'), filename: 'sm: "wings" <2>?.jpg' };
      // Runs of bad characters collapse to ONE underscore; `>?` is one run.
      expect(archiveEntryName(doc, null)).toBe('2026-08-01_no-request_sm_ _wings_ _2_.jpg');
    });
  });

  describe('the date range', () => {
    it('accepts a real day and nothing else', () => {
      expect(parseDay('2026-08-01')).toBe('2026-08-01');
      expect(parseDay('2026-8-1')).toBeNull();
      expect(parseDay('yesterday')).toBeNull();
      expect(parseDay('')).toBeNull();
      expect(parseDay(undefined)).toBeNull();
    });
  });

  describe('the export itself', () => {
    function build(opts: { docs?: any[]; showCosts?: boolean } = {}) {
      const prisma: any = {
        tenant:   { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: opts.showCosts ?? true }) },
        document: { findMany: jest.fn().mockResolvedValue(opts.docs ?? []) },
        purchaseRequest: { findMany: jest.fn().mockResolvedValue([{ id: 'req1', requestNumber: 'REQ-20260803-001' }]) },
      };
      const storage: any = { getStream: jest.fn() };
      const res: any = { setHeader: jest.fn() };
      return { svc: new DocumentsService(prisma, storage), prisma, storage, res };
    }

    it('refuses a bad or backwards range before touching anything', async () => {
      const { svc, prisma, res } = build();
      await expect(svc.exportArchive(TENANT, { entityType: 'PurchaseRequest', from: 'x', to: '2026-08-31' }, 'BUSINESS_OWNER', res))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.exportArchive(TENANT, { entityType: 'PurchaseRequest', from: '2026-09-01', to: '2026-08-01' }, 'BUSINESS_OWNER', res))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.document.findMany).not.toHaveBeenCalled();
    });

    it('keeps the photos from staff who may not see prices', async () => {
      const { svc, prisma, res } = build({ showCosts: false });
      await expect(svc.exportArchive(TENANT, { entityType: 'PurchaseRequest', from: '2026-08-01', to: '2026-08-31' }, 'CASHIER', res))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.document.findMany).not.toHaveBeenCalled();
    });

    it('says plainly when the month is empty', async () => {
      const { svc, res } = build({ docs: [] });
      await expect(svc.exportArchive(TENANT, { entityType: 'PurchaseRequest', from: '2026-08-01', to: '2026-08-31' }, 'BUSINESS_OWNER', res))
        .rejects.toThrow(NotFoundException);
    });

    it('refuses a range with too many files rather than quietly truncating the zip', async () => {
      const docs = Array.from({ length: MAX_ARCHIVE_FILES + 1 }, (_, i) => ({
        id: `d${i}`, entityId: 'req1', filename: `r${i}.jpg`, sizeBytes: 1, storagePath: `k${i}`, createdAt: new Date(),
      }));
      const { svc, prisma, storage, res } = build({ docs });
      await expect(svc.exportArchive(TENANT, { entityType: 'PurchaseRequest', from: '2026-01-01', to: '2026-12-31' }, 'BUSINESS_OWNER', res))
        .rejects.toThrow(/Narrow the dates/);
      expect(storage.getStream).not.toHaveBeenCalled();
      // The mock ignores `take`, so pin that the database is asked for ONE
      // MORE than the limit -- a `take` of exactly the limit could never see
      // the file that tips it over, and this test would still pass.
      expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: MAX_ARCHIVE_FILES + 1 }));
    });

    it('names each entry by day and request, adds the index, and never writes two entries alike', async () => {
      const day = new Date('2026-08-03T02:00:00Z');   // 10:00 in Manila
      const docs = [
        { id: 'd1', entityId: 'req1', filename: 'receipt.jpg', sizeBytes: 3, storagePath: 'k1', createdAt: day },
        { id: 'd2', entityId: 'req1', filename: 'receipt.jpg', sizeBytes: 3, storagePath: 'k2', createdAt: day },
      ];
      const { svc, storage } = build({ docs });
      storage.getStream.mockImplementation(() => Promise.resolve({ stream: Readable.from([Buffer.from('jpg')]) }));
      const { res, done } = sink();
      await svc.exportArchive(TENANT, { entityType: 'PurchaseRequest', from: '2026-08-01', to: '2026-08-31' }, 'BUSINESS_OWNER', res);
      expect(entryNames(await done)).toEqual([
        '2026-08-03_REQ-20260803-001_receipt.jpg',
        '2026-08-03_REQ-20260803-001_receipt (2).jpg',
        'index.csv',
      ]);
    });

    it('cuts the download short -- and does not take the server down -- when a file dies mid-read', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const docs = [{ id: 'd1', entityId: 'req1', filename: 'receipt.jpg', sizeBytes: 3, storagePath: 'k1', createdAt: new Date() }];
      const { svc, storage } = build({ docs });
      storage.getStream.mockImplementation(() => Promise.resolve({
        stream: new Readable({ read() { this.destroy(new Error('S3 dropped the connection')); } }),
      }));
      const { res } = sink();
      await Promise.race([
        svc.exportArchive(TENANT, { entityType: 'PurchaseRequest', from: '2026-01-01', to: '2026-12-31' }, 'BUSINESS_OWNER', res).catch(() => undefined),
        new Promise((r) => setTimeout(r, 500)),
      ]);
      expect(res.destroyed).toBe(true);
    });

    it('asks the database for the Manila month, not the UTC one', async () => {
      const { svc, prisma, res } = build({ docs: [] });
      await svc.exportArchive(TENANT, { entityType: 'PurchaseRequest', from: '2026-08-01', to: '2026-08-31' }, 'BUSINESS_OWNER', res)
        .catch(() => undefined);
      const where = prisma.document.findMany.mock.calls[0][0].where;
      // 00:00 on 1 Aug in Manila is 16:00Z on 31 July; the day after the 31st likewise.
      expect(where.createdAt.gte.toISOString()).toBe('2026-07-31T16:00:00.000Z');
      expect(where.createdAt.lt.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    });
  });
});
