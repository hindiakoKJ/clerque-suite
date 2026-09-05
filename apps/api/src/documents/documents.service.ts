import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { hasPermission } from '@repo/shared-types';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { canSeePurchaseCosts } from '../procure/cost-visibility';
import archiver from 'archiver';

/**
 * How many files one archive may hold. Past this the range is refused, not
 * trimmed: a zip that quietly stops at file 500 is worse than one that says
 * "narrow the dates", because nobody counts the files in a zip.
 */
export const MAX_ARCHIVE_FILES = 500;

/** Manila day boundaries, the way every other date in Procure is drawn. */
const MANILA = '+08:00';

/**
 * A file's name inside the archive: the day, the request it belongs to, then
 * the original name. Sorted in a file manager, that reads as a ledger.
 */
export function archiveEntryName(doc: { createdAt: Date; filename: string }, ref: string | null): string {
  const day  = new Date(doc.createdAt.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const safe = doc.filename.replace(/[\\/:*?"<>|]+/g, '_').slice(-80);
  return `${day}_${ref ?? 'no-request'}_${safe}`;
}

/** YYYY-MM-DD, or nothing. */
export function parseDay(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger('DocumentsService');

  constructor(
    private readonly prisma:  PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Upload a file and persist a Document record. */
  async upload(
    tenantId: string,
    entityType: string,
    entityId: string,
    file: Express.Multer.File,
    label?: string,
    uploadedById?: string,
  ) {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      // Remove the temp file multer wrote
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw new BadRequestException(
        `File type "${file.mimetype}" is not allowed. Accepted: PDF, JPEG, PNG, WEBP.`,
      );
    }

    if (file.size > MAX_SIZE_BYTES) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw new BadRequestException('File exceeds the 10 MB size limit.');
    }

    // Sanitise the original filename: strip path separators, keep only safe chars.
    const safeBasename = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    // Prefix with a short random token to prevent silent overwrites.
    const uniquePrefix = crypto.randomBytes(6).toString('hex');
    const storedFilename = `${uniquePrefix}_${safeBasename}`;
    const storagePath = `tenants/${tenantId}/${entityType.toLowerCase()}/${entityId}/${storedFilename}`;

    // Sprint 19 — abstracted via StorageService. Falls back to local disk
    // when S3_BUCKET isn't configured; uses Cloudflare R2 / AWS S3 in prod
    // so uploads survive Railway redeploys.
    await this.storage.putFromTempPath(file.path, storagePath, {
      contentType: file.mimetype,
    });

    return this.prisma.document.create({
      data: {
        tenantId,
        entityType,
        entityId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath,
        label: label ?? null,
        uploadedById: uploadedById ?? null,
      },
    });
  }

  /**
   * File bytes that never touched disk.
   *
   * `upload` above takes what multer wrote to a temp path. A receipt photo
   * arrives as base64 in a JSON body -- the same way the AI reader takes it,
   * so the client sends one thing, not a JSON body and a multipart form --
   * and there is no temp file to move. Same checks, same storage path, same
   * Document row; only the source differs.
   */
  async uploadBuffer(
    tenantId: string,
    entityType: string,
    entityId: string,
    buffer: Buffer,
    mimeType: string,
    filename: string,
    label?: string,
    uploadedById?: string,
  ) {
    if (!ALLOWED_MIMES.has(mimeType)) {
      throw new BadRequestException(
        `File type "${mimeType}" is not allowed. Accepted: PDF, JPEG, PNG, WEBP.`,
      );
    }
    if (buffer.length > MAX_SIZE_BYTES) {
      throw new BadRequestException('File exceeds the 10 MB size limit.');
    }
    const safeBasename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniquePrefix = crypto.randomBytes(6).toString('hex');
    const storagePath = `tenants/${tenantId}/${entityType.toLowerCase()}/${entityId}/${uniquePrefix}_${safeBasename}`;

    await this.storage.putBuffer(buffer, storagePath, { contentType: mimeType, tenantId });

    return this.prisma.document.create({
      data: {
        tenantId, entityType, entityId,
        filename:  filename,
        mimeType,
        sizeBytes: buffer.length,
        storagePath,
        label:     label ?? null,
        uploadedById: uploadedById ?? null,
      },
    });
  }

  /** List all documents for a given entity. */
  async list(tenantId: string, entityType: string, entityId: string, viewerRole?: string | null) {
    /*
      A receipt filed against a purchase request is a photograph of the
      prices. If the owner has decided staff do not see what a delivery cost,
      handing them the photo would make that decision meaningless, so the
      same switch governs both. Every other kind of document is unaffected.
    */
    if (entityType === 'PurchaseRequest') {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { showPurchaseCostsToStaff: true },
      });
      if (!canSeePurchaseCosts(viewerRole, tenant?.showPurchaseCostsToStaff)) return [];
    }
    return this.prisma.document.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Delete DB record and remove file from disk.
   *
   * Hard delete of a BIR supporting document — SOD-gated at the service
   * layer like the other destructive mutations (price wall, voids). Until a
   * DOCUMENT_DELETED AuditAction exists (schema change, pending sign-off),
   * attribution is a structured warn log rather than an audit row.
   */
  async delete(
    tenantId: string,
    documentId: string,
    requesterId: string,
    requesterRole: string,
    customPermissions?: readonly string[] | null,
  ) {
    if (!hasPermission(requesterRole, 'document:delete', customPermissions)) {
      throw new ForbiddenException(
        `Role '${requesterRole}' is not permitted to delete documents. ` +
        'Ask your Business Owner or Branch Manager.',
      );
    }

    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found.');

    // Delete from DB first so it disappears even if file removal fails
    await this.prisma.document.delete({ where: { id: documentId } });

    await this.storage.delete(doc.storagePath).catch(() => undefined);

    this.logger.warn(
      `[documents] hard delete: doc=${documentId} (${doc.entityType}/${doc.entityId}, "${doc.filename}") ` +
      `tenant=${tenantId} by=${requesterId} role=${requesterRole}`,
    );

    return { deleted: true, id: documentId };
  }

  /** Stream the file to the HTTP response with correct headers. */
  /**
   * Every file of one kind filed in a date range, as one zip.
   *
   * The accountant's real question is "all the receipts for August", and the
   * only answer until now was thirty requests and thirty clicks. The archive
   * carries an index.csv so the files can be reconciled without opening each,
   * and a MISSING.txt if any file could not be read from storage -- named,
   * never silently skipped.
   */
  async exportArchive(
    tenantId: string,
    opts: { entityType: string; from: string; to: string },
    viewerRole: string | null | undefined,
    res: Response,
  ): Promise<void> {
    const from = parseDay(opts.from);
    const to   = parseDay(opts.to);
    if (!from || !to || from > to) {
      throw new BadRequestException('Give a date range as from=YYYY-MM-DD&to=YYYY-MM-DD, earliest first.');
    }
    if (!opts.entityType) throw new BadRequestException('Which kind of document? entityType is required.');

    // The receipt photo shows the prices, so the cost switch governs it here
    // exactly as it does on the single-file routes.
    if (opts.entityType === 'PurchaseRequest') {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId }, select: { showPurchaseCostsToStaff: true },
      });
      if (!canSeePurchaseCosts(viewerRole, tenant?.showPurchaseCostsToStaff)) {
        throw new ForbiddenException('Receipts are not shown to your role on this account.');
      }
    }

    const start = new Date(`${from}T00:00:00${MANILA}`);
    const end   = new Date(new Date(`${to}T00:00:00${MANILA}`).getTime() + 86_400_000);
    const docs = await this.prisma.document.findMany({
      where:   { tenantId, entityType: opts.entityType, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'asc' },
      take:    MAX_ARCHIVE_FILES + 1,
    });
    if (docs.length === 0) {
      throw new NotFoundException(`No files of that kind were filed between ${from} and ${to}.`);
    }
    if (docs.length > MAX_ARCHIVE_FILES) {
      throw new BadRequestException(
        `More than ${MAX_ARCHIVE_FILES} files between ${from} and ${to}. Narrow the dates and try again.`,
      );
    }

    // What each file belongs to, so the name inside the zip means something.
    const refById = new Map<string, string>();
    if (opts.entityType === 'PurchaseRequest') {
      const reqs = await this.prisma.purchaseRequest.findMany({
        where:  { tenantId, id: { in: [...new Set(docs.map((d) => d.entityId))] } },
        select: { id: true, requestNumber: true },
      });
      for (const r of reqs) refById.set(r.id, r.requestNumber);
    }

    const stamp = `${opts.entityType.toLowerCase()}_${from}_to_${to}`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${stamp}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    /*
      Thrown from inside a stream listener, an error would be an uncaught
      exception and take the whole API down with it. Log it and cut the
      download short instead: the client gets a broken zip, not a dead server.
    */
    const abort = (err: Error) => {
      this.logger.error(`[documents] archive ${stamp} for tenant=${tenantId} failed: ${err.message}`);
      archive.abort();
      if (!res.destroyed) res.destroy(err);
    };
    archive.on('error', abort);
    archive.pipe(res);

    // Two photos with the same name on the same request on the same day
    // would otherwise be one entry written twice; the second gets " (2)".
    const taken = new Set<string>();
    const unique = (name: string): string => {
      if (!taken.has(name)) { taken.add(name); return name; }
      const dot  = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext  = dot > 0 ? name.slice(dot) : '';
      for (let n = 2; ; n++) {
        const candidate = `${stem} (${n})${ext}`;
        if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
      }
    };

    const index: string[] = ['date,request,filename,bytes'];
    const missing: string[] = [];
    for (const doc of docs) {
      const ref  = refById.get(doc.entityId) ?? null;
      const name = unique(archiveEntryName(doc, ref));
      try {
        const { stream } = await this.storage.getStream(doc.storagePath);
        stream.on('error', abort);   // a source that dies mid-read must not go unhandled either
        archive.append(stream, { name, date: doc.createdAt });
        index.push([name.slice(0, 10), ref ?? '', doc.filename.replace(/,/g, ' '), String(doc.sizeBytes)].join(','));
      } catch (err) {
        // Say so inside the zip. A file that vanished from storage is a
        // fact the accountant needs, not something to tidy away.
        missing.push(`${name}: ${err instanceof Error ? err.message : 'could not be read'}`);
      }
    }
    archive.append(index.join('\n') + '\n', { name: 'index.csv' });
    if (missing.length > 0) {
      archive.append(missing.join('\n') + '\n', { name: 'MISSING.txt' });
    }
    await archive.finalize();
  }

  async serve(tenantId: string, documentId: string, res: Response, viewerRole?: string | null) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found.');

    /*
      Hiding the receipt from the list is not hiding it: this route is open
      to cashiers too, and a document id is guessable from anyone who has
      seen it once. The same switch governs the file itself.
    */
    if (doc.entityType === 'PurchaseRequest') {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { showPurchaseCostsToStaff: true },
      });
      if (!canSeePurchaseCosts(viewerRole, tenant?.showPurchaseCostsToStaff)) {
        throw new NotFoundException('Document not found.');
      }
    }

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(doc.filename)}"`,
    );
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', doc.sizeBytes);

    const { stream } = await this.storage.getStream(doc.storagePath);
    stream.pipe(res);
  }
}
