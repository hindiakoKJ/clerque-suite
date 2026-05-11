/**
 * BackupController — owner + platform admin endpoints over BackupService.
 *
 * Two surfaces share this controller:
 *
 *   /backups/mine                 — tenant owner: list / download / preview
 *                                   their own tenant's snapshots
 *   /admin/backups/:slug          — platform SUPER_ADMIN: same, for ANY
 *                                   tenant (incident response, customer
 *                                   support, suspended-tenant restoration)
 *
 * Restore (write-side) is intentionally NOT exposed here. Reading + handing
 * the JSON to the owner is safe; rewriting the database from a snapshot
 * needs a separate, carefully-tested code path that lands in the next
 * sprint. Today, restore = download JSON → support engineer manually
 * inspects + re-inserts. The download endpoint is enough to unblock that
 * loop.
 */
import {
  Controller, Get, Param, Query, Res, UseGuards, NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BackupService } from './backup.service';

@ApiTags('Backups')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class BackupController {
  constructor(private readonly svc: BackupService) {}

  // ─── Owner self-service ─────────────────────────────────────────────────

  /**
   * GET /backups/mine — list every snapshot we hold for the caller's tenant.
   * Owner sees newest-first; usually they only care about last night's.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get('backups/mine')
  async listMine(@CurrentUser() user: JwtPayload) {
    const slug = await this.svc.getSlugForTenant(user.tenantId!);
    const rows = await this.svc.listForTenantSlug(slug);
    return { tenantSlug: slug, count: rows.length, snapshots: rows };
  }

  /**
   * GET /backups/mine/preview?date=YYYY-MM-DD (optional, defaults to latest)
   * Returns per-table row counts so the owner can confirm what's in the
   * snapshot before downloading.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get('backups/mine/preview')
  async previewMine(
    @CurrentUser() user: JwtPayload,
    @Query('date') date?: string,
  ) {
    const slug = await this.svc.getSlugForTenant(user.tenantId!);
    return this.svc.previewSnapshot(slug, date);
  }

  /**
   * GET /backups/mine/download?date=YYYY-MM-DD — stream the JSON to the
   * browser as a file download. Tenant owners can keep cold copies on a
   * USB drive, send to their accountant, hand to a forensics team after
   * a breach, etc.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get('backups/mine/download')
  async downloadMine(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: false }) res: Response,
    @Query('date') date?: string,
  ) {
    const slug = await this.svc.getSlugForTenant(user.tenantId!);
    const { meta, stream, contentLength } = await this.svc.getSnapshotStream(slug, date);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', String(contentLength));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="clerque-backup-${slug}-${meta.date}.json"`,
    );
    stream.pipe(res);
  }

  // ─── Platform admin (any tenant) ────────────────────────────────────────

  /** GET /admin/backups/:slug — list snapshots for any tenant. */
  @Roles('SUPER_ADMIN')
  @Get('admin/backups/:slug')
  async listForSlug(@Param('slug') slug: string) {
    const rows = await this.svc.listForTenantSlug(slug);
    return { tenantSlug: slug, count: rows.length, snapshots: rows };
  }

  /** GET /admin/backups/:slug/preview — preview any tenant's snapshot. */
  @Roles('SUPER_ADMIN')
  @Get('admin/backups/:slug/preview')
  async previewForSlug(
    @Param('slug') slug: string,
    @Query('date') date?: string,
  ) {
    return this.svc.previewSnapshot(slug, date);
  }

  /** GET /admin/backups/:slug/download — download any tenant's snapshot. */
  @Roles('SUPER_ADMIN')
  @Get('admin/backups/:slug/download')
  async downloadForSlug(
    @Param('slug') slug: string,
    @Res({ passthrough: false }) res: Response,
    @Query('date') date?: string,
  ) {
    const { meta, stream, contentLength } = await this.svc.getSnapshotStream(slug, date);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', String(contentLength));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="clerque-backup-${slug}-${meta.date}.json"`,
    );
    stream.pipe(res);
  }
}
