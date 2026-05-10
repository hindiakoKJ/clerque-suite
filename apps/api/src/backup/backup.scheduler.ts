/**
 * Sprint 19 — Off-box daily backup.
 *
 * Each night at 02:00 server time, snapshots every tenant's critical
 * tables into a JSON payload and POSTs them to a webhook URL configured
 * via env. The webhook is the customer's responsibility — typical setups:
 *
 *   - Cloudflare Worker that signs the body and forwards to R2 with
 *     Object Lock (ransomware-proof: encrypted attacker on the API
 *     server cannot delete or overwrite past versions).
 *   - AWS Lambda that PUTs to S3 with versioning + lifecycle to Glacier.
 *   - On-prem rsync target via a tunneled HTTPS endpoint.
 *
 * The point: snapshots leave the Postgres instance, so a database-level
 * compromise (ransomware encryption, admin DROP, hardware failure) does
 * not lose the recovery copy. This complements the in-DB
 * TenantDataSnapshot table (30-day pre-destructive backups) which only
 * survives Postgres-level data loss, not Postgres-level attacks.
 *
 * Configuration (env-gated — no-op when unset):
 *   BACKUP_WEBHOOK_URL    — POST endpoint
 *   BACKUP_WEBHOOK_TOKEN  — Bearer token sent in Authorization header
 *
 * If unset, the scheduler logs "no destination configured; skipping" and
 * exits — useful for local dev / staging without leaking data.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BackupScheduler {
  private readonly logger = new Logger(BackupScheduler.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 02:00 server time every day. Picks 02:00 because:
   *   - PH businesses are closed; no contention with live writes
   *   - Sales for the previous PH day (00:00 UTC+8) are fully posted
   *     and journal-synced by 17:00 UTC the previous day, so a 02:00 UTC
   *     snapshot captures a clean closed accounting period
   */
  @Cron('0 2 * * *')
  async runDailyBackup() {
    if (this.running) return; // overlap-skip
    this.running = true;
    try {
      await this.backupAllTenants();
    } catch (err) {
      this.logger.error(
        `[backup] daily run failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Internal entry point — also exposed publicly for ops `npm run
   * backup:now` style triggers via a CLI hook. Iterates every tenant
   * and uploads.
   */
  async backupAllTenants(): Promise<{ uploaded: number; skipped: number; failed: number }> {
    const url   = process.env.BACKUP_WEBHOOK_URL;
    const token = process.env.BACKUP_WEBHOOK_TOKEN;
    if (!url) {
      this.logger.warn('[backup] BACKUP_WEBHOOK_URL not set — daily backup skipped (configure env to enable).');
      return { uploaded: 0, skipped: 0, failed: 0 };
    }

    const tenants = await this.prisma.tenant.findMany({
      where:  { status: { in: ['ACTIVE', 'GRACE'] } },
      select: { id: true, slug: true, isDemoTenant: true },
    });

    let uploaded = 0, skipped = 0, failed = 0;
    for (const t of tenants) {
      try {
        const payload = await this.buildPayload(t.id);
        const ok = await this.postToWebhook(url, token, t.slug, payload);
        if (ok) uploaded++;
        else failed++;
      } catch (err) {
        failed++;
        this.logger.error(`[backup] tenant ${t.slug} failed: ${(err as Error).message}`);
      }
    }
    this.logger.log(`[backup] daily run: uploaded=${uploaded} failed=${failed} skipped=${skipped} of ${tenants.length} tenants`);
    return { uploaded, skipped, failed };
  }

  /**
   * Gather every table that's critical to operational continuity for
   * the given tenant. Mirrors the in-DB TenantDataSnapshot helper (in
   * AdminService) but goes wider — adds users, branches, accounts, payroll
   * data so a full-platform restore is possible from this single dump.
   *
   * Sensitive fields that are NOT included:
   *   - User.passwordHash (bcrypt — useless to attacker but pollutes the
   *     backup; on restore, reset all passwords via console anyway)
   *   - User.twoFactorSecret + twoFactorBackupCodes (same logic — re-enroll on restore)
   *   - tenant_data_snapshots themselves (would explode size; recover-of-recover is silly)
   */
  private async buildPayload(tenantId: string) {
    const [
      tenant, branches, users, products, categories, rawMaterials,
      orders, payments, items, journalEntries, journalLines, accountingEvents,
      accounts, periods, payRuns, payslips, leaveRequests, employeeRequests,
      customers, vendors, expenseEntries, vendorBills,
      laundryOrders, laundryMachines, laundryWashCycles,
      tripTickets, fleetAssets, jobOrders, projects,
    ] = await this.prisma.$transaction([
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
      this.prisma.branch.findMany({ where: { tenantId } }),
      this.prisma.user.findMany({
        where: { tenantId },
        select: {
          // explicit allow-list; passwordHash + 2FA secrets excluded
          id: true, tenantId: true, branchId: true, email: true, name: true,
          role: true, employmentType: true, salaryType: true, salaryRate: true,
          shiftStart: true, shiftEnd: true, sssNumber: true, philhealthNumber: true,
          pagibigNumber: true, tin: true, phone: true, position: true,
          isActive: true, hiredAt: true, separatedAt: true,
          separationType: true, separationReason: true,
          enable2fa: true, createdAt: true, updatedAt: true,
        },
      }),
      this.prisma.product.findMany({ where: { tenantId }, include: { bomItems: true } }),
      this.prisma.category.findMany({ where: { tenantId } }),
      this.prisma.rawMaterial.findMany({ where: { tenantId }, include: { inventory: true } }),
      this.prisma.order.findMany({ where: { tenantId }, take: 50_000, orderBy: { createdAt: 'desc' } }),
      this.prisma.orderPayment.findMany({ where: { order: { tenantId } }, take: 100_000 }),
      this.prisma.orderItem.findMany({ where: { order: { tenantId } }, take: 200_000 }),
      this.prisma.journalEntry.findMany({ where: { tenantId }, take: 50_000 }),
      this.prisma.journalLine.findMany({ where: { journalEntry: { tenantId } }, take: 200_000 }),
      this.prisma.accountingEvent.findMany({ where: { tenantId }, take: 50_000 }),
      this.prisma.account.findMany({ where: { tenantId } }),
      this.prisma.accountingPeriod.findMany({ where: { tenantId } }),
      this.prisma.payRun.findMany({ where: { tenantId } }),
      this.prisma.payslip.findMany({ where: { tenantId } }),
      this.prisma.leaveRequest.findMany({ where: { tenantId } }),
      this.prisma.employeeRequest.findMany({ where: { tenantId } }),
      this.prisma.customer.findMany({ where: { tenantId } }),
      this.prisma.vendor.findMany({ where: { tenantId } }),
      this.prisma.expenseEntry.findMany({ where: { tenantId } }),
      this.prisma.aPBill.findMany({ where: { tenantId } }),
      this.prisma.laundryOrder.findMany({ where: { tenantId } }),
      this.prisma.laundryMachine.findMany({ where: { tenantId } }),
      this.prisma.laundryWashCycle.findMany({ where: { tenantId } }),
      this.prisma.tripTicket.findMany({ where: { tenantId } }),
      this.prisma.fleetAsset.findMany({ where: { tenantId } }),
      this.prisma.jobOrder.findMany({ where: { tenantId } }),
      this.prisma.project.findMany({ where: { tenantId } }),
    ]);

    return {
      version: 'clerque-backup-v1',
      generatedAt: new Date().toISOString(),
      tenantId,
      tenant, branches, users,
      products, categories, rawMaterials,
      orders, payments, items,
      journalEntries, journalLines, accountingEvents,
      accounts, periods,
      payRuns, payslips, leaveRequests, employeeRequests,
      customers, vendors, expenseEntries, vendorBills,
      laundryOrders, laundryMachines, laundryWashCycles,
      tripTickets, fleetAssets, jobOrders, projects,
    };
  }

  private async postToWebhook(
    url: string,
    token: string | undefined,
    tenantSlug: string,
    payload: object,
  ): Promise<boolean> {
    try {
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type':              'application/json',
        'X-Clerque-Tenant-Slug':     tenantSlug,
        'X-Clerque-Backup-Version':  'v1',
        'X-Clerque-Generated-At':    new Date().toISOString(),
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) {
        this.logger.warn(`[backup] webhook returned ${res.status} for tenant ${tenantSlug}`);
        return false;
      }
      const sizeKb = Math.round(body.length / 1024);
      this.logger.log(`[backup] tenant ${tenantSlug} uploaded (${sizeKb} KB)`);
      return true;
    } catch (err) {
      this.logger.error(`[backup] webhook POST failed for ${tenantSlug}: ${(err as Error).message}`);
      return false;
    }
  }
}
