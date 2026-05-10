/**
 * Sprint 19 — Storage abstraction.
 *
 * Wraps file uploads behind a small interface so the service layer doesn't
 * care whether files land on disk (dev / single-instance Railway) or in
 * Cloudflare R2 / AWS S3 (production, ransomware-proof, ephemeral-disk-safe).
 *
 * The driver is selected at boot:
 *   - S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY are all set →
 *     S3-compatible cloud storage (Cloudflare R2 if S3_ENDPOINT points at
 *     a `<account>.r2.cloudflarestorage.com` URL, AWS S3 otherwise).
 *   - Anything missing → local disk under ./uploads/ (current behavior).
 *
 * Existing rows in the Document / Product table store `storagePath` as a
 * key relative to the storage root. The same key reads back from either
 * driver; switching to R2 requires migrating existing files (one-time
 * upload) but does NOT require a database migration.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

export type StorageDriver = 'S3' | 'LOCAL';

export interface PutOptions {
  /** Public URL prefix (set when using a Cloudflare R2 public bucket).
   *  When set, getPublicUrl() returns a CDN URL clients can hit directly. */
  publicUrl?: string;
  /** MIME type for Content-Type header. */
  contentType?: string;
  /** When true, PUT with public-read ACL (S3 only; ignored on R2 which uses
   *  bucket-level public access). */
  publicRead?: boolean;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;
  private readonly s3: S3Client | null = null;
  private readonly bucket: string | null = null;
  private readonly publicUrlBase: string | null = null;
  private readonly localRoot: string;

  constructor(private readonly config: ConfigService) {
    const bucket   = this.config.get<string>('S3_BUCKET');
    const accessId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secret   = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const region   = this.config.get<string>('S3_REGION') ?? 'auto';
    this.publicUrlBase = this.config.get<string>('S3_PUBLIC_URL') ?? null;
    this.localRoot = path.resolve('./uploads');

    if (bucket && accessId && secret) {
      this.driver = 'S3';
      this.bucket = bucket;
      // Cloudflare R2 requires `endpoint` and forces virtual-hosted-style off.
      // For AWS S3, endpoint can be omitted (SDK defaults from region).
      this.s3 = new S3Client({
        region,
        endpoint: endpoint || undefined,
        credentials: { accessKeyId: accessId, secretAccessKey: secret },
        forcePathStyle: !!endpoint, // R2 prefers path-style; AWS S3 uses virtual-host
      });
      this.logger.log(`Storage driver: S3 (bucket=${bucket}${endpoint ? `, endpoint=${endpoint}` : ''})`);
    } else {
      this.driver = 'LOCAL';
      fs.mkdirSync(this.localRoot, { recursive: true });
      this.logger.log(
        `Storage driver: LOCAL (./uploads/) — ⚠ files will NOT survive a Railway redeploy. ` +
        `Set S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY to use Cloudflare R2 / AWS S3.`,
      );
    }
  }

  /** Driver currently in use — handy for diagnostics endpoint. */
  getDriver(): StorageDriver { return this.driver; }

  /**
   * Move a multer-uploaded temp file (`file.path`) to its permanent location
   * under `storageKey`. Removes the temp file on success or failure.
   */
  async putFromTempPath(tempPath: string, storageKey: string, opts: PutOptions = {}): Promise<void> {
    if (this.driver === 'S3') {
      const body = await fs.promises.readFile(tempPath);
      try {
        await this.s3!.send(new PutObjectCommand({
          Bucket:      this.bucket!,
          Key:         storageKey,
          Body:        body,
          ContentType: opts.contentType,
          ACL:         opts.publicRead ? 'public-read' : undefined,
        }));
      } finally {
        await fs.promises.unlink(tempPath).catch(() => undefined);
      }
    } else {
      const destAbs = path.join(this.localRoot, storageKey);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      // rename works only within the same filesystem; copy+unlink is the
      // safe fallback when /tmp and ./uploads are on different volumes.
      try {
        await fs.promises.rename(tempPath, destAbs);
      } catch {
        await fs.promises.copyFile(tempPath, destAbs);
        await fs.promises.unlink(tempPath).catch(() => undefined);
      }
    }
  }

  /**
   * Write a Buffer / string directly. Used by the backup scheduler to
   * push JSON snapshots to R2 without writing to disk first.
   */
  async putBuffer(buffer: Buffer, storageKey: string, opts: PutOptions = {}): Promise<void> {
    if (this.driver === 'S3') {
      await this.s3!.send(new PutObjectCommand({
        Bucket:      this.bucket!,
        Key:         storageKey,
        Body:        buffer,
        ContentType: opts.contentType,
        ACL:         opts.publicRead ? 'public-read' : undefined,
      }));
    } else {
      const destAbs = path.join(this.localRoot, storageKey);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      await fs.promises.writeFile(destAbs, buffer);
    }
  }

  /**
   * Returns a Readable stream for the stored file. Used by download endpoints.
   * Throws NotFoundException if the key doesn't exist.
   */
  async getStream(storageKey: string): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
    if (this.driver === 'S3') {
      try {
        const res = await this.s3!.send(new GetObjectCommand({
          Bucket: this.bucket!,
          Key:    storageKey,
        }));
        if (!res.Body) throw new NotFoundException('File not found in storage.');
        // SDK v3 returns a stream-like object; cast to Readable for Node.
        return {
          stream:        res.Body as Readable,
          contentType:   res.ContentType,
          contentLength: res.ContentLength,
        };
      } catch (err: any) {
        if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') {
          throw new NotFoundException('File not found in storage.');
        }
        throw err;
      }
    } else {
      const absPath = path.join(this.localRoot, storageKey);
      // Path-traversal guard — the resolved absolute path must remain inside
      // the uploads root.
      const normalized = path.resolve(absPath);
      if (!normalized.startsWith(this.localRoot + path.sep) && normalized !== this.localRoot) {
        throw new NotFoundException('File not found.');
      }
      if (!fs.existsSync(absPath)) {
        throw new NotFoundException('File not found.');
      }
      const stat = await fs.promises.stat(absPath);
      return {
        stream:        fs.createReadStream(absPath),
        contentLength: stat.size,
      };
    }
  }

  /** Delete a file. Returns true if it was deleted, false if it didn't exist. */
  async delete(storageKey: string): Promise<boolean> {
    if (this.driver === 'S3') {
      try {
        // HEAD first so we can return false for not-found
        await this.s3!.send(new HeadObjectCommand({ Bucket: this.bucket!, Key: storageKey }));
        await this.s3!.send(new DeleteObjectCommand({ Bucket: this.bucket!, Key: storageKey }));
        return true;
      } catch (err: any) {
        if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false;
        throw err;
      }
    } else {
      const absPath = path.join(this.localRoot, storageKey);
      try {
        await fs.promises.unlink(absPath);
        return true;
      } catch (err: any) {
        if (err?.code === 'ENOENT') return false;
        throw err;
      }
    }
  }

  /**
   * For public assets (product images), returns the URL clients can use to
   * fetch the file directly. On S3 this is the configured public URL or
   * presigned URL; on LOCAL this is the /uploads static-served path.
   */
  getPublicUrl(storageKey: string): string {
    if (this.driver === 'S3' && this.publicUrlBase) {
      // e.g. https://<bucket>.<account>.r2.dev/<key>
      const base = this.publicUrlBase.replace(/\/$/, '');
      return `${base}/${storageKey}`;
    }
    // Fallback: serve via the API's static-asset middleware at /uploads/...
    return `/uploads/${storageKey}`;
  }
}
