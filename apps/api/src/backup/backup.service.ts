/**
 * BackupService — read-side of the backup pipeline.
 *
 * The scheduler in `backup.scheduler.ts` writes nightly JSON snapshots to
 * R2/S3 under `backups/<YYYY-MM-DD>/<tenant-slug>.json`. This service is
 * the symmetrical READ path: it lets the platform admin enumerate snapshots
 * for any tenant and lets a tenant owner download their own latest copy
 * for cold-storage / off-system custody.
 *
 * It does NOT yet restore. Restore is a separate, much riskier operation
 * (wipe + rewrite, must respect FK order, must take a pre-restore
 * snapshot, must reset 2FA + passwords) — that lands as `restoreFromKey`
 * in a future sprint, after we have a staging test harness.
 *
 * Why owner self-service download:
 *   - Closes the operational loop: an owner whose tenant data is wiped
 *     by a destructive bug can hand the JSON to support + we can re-import
 *     manually within an hour. Without this they're at the mercy of
 *     platform-admin response time.
 *   - Data-portability hygiene: PH Data Privacy Act gives data subjects
 *     the right to a copy of their data. This is the first stone in that
 *     compliance path.
 */
import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export interface BackupSnapshotMeta {
  key:          string;          // R2/S3 key: backups/2026-05-10/clerque-test.json
  date:         string;          // PH-local YYYY-MM-DD parsed from the key
  sizeBytes:    number;
  sizeKb:       number;          // rounded for UI
  lastModified: string | null;   // ISO timestamp; falls back to date midnight if S3 omits
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * List every snapshot we have for a given tenant slug. Snapshots are keyed
   * `backups/<YYYY-MM-DD>/<slug>.json`. We list under `backups/` and filter
   * by suffix because R2/S3 only lets us prefix-filter; this is fine for
   * <10 years of nightly snapshots (~3650 keys).
   *
   * Returns newest-first so the owner sees their last-night snapshot at the
   * top of the list.
   */
  async listForTenantSlug(slug: string): Promise<BackupSnapshotMeta[]> {
    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
      throw new BadRequestException('Invalid tenant slug.');
    }
    if (this.storage.getDriver() !== 'S3') {
      // Local-disk dev path — still works, just lists ./uploads/backups/
      // Useful for local restore drills.
    }
    const objects = await this.storage.list('backups/');
    const needle = `/${slug}.json`;
    const rows = objects
      .filter((o) => o.key.endsWith(needle))
      .map<BackupSnapshotMeta>((o) => {
        // key shape: backups/2026-05-10/<slug>.json — extract the date.
        const m = /^backups\/(\d{4}-\d{2}-\d{2})\//.exec(o.key);
        return {
          key:          o.key,
          date:         m?.[1] ?? '',
          sizeBytes:    o.size,
          sizeKb:       Math.round(o.size / 1024),
          lastModified: o.lastModified?.toISOString() ?? null,
        };
      })
      .filter((r) => r.date) // drop malformed keys
      .sort((a, b) => b.date.localeCompare(a.date));
    return rows;
  }

  /**
   * Resolve a slug + date pair (or just slug → latest) to a concrete
   * snapshot key. Validates the snapshot exists in storage. Throws 404
   * if the snapshot wasn't taken (e.g. tenant was suspended that day, or
   * the cron failed).
   */
  async resolveSnapshotKey(slug: string, date?: string): Promise<BackupSnapshotMeta> {
    const all = await this.listForTenantSlug(slug);
    if (all.length === 0) {
      throw new NotFoundException(
        `No backups found for tenant "${slug}". Either the backup cron has never run for this tenant, ` +
        `or no S3 destination is configured (set S3_BUCKET in env).`,
      );
    }
    if (!date) return all[0];
    const found = all.find((r) => r.date === date);
    if (!found) {
      throw new NotFoundException(
        `No backup for tenant "${slug}" on ${date}. Available dates: ${all.slice(0, 5).map((r) => r.date).join(', ')}${all.length > 5 ? ', ...' : ''}.`,
      );
    }
    return found;
  }

  /**
   * Fetch the snapshot bytes for download. Returned as a stream so we can
   * pipe it straight to the HTTP response without buffering a multi-MB
   * JSON file in Node memory.
   */
  async getSnapshotStream(slug: string, date?: string) {
    const meta = await this.resolveSnapshotKey(slug, date);
    const { stream, contentLength } = await this.storage.getStream(meta.key);
    return {
      meta,
      stream,
      contentLength: contentLength ?? meta.sizeBytes,
    };
  }

  /**
   * Inspect a snapshot without restoring — returns per-table row counts so
   * the owner can sanity-check that "yes, my 12,400 orders are in here"
   * before they commit to a restore. Also surfaces the snapshot's
   * `generatedAt` so they can confirm the cutoff time.
   *
   * This loads the whole JSON in memory. Snapshots are bounded by the
   * scheduler's per-table `take:` caps (50K orders / 200K items etc.) so
   * even a heavy tenant's file is <50MB.
   */
  async previewSnapshot(slug: string, date?: string): Promise<{
    meta:        BackupSnapshotMeta;
    generatedAt: string | null;
    tenantId:    string | null;
    rowCounts:   Record<string, number>;
  }> {
    const meta = await this.resolveSnapshotKey(slug, date);
    const payload = await this.storage.getJson<Record<string, unknown>>(meta.key);
    const rowCounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (Array.isArray(v)) rowCounts[k] = v.length;
    }
    return {
      meta,
      generatedAt: typeof payload['generatedAt'] === 'string' ? payload['generatedAt'] as string : null,
      tenantId:    typeof payload['tenantId']    === 'string' ? payload['tenantId']    as string : null,
      rowCounts,
    };
  }

  /**
   * Resolve a tenantId to its slug. Used by the owner-self-service endpoint
   * which has tenantId in the JWT but the snapshot keys are slug-based.
   */
  async getSlugForTenant(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { slug: true, status: true },
    });
    if (!t) throw new NotFoundException('Tenant not found.');
    if (t.status === 'SUSPENDED') {
      throw new ForbiddenException('Tenant is suspended; backups are read-only via platform admin.');
    }
    return t.slug;
  }
}
