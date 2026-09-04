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
  async list(tenantId: string, entityType: string, entityId: string) {
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
  async serve(tenantId: string, documentId: string, res: Response) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found.');

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
