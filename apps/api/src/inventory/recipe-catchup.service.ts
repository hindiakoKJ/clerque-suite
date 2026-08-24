import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Recipe catch-up — replay ingredient usage for orders that were rung up
 * before their recipe existed.
 *
 * WHY THIS EXISTS
 * ---------------
 * A shop goes live on the POS long before its recipe book is finished. Sales
 * start on day one; the recipes for those drinks land days or weeks later.
 * Every sale in between deducted NOTHING from ingredient stock, because at
 * sale time the product had no BOM to walk. Without a replay the ingredient
 * balances stay permanently overstated, and the only remedy is a physical
 * recount — not an option for an owner who has already left the site.
 *
 * This service reconstructs that missed usage from the orders themselves.
 * Everything it needs was persisted at sale time: OrderItem.productId,
 * quantity, refundedQty, and the exact modifier options chosen. It applies
 * the CURRENT recipe to those historical lines using the same netting and
 * zero-floor rules as the live sale path, so a substitution recorded weeks
 * ago still resolves correctly when replayed today.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not post COGS or touch the ledger. Those orders already booked
 * their cost of sale (from Product.costPrice under product-based costing),
 * and re-booking it would double the expense. This is an INVENTORY
 * correction only — it answers "how much milk actually left the building",
 * not "what did it cost".
 *
 * DOUBLE-DEDUCTION IS THE ONLY REAL HAZARD
 * ----------------------------------------
 * A product whose recipe already existed at sale time deducted its
 * ingredients then, and replaying it would drain the same stock twice. No
 * per-order consumption record exists to detect that after the fact, so the
 * caller names the products to catch up (`productIds`) — the ones whose
 * recipes landed late. Two further guards back that up: `apply` refuses
 * unless the caller echoes the exact order count the preview returned, and
 * it refuses outright when an earlier catch-up already covered any part of
 * the same date range.
 */

/** Orders that represent real consumption. VOIDED never left the kitchen. */
const CONSUMING_STATUSES = ['PAID', 'COMPLETED', 'RETURNED'] as const;

/** entityType marker on the audit trail; also how overlap detection finds prior runs. */
const AUDIT_ENTITY = 'RECIPE_CATCHUP';

export interface CatchupRange {
  from: string;
  to: string;
  branchId?: string;
  productIds?: string[];
}

export interface CatchupLine {
  rawMaterialId: string;
  name: string;
  unit: string;
  quantityUsed: number;
  stockBefore: number;
  stockAfter: number;
  /** True when computed usage exceeds stock on hand; the balance floors at zero. */
  shortfall: boolean;
}

export interface CatchupPreview {
  from: string;
  to: string;
  branchId: string;
  orderCount: number;
  /** Products actually seen in the range, so the caller can confirm the scope. */
  products: Array<{ productId: string; name: string; unitsSold: number; hasRecipe: boolean }>;
  lines: CatchupLine[];
  /** Products sold in range that still have no recipe — usage is unreconstructable. */
  skippedNoRecipe: Array<{ productId: string; name: string; unitsSold: number }>;
  priorRuns: Array<{ at: Date; from: string; to: string; orderCount: number }>;
  warnings: string[];
}

