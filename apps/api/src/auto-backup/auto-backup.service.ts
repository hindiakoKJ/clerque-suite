/**
 * Sprint 25 Phase 2C — Auto-backup (Pro-tier).
 *
 * Nightly JSON export of tenant operational data. This phase implements the
 * generation + local-disk landing pad; Google Drive OAuth ingestion is a
 * TODO (see runDailyBackups + autoBackupConfigJson placeholder).
 *
 * Separate from the existing /backup module — that one uploads to S3/R2
 * and is wired in for ALL tenants by ops. This module is opt-in per tenant
 * (gated by the `autoBackup` plan feature) and writes a tenant-owned export
 * that the owner can later cold-store on their own Google Drive account.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { PLAN_FEATURES, type PlanCode } from '@repo/shared-types';

export interface AutoBackupConfig {
  /** Placeholder for the OAuth refresh token once Google Drive lands. */
  googleDriveTokens?: { refreshToken?: string; accessToken?: string; expiresAt?: string };
  /** Destination Google Drive folder id (once connected). */
  folderId?:        string;
  /** ISO timestamp of the last successful run — set by runDailyBackups. */
  lastBackupAt?:    string;
}

export interface AutoBackupMeta {
  path:        string;
  filename:    string;
  sizeBytes:   number;
  generatedAt: string;
}

@Injectable()
export class AutoBackupService {
  private readonly logger = new Logger(AutoBackupService.name);
  /** Local backup root — `apps/api/backups/{tenantId}/{YYYY-MM-DD}.json`. */
  private readonly backupRoot = path.resolve(process.cwd(), 'backups');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gather all tenant-scoped operational data into a single JSON blob.
   * Intentionally narrow — orders, products, customers, raw materials and
   * the FEFO lots. Sister flows (journal entries, accounting events) belong
   * to the platform's broader BackupService.
   */
  async generateBackup(tenantId: string): Promise<{
    generatedAt: string;
    tenantId:    string;
    counts:      Record<string, number>;
    data:        Record<string, unknown>;
  }> {
    const [products, orders, customers, rawMaterials, rawMaterialLots] = await Promise.all([
      this.prisma.product.findMany({ where: { tenantId } }),
      this.prisma.order.findMany({
        where:   { tenantId },
        include: { items: true, payments: true },
      }),
      this.prisma.customer.findMany({ where: { tenantId } }),
      this.prisma.rawMaterial.findMany({ where: { tenantId } }),
      this.prisma.rawMaterialLot.findMany({ where: { tenantId } }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      tenantId,
      counts: {
        products:        products.length,
        orders:          orders.length,
        customers:       customers.length,
        rawMaterials:    rawMaterials.length,
        rawMaterialLots: rawMaterialLots.length,
      },
      data: {
        products, orders, customers, rawMaterials, rawMaterialLots,
      },
    };
  }

  /**
   * Cron entry-point. Runs nightly at 02:00 local, sweeps every tenant whose
   * plan has the autoBackup feature, writes one file per tenant to disk.
   *
   * TODO: After Google Drive OAuth lands, also push the JSON to the owner's
   * connected drive folder and update autoBackupConfigJson.lastBackupAt.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailyBackups(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({
      where:  { status: 'ACTIVE' },
      select: { id: true, planCode: true, slug: true },
    });

    const eligible = tenants.filter((t) => {
      const features = PLAN_FEATURES[t.planCode as PlanCode];
      return features?.autoBackup === true;
    });

    this.logger.log(`[auto-backup] running for ${eligible.length} tenant(s)`);

    for (const t of eligible) {
      try {
        const blob = await this.generateBackup(t.id);
        const meta = await this.writeToDisk(t.id, blob);
        await this.recordLastBackup(t.id, meta.generatedAt);
        this.logger.log(`[auto-backup] ${t.slug} -> ${meta.path} (${meta.sizeBytes} bytes)`);
      } catch (err) {
        this.logger.error(`[auto-backup] failed for tenant ${t.slug} (${t.id})`, err as Error);
      }
    }
  }

  /**
   * Manually trigger a backup for one tenant. Used by the owner self-service
   * "Run backup now" button and as the eval hook in tests.
   */
  async runForTenant(tenantId: string): Promise<{
    meta: AutoBackupMeta;
    blob: Awaited<ReturnType<AutoBackupService['generateBackup']>>;
  }> {
    const blob = await this.generateBackup(tenantId);
    const meta = await this.writeToDisk(tenantId, blob);
    await this.recordLastBackup(tenantId, meta.generatedAt);
    return { meta, blob };
  }

  /** Newest file in `backups/{tenantId}/`, or null if none has ever run. */
  async getLatestBackup(tenantId: string): Promise<AutoBackupMeta | null> {
    const dir = path.join(this.backupRoot, tenantId);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
    if (files.length === 0) return null;
    const filename = files[0];
    const full = path.join(dir, filename);
    const stat = fs.statSync(full);
    return {
      path:        full,
      filename,
      sizeBytes:   stat.size,
      generatedAt: stat.mtime.toISOString(),
    };
  }

  /** Read the placeholder Drive-config JSON off Tenant.autoBackupConfigJson. */
  async getConfig(tenantId: string): Promise<AutoBackupConfig> {
    const t = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { autoBackupConfigJson: true },
    });
    return (t?.autoBackupConfigJson as AutoBackupConfig | null) ?? {};
  }

  /** Patch (shallow-merge) the auto-backup config blob on the Tenant row. */
  async updateConfig(tenantId: string, patch: Partial<AutoBackupConfig>): Promise<AutoBackupConfig> {
    const existing = await this.getConfig(tenantId);
    const next: AutoBackupConfig = { ...existing, ...patch };
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data:  { autoBackupConfigJson: next as object },
    });
    return next;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async writeToDisk(
    tenantId: string,
    blob: Awaited<ReturnType<AutoBackupService['generateBackup']>>,
  ): Promise<AutoBackupMeta> {
    const dir = path.join(this.backupRoot, tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const filename = `${date}.json`;
    const full = path.join(dir, filename);
    const json = JSON.stringify(blob, null, 2);
    fs.writeFileSync(full, json, 'utf8');
    return {
      path:        full,
      filename,
      sizeBytes:   Buffer.byteLength(json, 'utf8'),
      generatedAt: blob.generatedAt,
    };
  }

  private async recordLastBackup(tenantId: string, generatedAt: string): Promise<void> {
    try {
      await this.updateConfig(tenantId, { lastBackupAt: generatedAt });
    } catch (err) {
      // Non-fatal — disk write already succeeded; log and move on.
      this.logger.warn(`[auto-backup] could not update lastBackupAt for ${tenantId}: ${(err as Error).message}`);
    }
  }
}
