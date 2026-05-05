import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COFFEE_SHOP_LAYOUTS,
  type CoffeeShopTier,
  type CoffeeShopLayoutTemplate,
} from '@repo/shared-types';

/**
 * LayoutsService — manages the coffee-shop floor-layout setup.
 *
 * Three responsibilities:
 *   1. Provision the canonical Station/Printer/Terminal records for a tenant
 *      when they pick a CS tier in the setup wizard.
 *   2. Apply category → station routing defaults based on the chosen tier.
 *   3. Re-provision (idempotent) when a tenant is upgraded by Sales — keeps
 *      existing custom names but adds any new stations the higher tier needs.
 *
 * The provisioning is opinionated: per the locked structural decision, a
 * tenant on CS_3 always gets exactly 1 Bar station — owners can rename it
 * but cannot add a second Bar without upgrading to a tier that includes one.
 */
@Injectable()
export class LayoutsService {
  private readonly logger = new Logger(LayoutsService.name);

  constructor(private prisma: PrismaService) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  /** Returns the tenant's current layout state for the setup wizard / settings. */
  async getLayout(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessType: true,
        coffeeShopTier: true,
        hasCustomerDisplay: true,
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    const stations = await this.prisma.station.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { printer: true, categories: { select: { id: true, name: true } } },
    });
    const printers = await this.prisma.printer.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
    const terminals = await this.prisma.terminal.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });

    return {
      tenant,
      stations,
      printers,
      terminals,
      // Echo the canonical template so the UI can show what's "locked" vs renameable.
      template:
        tenant.coffeeShopTier
          ? COFFEE_SHOP_LAYOUTS[tenant.coffeeShopTier as CoffeeShopTier]
          : null,
    };
  }

  // ── Provision ─────────────────────────────────────────────────────────────

  /**
   * Apply (or re-apply) a Coffee Shop tier to a tenant. Provisions:
   *   - Stations per the tier template (rename-only after this — locked structure)
   *   - One Receipt printer + one printer per station with hasPrinter=true
   *   - Terminals per cashierTablets count (POS-01, POS-02, ...)
   *   - Category → Station routing using defaultCategories
   *   - Tenant.hasCustomerDisplay = template default (or supplied override for CS_1)
   *
   * Idempotent: if the tier was already applied, missing pieces are added; existing
   * records are left alone (so the owner's renames survive).
   */
  async applyCoffeeShopTier(
    tenantId: string,
    tier: CoffeeShopTier,
    opts: { customerDisplayOverride?: boolean } = {},
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessType: true, coffeeShopTier: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    if (tenant.businessType !== 'COFFEE_SHOP') {
      throw new BadRequestException(
        `Coffee Shop tiers only apply to COFFEE_SHOP businesses (this tenant is ${tenant.businessType}).`,
      );
    }
    const template: CoffeeShopLayoutTemplate = COFFEE_SHOP_LAYOUTS[tier];

    // CS_1 customer display — explicit toggle. Other tiers ignore the override
    // (their canonical setup already includes a customer display).
    const customerDisplay =
      tier === 'CS_1' && template.customerDisplayOptional
        ? opts.customerDisplayOverride ?? template.hasCustomerDisplay
        : template.hasCustomerDisplay;

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Mark tenant with the new tier
        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            coffeeShopTier: tier,
            hasCustomerDisplay: customerDisplay,
          },
        });

        // Pick the first branch (most tenants are single-branch on CS_1..CS_4)
        const branch = await tx.branch.findFirst({
          where: { tenantId, isActive: true },
          orderBy: { createdAt: 'asc' },
        });
        const branchId = branch?.id ?? null;

        // 2. Ensure a Receipt printer exists
        let receiptPrinter = await tx.printer.findFirst({
          where: { tenantId, printsReceipts: true, isActive: true },
        });
        if (!receiptPrinter) {
          receiptPrinter = await tx.printer.create({
            data: {
              tenantId,
              branchId,
              name: 'Receipt Printer',
              interface: 'BLUETOOTH_RAWBT',
              paperWidthMm: 80,
              printsReceipts: true,
              printsOrders: false,
            },
          });
        }

        // 3. Provision each station from the template
        for (let i = 0; i < template.stations.length; i++) {
          const spec = template.stations[i];
          // Identify by (tenantId, kind) — each tier has at most one of each kind.
          let station = await tx.station.findFirst({
            where: { tenantId, kind: spec.kind, isActive: true },
          });
          let stationPrinterId: string | undefined;
          if (spec.hasPrinter) {
            // Look up an existing station-specific printer with a matching name,
            // OR provision a fresh one. We do NOT reuse the receipt printer for
            // station tickets — keeps the station list clean.
            const stationPrinterName = `${spec.defaultName} Printer`;
            let p = await tx.printer.findFirst({
              where: { tenantId, name: stationPrinterName, isActive: true },
            });
            if (!p) {
              p = await tx.printer.create({
                data: {
                  tenantId,
                  branchId,
                  name: stationPrinterName,
                  interface: 'BLUETOOTH_RAWBT',
                  paperWidthMm: 80,
                  printsReceipts: false,
                  printsOrders: true,
                },
              });
            }
            stationPrinterId = p.id;
          }

          if (!station) {
            station = await tx.station.create({
              data: {
                tenantId,
                branchId,
                kind: spec.kind,
                name: spec.defaultName,
                sortOrder: i,
                hasKds: spec.hasKds,
                hasPrinter: spec.hasPrinter,
                printerId: stationPrinterId ?? null,
              },
            });
          } else {
            // Update the structural flags but keep the renamed `name`.
            await tx.station.update({
              where: { id: station.id },
              data: {
                sortOrder: i,
                hasKds: spec.hasKds,
                hasPrinter: spec.hasPrinter,
                // Don't overwrite an existing manual printer choice; only fill blanks.
                printerId: station.printerId ?? stationPrinterId ?? null,
              },
            });
          }

          // 4. Auto-route categories matching defaultCategories to this station
          //    (only when the category currently has no station assigned).
          for (const catName of spec.defaultCategories) {
            await tx.category.updateMany({
              where: {
                tenantId,
                stationId: null,
                name: { equals: catName, mode: 'insensitive' },
              },
              data: { stationId: station.id },
            });
          }
        }

        // 5. Provision Terminals (POS-01, POS-02, ...) up to template.cashierTablets
        const existingTerminals = await tx.terminal.findMany({
          where: { tenantId, isActive: true },
        });
        const needed = template.cashierTablets;
        for (let i = existingTerminals.length; i < needed; i++) {
          const num = i + 1;
          const code = `POS${String(num).padStart(2, '0')}`;
          await tx.terminal.create({
            data: {
              tenantId,
              branchId,
              name: `POS-${String(num).padStart(2, '0')}`,
              code,
            },
          });
        }
        // We do NOT auto-deactivate terminals beyond the template count —
        // downgrades preserve history. Sales can disable manually if needed.

        // 6. Re-fetch and return the layout for the UI
        return this.getLayout(tenantId);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  // ── Edits ────────────────────────────────────────────────────────────────

  /** Rename a station. Only `name` is editable per locked-structure decision. */
  async renameStation(tenantId: string, stationId: string, name: string) {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 60) {
      throw new BadRequestException('Station name must be 1-60 characters.');
    }
    const existing = await this.prisma.station.findFirst({
      where: { id: stationId, tenantId },
    });
    if (!existing) throw new NotFoundException('Station not found.');
    return this.prisma.station.update({
      where: { id: stationId },
      data: { name: trimmed },
    });
  }

  /** Assign a category to a station (or null to unroute). */
  async setCategoryStation(tenantId: string, categoryId: string, stationId: string | null) {
    const cat = await this.prisma.category.findFirst({
      where: { id: categoryId, tenantId },
    });
    if (!cat) throw new NotFoundException('Category not found.');
    if (stationId) {
      const station = await this.prisma.station.findFirst({
        where: { id: stationId, tenantId },
      });
      if (!station) throw new NotFoundException('Station not found.');
    }
    return this.prisma.category.update({
      where: { id: categoryId },
      data: { stationId },
    });
  }

  /**
   * Migrate any existing HOT_BAR + COLD_BAR stations into a single BAR.
   *
   * Old CS_5 tenants were provisioned with a Hot Bar + Cold Bar split. Most
   * operators run one bar with two baristas off a shared queue, so the new
   * canonical CS_5 has just one BAR. This method consolidates an existing
   * tenant onto the new shape:
   *
   *   1. If the tenant already has a BAR station, keep it.
   *      Otherwise promote the first HOT_BAR (or COLD_BAR) by changing its
   *      kind to BAR and renaming to "Bar".
   *   2. Reassign every category that points at HOT_BAR or COLD_BAR to the
   *      single BAR.
   *   3. Deactivate the leftover HOT_BAR / COLD_BAR stations (printer
   *      assignments are preserved on the surviving BAR; orphaned printers
   *      stay active so they can be reassigned manually).
   *
   * Idempotent — running on a tenant that's already consolidated is a no-op.
   */
  async consolidateBars(tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const stations = await tx.station.findMany({
        where:  { tenantId, isActive: true },
        select: { id: true, kind: true, name: true, printerId: true, hasKds: true, hasPrinter: true },
      });
      const bars     = stations.filter((s) => s.kind === 'BAR');
      const hotBars  = stations.filter((s) => s.kind === 'HOT_BAR');
      const coldBars = stations.filter((s) => s.kind === 'COLD_BAR');

      // Already consolidated — no Hot/Cold to merge.
      if (hotBars.length === 0 && coldBars.length === 0) {
        return {
          consolidated: false,
          message:      'Already consolidated — no Hot Bar or Cold Bar stations found.',
          barId:        bars[0]?.id ?? null,
          stations,
        };
      }

      // Pick or create the surviving Bar.
      let survivingBarId: string;
      if (bars.length > 0) {
        survivingBarId = bars[0].id;
      } else {
        // Promote the first HOT_BAR (or COLD_BAR) to BAR.
        const promote = hotBars[0] ?? coldBars[0];
        await tx.station.update({
          where: { id: promote.id },
          data:  { kind: 'BAR', name: 'Bar' },
        });
        survivingBarId = promote.id;
      }

      // Reassign categories that were routed to any HOT_BAR or COLD_BAR.
      const obsoleteIds = [
        ...hotBars.map((s) => s.id),
        ...coldBars.map((s) => s.id),
      ].filter((id) => id !== survivingBarId);

      const reroutedCount = obsoleteIds.length
        ? (await tx.category.updateMany({
            where: { tenantId, stationId: { in: obsoleteIds } },
            data:  { stationId: survivingBarId },
          })).count
        : 0;

      // Deactivate the obsolete stations.
      const deactivated = obsoleteIds.length
        ? (await tx.station.updateMany({
            where: { id: { in: obsoleteIds } },
            data:  { isActive: false },
          })).count
        : 0;

      return {
        consolidated:  true,
        message:       `Merged ${hotBars.length} Hot Bar + ${coldBars.length} Cold Bar station${(hotBars.length + coldBars.length) === 1 ? '' : 's'} into a single Bar.`,
        barId:         survivingBarId,
        rerouted:      reroutedCount,
        deactivated,
      };
    });
  }

  /** Toggle CS-1 customer display (no-op on CS-2..CS-5 where it's always on). */
  async setCustomerDisplay(tenantId: string, enabled: boolean) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { coffeeShopTier: true },
    });
    if (!tenant?.coffeeShopTier) {
      throw new BadRequestException('No coffee shop tier set for this tenant.');
    }
    if (tenant.coffeeShopTier !== 'CS_1') {
      // Higher tiers always have customer display; toggle is meaningless.
      throw new ConflictException(
        `Customer display is fixed-on for ${tenant.coffeeShopTier}; only CS_1 supports toggling it.`,
      );
    }
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { hasCustomerDisplay: enabled },
      select: { hasCustomerDisplay: true, coffeeShopTier: true },
    });
  }
}
