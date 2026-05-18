/**
 * Sprint 19 — Storage abstraction.
 *
 * Wraps file uploads behind a small interface so the service layer doesn't
 * care whether files land on disk (dev / single-instance Railway) or in
 * Cloudflare R2 / AWS S3 (production, ransomware-proof, ephemeral-disk-safe).
 *
 * The driver is selected at boot (priority order):
 *   - S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY are all set →
 *     S3-compatible cloud storage (Cloudflare R2 if S3_ENDPOINT points at
 *     a `<account>.r2.cloudflarestorage.com` URL, AWS S3 otherwise).
 *   - STORAGE_DRIVER=DB → Postgres BYTEA-backed storage (ProductPhoto table).
 *   - ./uploads is writable → LOCAL disk driver.
 *   - Otherwise → DB driver fallback (keeps Railway prod working without
 *     any extra env vars; the container filesystem is ephemeral / partially
 *     read-only there, so LOCAL would silently fail at first upload).
 *
 * Existing rows in the Document / Product table store `storagePath` as a
 * key relative to the storage root. The same key reads back from any
 * driver; switching drivers requires migrating existing files (one-time
 * upload) but does NOT require a database migration.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  HeadObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';

export type StorageDriver = 'S3' | 'LOCAL' | 'DB';

export interface PutOptions {
  /** Public URL prefix (set when using a Cloudflare R2 public bucket).
   *  When set, getPublicUrl() returns a CDN URL clients can hit directly. */
  publicUrl?: string;
  /** MIME type for Content-Type header. */
  contentType?: string;
  /** When true, PUT with public-read ACL (S3 only; ignored on R2 which uses
   *  bucket-level public access). */
  publicRead?: boolean;
  /** Tenant id for DB driver row scoping. Required when using DB driver
   *  to persist a product photo. Ignored by S3 / LOCAL. */
  tenantId?: string;
  /** Original filename, surfaced in Content-Disposition when streaming back.
   *  Used by DB driver only. */
  originalName?: string;
}

/**
 * DB driver expects a storage key of the form `<prefix>/<id>.<ext>` (e.g.
 * `public/products/<tenantId>/<cuid>.jpg`). The last path segment minus
 * extension becomes the ProductPhoto row id; the extension is dropped
 * because the mimeType column is the source of truth for content-type.
 */
