import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

const UPLOADS_ROOT = path.resolve('./uploads');
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {
    // Ensure the uploads root exists on startup
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
  }

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
    const destAbs = path.join(UPLOADS_ROOT, storagePath);

    // Ensure the sub-directory exists
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });

    // Move the temp file to its permanent location
    await fs.promises.rename(file.path, destAbs);

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

  /** List all documents for a given entity. */
  async list(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.document.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Delete DB record and remove file from disk. */
  async delete(tenantId: string, documentId: string, requesterId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found.');

    // Delete from DB first so it disappears even if file removal fails
    await this.prisma.document.delete({ where: { id: documentId } });

    const absPath = path.join(UPLOADS_ROOT, doc.storagePath);
    await fs.promises.unlink(absPath).catch(() => undefined);

    return { deleted: true, id: documentId };
  }

  /** Stream the file to the HTTP response with correct headers. */
  async serve(tenantId: string, documentId: string, res: Response) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
    });
    if (!doc) throw new NotFoundException('Document not found.');

    const absPath = path.join(UPLOADS_ROOT, doc.storagePath);

    if (!fs.existsSync(absPath)) {
      throw new NotFoundException('File not found on disk.');
    }

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(doc.filename)}"`,
    );
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', doc.sizeBytes);

    const stream = fs.createReadStream(absPath);
    stream.pipe(res);
  }
}
