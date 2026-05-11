/**
 * BackupService — read-side of the backup pipeline.
 *
 * The scheduler in `backup.scheduler.ts` writes nightly JSON snapshots to
 * R2/S3 under `backups/<YYYY-MM-DD>/<tenant-slug>.json`. This service is
 * the symmetrical READ path: it lets the platform admin enumerate snapshots
 * for any tenant and lets a tenant owner download their own latest copy
 * for cold-storage / off-system custody.
 *
 * Restore (write-side) lives at the bottom of this file — `previewRestore`
 * and `applyRestore`. Scope is intentionally narrow: operational data only
 * (orders, journal entries, accounting events, products, inventory, raw
 * materials). Identity-shaped tables (Tenant, Branch, User, Customer,
 * Vendor) are NOT touched on restore — they intersect with the live state
 * in ways that aren't safe to auto-rollback (new hires, password resets,
 * customer additions between snapshot date and incident). Use the
 * downloaded JSON for those if needed; we'll do them by hand.
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

  // ─── Restore (write-side) ─────────────────────────────────────────────────
  //
  // Restore wipes the operational data tables and reinserts from a snapshot.
  // It does NOT touch identity-shaped tables (Tenant itself, Branch, User,
  // Customer, Vendor) — those usually shouldn't roll back during a recovery
  // because a) staff lists change between snapshot and incident, and
  // b) restoring users without passwordHash would lock everyone out anyway.
  //
  // SCOPE — the tables this restore writes (mirrors `clearAllTenantData`):
  //   journalEntry + journalLine
  //   accountingEvent
  //   order + orderItem + orderPayment
  //   inventoryLog
  //   inventoryItem
  //   product (+ bomItem)
  //   category
  //   rawMaterial (+ rawMaterialInventory)
  //
  // Out of scope (kept as they exist in the live DB):
  //   Tenant, Branch, User, AppAccess, Customer, Vendor, APBill, ARInvoice,
  //   PayRun, Payslip, KioskTerminal, etc. If those need rollback, support
  //   handles them in a follow-up via the JSON snapshot.
  //
  // Safety invariants:
  //   1. SUPER_ADMIN only. No tenant owner can call this.
  //   2. Typed-slug confirmation required (matches clearAllTenantData).
  //   3. Pre-restore TenantDataSnapshot is taken FIRST. If anything goes
  //      wrong, the platform admin can re-restore from that snapshot.
  //   4. Wrapped in a single $transaction — partial restores are impossible.
  //   5. Audited via the existing logger.

  /**
   * Parse the snapshot JSON and report what restore WOULD do, without
   * touching the database. Used to drive the admin UI's confirmation step.
   */
  async previewRestore(slug: string, date: string): Promise<{
    snapshotMeta: BackupSnapshotMeta;
    snapshotGeneratedAt: string | null;
    snapshotTenantId: string | null;
    willInsertCounts: Record<string, number>;
    willDeleteCounts: Record<string, number>;
    targetTenantId: string;
  }> {
    const meta = await this.resolveSnapshotKey(slug, date);
    const payload = await this.storage.getJson<Record<string, unknown>>(meta.key);
    const snapshotTenantId = typeof payload['tenantId'] === 'string' ? payload['tenantId'] as string : null;
    if (!snapshotTenantId) {
      throw new BadRequestException('Snapshot has no tenantId — refusing to restore.');
    }
    // The snapshot's tenantId must match a currently-existing tenant with
    // the same slug. Otherwise the data would land in the wrong row set.
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: snapshotTenantId, slug }, select: { id: true },
    });
    if (!tenant) {
      throw new BadRequestException(
        `Snapshot tenantId (${snapshotTenantId}) doesn't match a live tenant with slug "${slug}". ` +
        `The tenant may have been deleted or its slug renamed.`,
      );
    }

    const arr = (k: string): unknown[] => Array.isArray(payload[k]) ? payload[k] as unknown[] : [];
    const willInsertCounts: Record<string, number> = {
      journalEntries:    arr('journalEntries').length,
      journalLines:      arr('journalLines').length,
      accountingEvents:  arr('accountingEvents').length,
      orders:            arr('orders').length,
      items:             arr('items').length,
      payments:          arr('payments').length,
      products:          arr('products').length,
      categories:        arr('categories').length,
      rawMaterials:      arr('rawMaterials').length,
    };

    // What would be deleted = current row counts in the same tables.
    const [
      curJE, curJL, curAE, curOrd, curItems, curPay,
      curProd, curCat, curRM, curInvL, curInvI,
    ] = await Promise.all([
      this.prisma.journalEntry.count({ where: { tenantId: snapshotTenantId } }),
      this.prisma.journalLine.count({ where: { journalEntry: { tenantId: snapshotTenantId } } }),
      this.prisma.accountingEvent.count({ where: { tenantId: snapshotTenantId } }),
      this.prisma.order.count({ where: { tenantId: snapshotTenantId } }),
      this.prisma.orderItem.count({ where: { order: { tenantId: snapshotTenantId } } }),
      this.prisma.orderPayment.count({ where: { order: { tenantId: snapshotTenantId } } }),
      this.prisma.product.count({ where: { tenantId: snapshotTenantId } }),
      this.prisma.category.count({ where: { tenantId: snapshotTenantId } }),
      this.prisma.rawMaterial.count({ where: { tenantId: snapshotTenantId } }),
      this.prisma.inventoryLog.count({ where: { tenantId: snapshotTenantId } }),
      this.prisma.inventoryItem.count({ where: { tenantId: snapshotTenantId } }),
    ]);
    const willDeleteCounts: Record<string, number> = {
      journalEntries:   curJE,
      journalLines:     curJL,
      accountingEvents: curAE,
      orders:           curOrd,
      orderItems:       curItems,
      orderPayments:    curPay,
      products:         curProd,
      categories:       curCat,
      rawMaterials:     curRM,
      inventoryLogs:    curInvL,
      inventoryItems:   curInvI,
    };

    return {
      snapshotMeta:        meta,
      snapshotGeneratedAt: typeof payload['generatedAt'] === 'string' ? payload['generatedAt'] as string : null,
      snapshotTenantId,
      targetTenantId:      tenant.id,
      willInsertCounts,
      willDeleteCounts,
    };
  }

  /**
   * Apply a restore. Typed-slug confirmation MUST equal the tenant's slug.
   * Pre-restore snapshot is taken first; the whole wipe + reinsert runs in
   * one Postgres transaction so partial state is impossible.
   *
   * Returns row counts inserted per table + the pre-restore snapshot id so
   * the platform admin has the recovery handle if something looks wrong.
   */
  async applyRestore(args: {
    slug:               string;
    date:               string;
    confirmationToken:  string;
    actorEmail:         string;
  }): Promise<{
    targetTenantId:    string;
    snapshotKey:       string;
    preRestoreSnapshotId: string;
    inserted:          Record<string, number>;
  }> {
    const { slug, date, confirmationToken, actorEmail } = args;
    if (confirmationToken !== slug) {
      throw new BadRequestException(
        `Confirmation mismatch. Type the tenant slug exactly: "${slug}".`,
      );
    }
    const meta = await this.resolveSnapshotKey(slug, date);
    const payload = await this.storage.getJson<Record<string, unknown>>(meta.key);
    const snapshotTenantId = typeof payload['tenantId'] === 'string' ? payload['tenantId'] as string : null;
    if (!snapshotTenantId) {
      throw new BadRequestException('Snapshot has no tenantId — refusing to restore.');
    }
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: snapshotTenantId, slug }, select: { id: true, slug: true },
    });
    if (!tenant) {
      throw new BadRequestException(
        `Snapshot tenantId (${snapshotTenantId}) doesn't match a live tenant with slug "${slug}".`,
      );
    }

    // 1) Pre-restore snapshot of CURRENT state (so the restore is itself
    //    reversible if it lands wrong). Stored in TenantDataSnapshot for 30
    //    days, queryable via the existing admin listSnapshots endpoint.
    const preRestoreSnapshot = await this.takePreRestoreSnapshot(tenant.id, actorEmail);

    // 2) Wipe + reinsert in one transaction. Use a generous timeout — for
    //    large tenants (50k orders, 200k items, 200k journal lines) the
    //    insert phase can take 30s+ on Railway hardware.
    const arrOf = <T>(k: string): T[] => Array.isArray(payload[k]) ? payload[k] as T[] : [];

    const inserted: Record<string, number> = {};

    await this.prisma.$transaction(async (tx) => {
      // ── Wipe (FK-dependency order — leaves first) ───────────────────────
      await tx.journalLine.deleteMany({ where: { journalEntry: { tenantId: tenant.id } } });
      await tx.journalEntry.deleteMany({ where: { tenantId: tenant.id } });
      await tx.accountingEvent.deleteMany({ where: { tenantId: tenant.id } });
      await tx.orderItem.deleteMany({ where: { order: { tenantId: tenant.id } } });
      await tx.orderPayment.deleteMany({ where: { order: { tenantId: tenant.id } } });
      await tx.order.deleteMany({ where: { tenantId: tenant.id } });
      await tx.inventoryLog.deleteMany({ where: { tenantId: tenant.id } });
      await tx.inventoryItem.deleteMany({ where: { tenantId: tenant.id } });
      await tx.bomItem.deleteMany({ where: { product: { tenantId: tenant.id } } });
      await tx.product.deleteMany({ where: { tenantId: tenant.id } });
      await tx.category.deleteMany({ where: { tenantId: tenant.id } });
      await tx.rawMaterialInventory.deleteMany({ where: { rawMaterial: { tenantId: tenant.id } } });
      await tx.rawMaterial.deleteMany({ where: { tenantId: tenant.id } });

      // ── Reinsert (FK-dependency order — roots first) ────────────────────
      // For each table we re-attach `tenantId: tenant.id` so we don't trust
      // the snapshot's foreign keys to a stale id (snapshot's tenantId IS
      // tenant.id here, but defensive).

      // Categories (no FK to other restored rows)
      const cats = arrOf<any>('categories');
      for (const c of cats) {
        await tx.category.create({ data: this.stripIdForRestore({ ...c, tenantId: tenant.id }) });
      }
      inserted.categories = cats.length;

      // RawMaterials → RawMaterialInventory (inventory has FK to rawMaterial)
      const rms = arrOf<any>('rawMaterials');
      for (const rm of rms) {
        const { inventory, ...rest } = rm;
        await tx.rawMaterial.create({ data: this.stripIdForRestore({ ...rest, tenantId: tenant.id }) });
        if (Array.isArray(inventory)) {
          for (const inv of inventory) {
            await tx.rawMaterialInventory.create({ data: this.stripIdForRestore(inv) });
          }
        }
      }
      inserted.rawMaterials = rms.length;

      // Products → BomItems
      const prods = arrOf<any>('products');
      for (const p of prods) {
        const { bomItems, ...rest } = p;
        await tx.product.create({ data: this.stripIdForRestore({ ...rest, tenantId: tenant.id }) });
        if (Array.isArray(bomItems)) {
          for (const b of bomItems) {
            await tx.bomItem.create({ data: this.stripIdForRestore(b) });
          }
        }
      }
      inserted.products = prods.length;

      // InventoryItem
      const invItems = arrOf<any>('inventoryItems');
      for (const i of invItems) {
        await tx.inventoryItem.create({ data: this.stripIdForRestore({ ...i, tenantId: tenant.id }) });
      }
      inserted.inventoryItems = invItems.length;

      // Orders → items, payments
      const orders = arrOf<any>('orders');
      for (const o of orders) {
        await tx.order.create({ data: this.stripIdForRestore({ ...o, tenantId: tenant.id }) });
      }
      inserted.orders = orders.length;

      const items = arrOf<any>('items');
      for (const it of items) {
        await tx.orderItem.create({ data: this.stripIdForRestore(it) });
      }
      inserted.orderItems = items.length;

      const payments = arrOf<any>('payments');
      for (const p of payments) {
        await tx.orderPayment.create({ data: this.stripIdForRestore(p) });
      }
      inserted.orderPayments = payments.length;

      // InventoryLog (after orders so referenceId FK resolves)
      const invLogs = arrOf<any>('inventoryLogs');
      for (const l of invLogs) {
        await tx.inventoryLog.create({ data: this.stripIdForRestore({ ...l, tenantId: tenant.id }) });
      }
      inserted.inventoryLogs = invLogs.length;

      // AccountingEvent (FK to order)
      const events = arrOf<any>('accountingEvents');
      for (const e of events) {
        await tx.accountingEvent.create({ data: this.stripIdForRestore({ ...e, tenantId: tenant.id }) });
      }
      inserted.accountingEvents = events.length;

      // JournalEntry → JournalLine
      const jes = arrOf<any>('journalEntries');
      for (const je of jes) {
        await tx.journalEntry.create({ data: this.stripIdForRestore({ ...je, tenantId: tenant.id }) });
      }
      inserted.journalEntries = jes.length;

      const jls = arrOf<any>('journalLines');
      for (const jl of jls) {
        await tx.journalLine.create({ data: this.stripIdForRestore(jl) });
      }
      inserted.journalLines = jls.length;
    }, {
      timeout: 5 * 60 * 1000, // 5 minutes — plenty for even a heavy tenant
      maxWait: 30 * 1000,
    });

    this.logger.warn(
      `[restore] Tenant ${tenant.slug} (${tenant.id}) restored from ${meta.key} by ${actorEmail}. ` +
      `Pre-restore snapshot=${preRestoreSnapshot.id}. Inserted: ${JSON.stringify(inserted)}`,
    );

    return {
      targetTenantId:       tenant.id,
      snapshotKey:          meta.key,
      preRestoreSnapshotId: preRestoreSnapshot.id,
      inserted,
    };
  }

  /**
   * Capture the current state into TenantDataSnapshot before we wipe.
   * Mirrors AdminService.snapshotTenantData but lives here so restore is
   * fully self-contained (no cross-service import).
   */
  private async takePreRestoreSnapshot(
    tenantId: string,
    actorEmail: string,
  ): Promise<{ id: string; rowCount: number }> {
    const [
      orders, accountingEvents, journalEntries,
      products, categories, rawMaterials,
      inventoryItems, inventoryLogs,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId },
        include: { items: true, payments: true, discounts: true },
      }),
      this.prisma.accountingEvent.findMany({ where: { tenantId } }),
      this.prisma.journalEntry.findMany({
        where: { tenantId },
        include: { lines: true },
      }),
      this.prisma.product.findMany({
        where: { tenantId },
        include: { bomItems: true },
      }),
      this.prisma.category.findMany({ where: { tenantId } }),
      this.prisma.rawMaterial.findMany({
        where: { tenantId },
        include: { inventory: true },
      }),
      this.prisma.inventoryItem.findMany({ where: { tenantId } }),
      this.prisma.inventoryLog.findMany({ where: { tenantId } }),
    ]);

    const rowCount =
      orders.length + accountingEvents.length + journalEntries.length +
      products.length + categories.length + rawMaterials.length +
      inventoryItems.length + inventoryLogs.length;

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    return this.prisma.tenantDataSnapshot.create({
      data: {
        tenantId,
        reason:       'PRE_RESTORE', // free-text in schema; appears in admin snapshot list
        takenById:    null,
        takenByEmail: actorEmail,
        rowCount,
        payload: {
          orders, accountingEvents, journalEntries,
          products, categories, rawMaterials,
          inventoryItems, inventoryLogs,
        } as any,
        expiresAt,
      },
      select: { id: true, rowCount: true },
    });
  }

  /**
   * Prepare a row from the snapshot for re-insert. We KEEP `id` because
   * dependent rows in later inserts have foreign keys pointing at it (e.g.
   * OrderItem.orderId, JournalLine.journalEntryId, BomItem.productId).
   * We drop `updatedAt` because Prisma manages it automatically and feeding
   * a stale string in can throw a validation error on some adapters.
   */
  private stripIdForRestore(row: Record<string, unknown>): any {
    const { updatedAt: _updatedAt, ...rest } = row;
    return rest;
  }
}