function dbIdFromKey(storageKey: string): string {
  const last = storageKey.split('/').pop() ?? storageKey;
  return last.replace(/\.[^.]+$/, '');
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;
  private readonly s3: S3Client | null = null;
  private readonly bucket: string | null = null;
  private readonly publicUrlBase: string | null = null;
  private readonly localRoot: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const bucket   = this.config.get<string>('S3_BUCKET');
    const accessId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secret   = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const region   = this.config.get<string>('S3_REGION') ?? 'auto';
    const driverOverride = (this.config.get<string>('STORAGE_DRIVER') ?? '').toUpperCase();
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
    } else if (driverOverride === 'DB') {
      this.driver = 'DB';
      this.logger.log('Storage driver: DB (Postgres BYTEA, ProductPhoto table) — set via STORAGE_DRIVER=DB.');
    } else if (this.isLocalWritable()) {
      this.driver = 'LOCAL';
      this.logger.log(
        `Storage driver: LOCAL (./uploads/) — ⚠ files will NOT survive a Railway redeploy. ` +
        `Set S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY to use Cloudflare R2 / AWS S3, ` +
        `or STORAGE_DRIVER=DB to keep photos in Postgres.`,
      );
    } else {
      // Final fallback — Railway prod container fs is ephemeral / partially
      // read-only, so the LOCAL driver fails on first upload. Persist photos
      // in Postgres instead. No env vars required.
      this.driver = 'DB';
      this.logger.log(
        'Storage driver: DB (Postgres BYTEA) — ./uploads not writable, falling back to database storage.',
      );
    }
  }

  /** Probe ./uploads at boot. We can't `await` in a constructor cleanly, so
   *  use sync fs APIs — boot is a one-time cost. */
  private isLocalWritable(): boolean {
    try {
      fs.mkdirSync(this.localRoot, { recursive: true });
      // Round-trip a sentinel file to confirm writes actually land.
      const probe = path.join(this.localRoot, '.write-probe');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return true;
    } catch {
      return false;
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
    } else if (this.driver === 'DB') {
      const body = await fs.promises.readFile(tempPath);
      try {
        await this.insertDbRow(body, storageKey, opts);
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
    } else if (this.driver === 'DB') {
      await this.insertDbRow(buffer, storageKey, opts);
    } else {
      const destAbs = path.join(this.localRoot, storageKey);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      await fs.promises.writeFile(destAbs, buffer);
    }
  }

  /** Shared insert path for DB driver — derives the row id from the storage
   *  key and persists the bytea + content metadata. */
  private async insertDbRow(buffer: Buffer, storageKey: string, opts: PutOptions): Promise<void> {
    if (!opts.tenantId) {
      // DB driver is scoped to product photos right now; non-product callers
      // (e.g. backup snapshots) should configure S3 instead. Surface loudly
      // rather than silently dropping data.
      throw new Error(
        'StorageService(DB): tenantId is required to persist a blob in Postgres. ' +
        'DB driver currently supports product photos only — configure S3 for other artefacts.',
      );
    }
    const id = dbIdFromKey(storageKey);
    await this.prisma.productPhoto.create({
      data: {
        id,
        tenantId:     opts.tenantId,
        mimeType:     opts.contentType ?? 'application/octet-stream',
        byteSize:     buffer.byteLength,
        // Prisma's `Bytes` field expects a Uint8Array<ArrayBuffer>; a Node
        // Buffer (Uint8Array<ArrayBufferLike>) trips strict TS. Copy into
        // a fresh ArrayBuffer-backed view so the type narrows correctly.
        data:         (() => {
          const ab = new ArrayBuffer(buffer.byteLength);
          new Uint8Array(ab).set(buffer);
          return new Uint8Array(ab);
        })(),
        originalName: opts.originalName ?? null,
      },
    });
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
    } else if (this.driver === 'DB') {
      const id = dbIdFromKey(storageKey);
      const row = await this.prisma.productPhoto.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('File not found in storage.');
      return {
        stream:        Readable.from(row.data),
        contentType:   row.mimeType,
        contentLength: row.byteSize,
      };
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

  /**
   * List keys under a prefix. Returns each object with its key + size + last
   * modified time. Capped at 1000 results per call (S3 page limit); pass a
   * tighter prefix if a tenant accumulates more than that. Used by the
   * backup admin/owner endpoints to enumerate available snapshots.
   */
  async list(prefix: string): Promise<Array<{ key: string; size: number; lastModified: Date | null }>> {
    if (this.driver === 'S3') {
      const res = await this.s3!.send(new ListObjectsV2Command({
        Bucket: this.bucket!,
        Prefix: prefix,
        MaxKeys: 1000,
      }));
      return (res.Contents ?? [])
        .filter((c) => c.Key)
        .map((c) => ({
          key:          c.Key!,
          size:         Number(c.Size ?? 0),
          lastModified: c.LastModified ?? null,
        }));
    }
    if (this.driver === 'DB') {
      // DB driver doesn't store path-prefix metadata, so a generic `list()`
      // by prefix isn't meaningful. Backup snapshots etc. should use S3.
      return [];
    }
    // LOCAL fallback — walk the uploads tree under the prefix
    const baseAbs = path.resolve(this.localRoot, prefix);
    if (!fs.existsSync(baseAbs)) return [];
    const out: Array<{ key: string; size: number; lastModified: Date | null }> = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile()) {
          const stat = fs.statSync(abs);
          out.push({
            key:          path.relative(this.localRoot, abs).replace(/\\/g, '/'),
            size:         stat.size,
            lastModified: stat.mtime,
          });
        }
      }
    };
    walk(baseAbs);
    return out;
  }

  /**
   * Read a JSON file end-to-end into memory. Convenience wrapper around
   * getStream for the backup preview / restore endpoints.
   */
  async getJson<T = unknown>(storageKey: string): Promise<T> {
    const { stream } = await this.getStream(storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(text) as T;
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
    } else if (this.driver === 'DB') {
      const id = dbIdFromKey(storageKey);
      const res = await this.prisma.productPhoto.deleteMany({ where: { id } });
      return res.count > 0;
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
   * presigned URL; on LOCAL this is the /uploads static-served path; on DB
   * this is the API route that streams bytes back from Postgres.
   */
  getPublicUrl(storageKey: string): string {
    if (this.driver === 'S3' && this.publicUrlBase) {
      // e.g. https://<bucket>.<account>.r2.dev/<key>
      const base = this.publicUrlBase.replace(/\/$/, '');
      return `${base}/${storageKey}`;
    }
    if (this.driver === 'DB') {
      // Served by ProductPhotosController (public, cuid-id-gated). Global
      // prefix `api/v1` is applied by main.ts at boot.
      return `/api/v1/products/photos/${dbIdFromKey(storageKey)}`;
    }
    // Fallback: serve via the API's static-asset middleware at /uploads/...
    return `/uploads/${storageKey}`;
  }
}