@Injectable()
export class RecipeCatchupService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ───────────────────────────── preview ─────────────────────────────

  async preview(tenantId: string, range: CatchupRange): Promise<CatchupPreview> {
    const { from, to } = this.parseDates(range);
    const branchId = await this.resolveBranch(tenantId, range.branchId);

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        status: { in: [...CONSUMING_STATUSES] },
        createdAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        items: {
          select: {
            productId: true,
            productName: true,
            quantity: true,
            refundedQty: true,
            modifiers: { select: { modifierOptionId: true } },
          },
        },
      },
    });

    // Roll order lines up into net units per product, and keep each serving's
    // chosen options. Refunded quantity nets out: an item rung up and then
    // refunded never consumed anything.
    const unitsByProduct = new Map<string, { name: string; units: number }>();
    const servings: Array<{ productId: string; qty: number; optionIds: string[] }> = [];

    for (const order of orders) {
      for (const item of order.items) {
        const netQty = Number(item.quantity) - Number(item.refundedQty ?? 0);
        if (netQty <= 0) continue;

        const seen = unitsByProduct.get(item.productId);
        if (seen) seen.units += netQty;
        else unitsByProduct.set(item.productId, { name: item.productName, units: netQty });

        servings.push({
          productId: item.productId,
          qty: netQty,
          optionIds: item.modifiers.map((m) => m.modifierOptionId),
        });
      }
    }

    const priorRuns = await this.priorRuns(tenantId, from, to);
    const productIdsInRange = [...unitsByProduct.keys()];

    if (productIdsInRange.length === 0) {
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        branchId,
        orderCount: orders.length,
        products: [],
        lines: [],
        skippedNoRecipe: [],
        priorRuns,
        warnings: ['No orders in this range.'],
      };
    }

    // Current recipes for everything seen in the range.
    const boms = await this.prisma.bomItem.findMany({
      where: { productId: { in: productIdsInRange }, product: { tenantId } },
      select: { productId: true, rawMaterialId: true, quantity: true },
    });
    const bomByProduct = new Map<string, Array<{ rawMaterialId: string; quantity: number }>>();
    for (const b of boms) {
      const list = bomByProduct.get(b.productId) ?? [];
      list.push({ rawMaterialId: b.rawMaterialId, quantity: Number(b.quantity) });
      bomByProduct.set(b.productId, list);
    }

    // Scope. Absent an explicit list we fall back to "everything with a recipe
    // today" and warn loudly — that is precisely the double-deduct case.
    const requested = range.productIds?.length ? new Set(range.productIds) : null;
    const inScope = (pid: string) =>
      bomByProduct.has(pid) && (requested === null || requested.has(pid));

    // Modifier ingredient lines for every option seen in range, in one trip.
    const allOptionIds = [...new Set(servings.flatMap((s) => s.optionIds))];
    const options = allOptionIds.length
      ? await this.prisma.modifierOption.findMany({
          where: { id: { in: allOptionIds } },
          select: {
            id: true,
            recipeMultiplier: true,
            ingredients: { select: { rawMaterialId: true, quantity: true } },
          },
        })
      : [];
    const optionById = new Map(options.map((o) => [o.id, o]));

    // Walk every serving through the same netting the live sale path uses.
    const usageByRm = new Map<string, number>();
    for (const s of servings) {
      if (!inScope(s.productId)) continue;

      const chosen = s.optionIds
        .map((id) => optionById.get(id))
        .filter((o): o is (typeof options)[number] => o !== undefined);

      // Highest multiplier wins — never compounded. Mirrors orders.service.
      const multiplier = chosen.reduce((max, o) => {
        const m = Number(o.recipeMultiplier);
        return Number.isFinite(m) && m > max ? m : max;
      }, 1);

      const netted = new Map<string, number>();
      for (const line of bomByProduct.get(s.productId) ?? []) {
        netted.set(
          line.rawMaterialId,
          (netted.get(line.rawMaterialId) ?? 0) + line.quantity * multiplier,
        );
      }
      // Modifier ingredients are signed: a negative line cancels the base
      // recipe. That is how substitution is expressed.
      for (const o of chosen) {
        for (const ing of o.ingredients) {
          netted.set(
            ing.rawMaterialId,
            (netted.get(ing.rawMaterialId) ?? 0) + Number(ing.quantity),
          );
        }
      }

      for (const [rmId, perUnit] of netted) {
        const floored = Math.max(perUnit, 0); // over-cancelling settles at "none used"
        if (floored <= 0) continue;
        usageByRm.set(rmId, (usageByRm.get(rmId) ?? 0) + floored * s.qty);
      }
    }

    // Attach names, units and current balances.
    const rmIds = [...usageByRm.keys()];
    const materials = rmIds.length
      ? await this.prisma.rawMaterial.findMany({
          where: { id: { in: rmIds }, tenantId },
          select: { id: true, name: true, unit: true },
        })
      : [];
    const stock = rmIds.length
      ? await this.prisma.rawMaterialInventory.findMany({
          where: { branchId, rawMaterialId: { in: rmIds } },
          select: { rawMaterialId: true, quantity: true },
        })
      : [];
    const stockByRm = new Map(stock.map((s) => [s.rawMaterialId, Number(s.quantity)]));

    const lines: CatchupLine[] = materials
      .map((m) => {
        const used = this.round4(usageByRm.get(m.id) ?? 0);
        const before = stockByRm.get(m.id) ?? 0;
        return {
          rawMaterialId: m.id,
          name: m.name,
          unit: m.unit,
          quantityUsed: used,
          stockBefore: before,
          stockAfter: this.round4(Math.max(before - used, 0)),
          shortfall: used > before,
        };
      })
      .sort((a, b) => b.quantityUsed - a.quantityUsed);

    const products = [...unitsByProduct.entries()]
      .filter(([pid]) => inScope(pid))
      .map(([pid, v]) => ({ productId: pid, name: v.name, unitsSold: v.units, hasRecipe: true }))
      .sort((a, b) => b.unitsSold - a.unitsSold);

    const skippedNoRecipe = [...unitsByProduct.entries()]
      .filter(([pid]) => !bomByProduct.has(pid))
      .map(([pid, v]) => ({ productId: pid, name: v.name, unitsSold: v.units }))
      .sort((a, b) => b.unitsSold - a.unitsSold);

    const warnings: string[] = [];
    if (requested === null) {
      warnings.push(
        'No product list was given, so every product that has a recipe today is included. ' +
          'Any product whose recipe already existed when it was sold ALREADY deducted its ' +
          'ingredients — including it here drains that stock a second time. Name the products ' +
          'whose recipes you added late.',
      );
    }
    if (skippedNoRecipe.length) {
      warnings.push(
        `${skippedNoRecipe.length} product(s) sold in this range still have no recipe, so their ` +
          'ingredient usage cannot be reconstructed. Add their recipes, then run the catch-up ' +
          'again for those products.',
      );
    }
    const short = lines.filter((l) => l.shortfall);
    if (short.length) {
      warnings.push(
        `${short.length} ingredient(s) show more usage than the stock on hand. Their balance ` +
          'floors at zero rather than going negative — usually a sign the opening count was ' +
          'entered after some of these sales.',
      );
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      branchId,
      orderCount: orders.length,
      products,
      lines,
      skippedNoRecipe,
      priorRuns,
      warnings,
    };
  }

  // ────────────────────────────── apply ──────────────────────────────

  async apply(
    tenantId: string,
    userId: string,
    range: CatchupRange & { expectedOrderCount: number },
  ): Promise<CatchupPreview & { applied: true }> {
    const { from, to } = this.parseDates(range);

    // Guard 1 — an earlier run already covering part of this window.
    const overlaps = await this.priorRuns(tenantId, from, to);
    if (overlaps.length > 0) {
      const prev = overlaps[0];
      throw new ConflictException(
        `A recipe catch-up covering ${prev.from} to ${prev.to} was already applied on ` +
          `${prev.at.toISOString()}. Running another over the same dates would deduct the same ` +
          'ingredients twice. Narrow the range to dates that were not already caught up.',
      );
    }

    const preview = await this.preview(tenantId, range);

    // Guard 2 — the caller must echo what the preview showed. If orders landed
    // in between, the numbers have moved and a silent apply would deduct
    // something the operator never saw.
    if (preview.orderCount !== range.expectedOrderCount) {
      throw new ConflictException(
        `This range now covers ${preview.orderCount} orders, but ${range.expectedOrderCount} ` +
          'were confirmed. Review the preview again before applying.',
      );
    }

    if (preview.lines.length === 0) {
      throw new BadRequestException(
        'Nothing to catch up — no ingredient usage was reconstructed for this range.',
      );
    }

    // Deduct. All arithmetic happened in the preview, so the transaction is a
    // straight run of writes and stays well inside its budget.
    await this.prisma.$transaction(
      async (tx) => {
        for (const line of preview.lines) {
          await tx.rawMaterialInventory.updateMany({
            where: { branchId: preview.branchId, rawMaterialId: line.rawMaterialId },
            data: { quantity: new Prisma.Decimal(line.stockAfter) },
          });
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    // The audit row IS the idempotency record — priorRuns() reads it back.
    await this.audit.log({
      tenantId,
      action: 'SETTING_CHANGED',
      entityType: AUDIT_ENTITY,
      entityId: preview.branchId,
      description:
        `Recipe catch-up applied: ${preview.orderCount} orders from ${preview.from} to ` +
        `${preview.to}; ${preview.lines.length} ingredient(s) adjusted.`,
      after: {
        from: preview.from,
        to: preview.to,
        branchId: preview.branchId,
        orderCount: preview.orderCount,
        productIds: preview.products.map((p) => p.productId),
        lines: preview.lines.map((l) => ({
          rawMaterialId: l.rawMaterialId,
          name: l.name,
          used: l.quantityUsed,
          before: l.stockBefore,
          after: l.stockAfter,
        })),
      },
      performedBy: userId,
    });

    return { ...preview, applied: true };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  /** Prior applied runs whose date window overlaps [from, to]. */
  private async priorRuns(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ at: Date; from: string; to: string; orderCount: number }>> {
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId, entityType: AUDIT_ENTITY },
      select: { createdAt: true, after: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return rows
      .map((r) => {
        const a = (r.after ?? {}) as { from?: string; to?: string; orderCount?: number };
        if (!a.from || !a.to) return null;
        return { at: r.createdAt, from: a.from, to: a.to, orderCount: a.orderCount ?? 0 };
      })
      .filter((r): r is { at: Date; from: string; to: string; orderCount: number } => r !== null)
      // Two windows overlap unless one ends before the other starts.
      .filter((r) => new Date(r.from) <= to && new Date(r.to) >= from);
  }

  private async resolveBranch(tenantId: string, branchId?: string): Promise<string> {
    if (branchId) {
      const b = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId },
        select: { id: true },
      });
      if (!b) throw new NotFoundException('Branch not found.');
      return b.id;
    }
    const first = await this.prisma.branch.findFirst({
      where: { tenantId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!first) throw new NotFoundException('No branch found for this business.');
    return first.id;
  }

  private parseDates(range: CatchupRange): { from: Date; to: Date } {
    const from = new Date(range.from);
    const to = new Date(range.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range.');
    }
    if (from > to) {
      throw new BadRequestException('The start date must fall on or before the end date.');
    }
    return { from, to };
  }

  private round4(n: number): number {
    return Math.round(n * 10_000) / 10_000;
  }
}
