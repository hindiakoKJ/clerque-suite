import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Recipe catch-up — replay ingredient usage for sale lines that never deducted.
 *
 * WHY THIS EXISTS
 * ---------------
 * A shop goes live on the POS long before its recipe book is finished. Sales
 * start on day one; the recipes land weeks later. Every sale in between
 * deducted NOTHING from ingredient stock, because the product had no BOM to
 * walk at sale time. Without a replay the ingredient balances stay
 * permanently overstated, and the only remedy is a physical recount — not an
 * option for an owner who has already left the site.
 *
 * This reconstructs the missed usage from the sales themselves. Everything it
 * needs was persisted at sale time: OrderItem.productId, quantity,
 * refundedQty, and the exact modifier options chosen. It applies the CURRENT
 * recipe to those historical lines using the same netting, size-multiplier and
 * zero-floor rules as the live sale path, so a substitution rung up weeks ago
 * still resolves correctly when replayed today.
 *
 * HOW DOUBLE-DEDUCTION IS PREVENTED
 * ---------------------------------
 * `OrderItem.ingredientsDeductedAt` is the whole mechanism. The sale path
 * stamps a line whenever it actually writes ingredient stock, so every line
 * carries a record of whether its ingredients already left the building. This
 * service considers only lines where it is null, and stamps exactly the lines
 * it replays — inside the same transaction that does the deducting, so the
 * set it drains and the set it closes are the same set by construction.
 * Running it twice is therefore harmless: the second run finds nothing left.
 *
 * The marker is per LINE, not per order, because one order routinely mixes a
 * latte (recipe entered, deducted) with a slice of cake (no recipe yet, did
 * not). An order-level flag would either lose the cake forever or replay the
 * latte twice.
 *
 * One honest limit remains and is surfaced rather than hidden: lines written
 * before the marker column existed are null and cannot be told apart from
 * "never deducted". The preview flags any window reaching back past the
 * cut-off so the operator can narrow by product for that stretch.
 *
 * WHY IT DRAINS LOTS TOO
 * ----------------------
 * While deduction is paused the sale path skips lot layers entirely and costs
 * recipes at the ingredient's running average. Replaying only the aggregate
 * pool would leave FIFO/FEFO layers full while the pool fell — breaking expiry
 * ordering and re-inflating the balance at the next revaluation. So the replay
 * drains lots in the same FEFO/FIFO order a live sale would have.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not post COGS or touch the ledger. Those sales already booked their
 * cost, and re-booking would double the expense. This is an INVENTORY
 * correction only — it answers "how much milk actually left the building", not
 * "what did it cost".
 */

/** Orders that represent real consumption. VOIDED never left the kitchen. */
const CONSUMING_STATUSES: Prisma.EnumOrderStatusFilter['in'] = ['PAID', 'COMPLETED', 'RETURNED'];

/** entityType marker on the audit trail. */
const AUDIT_ENTITY = 'RECIPE_CATCHUP';

/**
 * When OrderItem.ingredientsDeductedAt shipped. Lines older than this are null
 * because the column did not exist, not because they failed to deduct — the
 * preview says so rather than quietly treating them as a backlog.
 */
const MARKER_INTRODUCED_AT = new Date('2026-08-24T00:00:00.000Z');

/** Postgres parameter limits make very large IN () lists unwise. */
const STAMP_CHUNK = 500;

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

export interface CatchupWarning {
  level: 'info' | 'warn' | 'danger';
  code: string;
  message: string;
}

export interface CatchupPreview {
  from: string;
  to: string;
  branchId: string;
  /** Sale lines in range that never deducted and are in scope for this run. */
  lineCount: number;
  /** Distinct orders those lines belong to — what the operator recognises. */
  orderCount: number;
  /** Lines in range already stamped as deducted, excluded automatically. */
  alreadyDeductedCount: number;
  /** Non-null while the tenant has ingredient deduction paused. */
  deductionPausedAt: string | null;
  products: Array<{ productId: string; name: string; unitsSold: number; hasRecipe: boolean }>;
  lines: CatchupLine[];
  skippedNoRecipe: Array<{ productId: string; name: string; unitsSold: number }>;
  priorRuns: Array<{ at: Date; from: string; to: string; orderCount: number }>;
  warnings: CatchupWarning[];
}

/** Everything the deduct step needs, computed from one consistent read. */
interface CatchupPlan {
  usageByRm: Map<string, number>;
  unitsByProduct: Map<string, { name: string; units: number }>;
  bomByProduct: Map<string, Array<{ rawMaterialId: string; quantity: number }>>;
  /** OrderItem ids that contributed usage — exactly what gets stamped. */
  itemIds: string[];
  orderIds: Set<string>;
  alreadyDeductedCount: number;
}

type Db = PrismaService | Prisma.TransactionClient;

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

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { recipeDeductionPausedAt: true },
    });
    const deductionPausedAt = tenant?.recipeDeductionPausedAt ?? null;

    const plan = await this.buildPlan(this.prisma, tenantId, branchId, from, to, range.productIds);
    const priorRuns = await this.priorRuns(tenantId, from, to);

    // Attach names, units and current balances.
    const rmIds = [...plan.usageByRm.keys()];
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
        const used = this.round4(plan.usageByRm.get(m.id) ?? 0);
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

    const inScope = (pid: string) =>
      plan.bomByProduct.has(pid) &&
      (!range.productIds?.length || range.productIds.includes(pid));

    const products = [...plan.unitsByProduct.entries()]
      .filter(([pid]) => inScope(pid))
      .map(([pid, v]) => ({ productId: pid, name: v.name, unitsSold: v.units, hasRecipe: true }))
      .sort((a, b) => b.unitsSold - a.unitsSold);

    const skippedNoRecipe = [...plan.unitsByProduct.entries()]
      .filter(([pid]) => !plan.bomByProduct.has(pid))
      .map(([pid, v]) => ({ productId: pid, name: v.name, unitsSold: v.units }))
      .sort((a, b) => b.unitsSold - a.unitsSold);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      branchId,
      lineCount: plan.itemIds.length,
      orderCount: plan.orderIds.size,
      alreadyDeductedCount: plan.alreadyDeductedCount,
      deductionPausedAt: deductionPausedAt ? deductionPausedAt.toISOString() : null,
      products,
      lines,
      skippedNoRecipe,
      priorRuns,
      warnings: this.buildWarnings({
        from,
        lineCount: plan.itemIds.length,
        alreadyDeductedCount: plan.alreadyDeductedCount,
        deductionPausedAt,
        skippedNoRecipe,
        lines,
      }),
    };
  }

  // ────────────────────────────── apply ──────────────────────────────

  async apply(
    tenantId: string,
    userId: string,
    range: CatchupRange & { expectedLineCount: number },
  ): Promise<CatchupPreview & { applied: true; stampedLineCount: number }> {
    const { from, to } = this.parseDates(range);
    const branchId = await this.resolveBranch(tenantId, range.branchId);

    let stampedLineCount = 0;
    let applied!: { plan: CatchupPlan; lines: CatchupLine[] };

    await this.prisma.$transaction(
      async (tx) => {
        // Serialise catch-ups for this branch. Two operators (or a double
        // click) would otherwise each read the same un-stamped lines and
        // deduct the same usage twice — the stamps only land at the end.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recipe-catchup:${tenantId}:${branchId}`}))`;

        // Everything is recomputed INSIDE the transaction, so the lines that
        // get deducted are exactly the lines that get stamped. The preview the
        // operator saw is a forecast; this is the authority.
        const plan = await this.buildPlan(tx, tenantId, branchId, from, to, range.productIds);

        if (plan.itemLines() !== range.expectedLineCount) {
          throw new BadRequestException(
            `This range now covers ${plan.itemLines()} sale line(s) that never deducted, but ` +
              `${range.expectedLineCount} were confirmed. Review the preview again before applying.`,
          );
        }
        if (plan.usageByRm.size === 0) {
          throw new BadRequestException(
            'Nothing to catch up — no ingredient usage was reconstructed for this range.',
          );
        }

        const rmIds = [...plan.usageByRm.keys()];
        const stockRows = await tx.rawMaterialInventory.findMany({
          where: { branchId, rawMaterialId: { in: rmIds } },
          select: { rawMaterialId: true, quantity: true },
        });
        const stockByRm = new Map(stockRows.map((s) => [s.rawMaterialId, Number(s.quantity)]));

        const lines: CatchupLine[] = [];
        for (const rmId of rmIds) {
          const used = this.round4(plan.usageByRm.get(rmId) ?? 0);
          if (used <= 0) continue;
          const before = stockByRm.get(rmId) ?? 0;

          // Decrement relative to the live balance and floor at zero in one
          // statement, so a sale landing mid-apply is not overwritten.
          await tx.rawMaterialInventory.updateMany({
            where: { branchId, rawMaterialId: rmId },
            data: { quantity: { decrement: new Prisma.Decimal(used) } },
          });

          // Drain lot layers in the same FEFO/FIFO order a live sale uses.
          // Skipping this would leave layers full while the pool fell, which
          // breaks expiry ordering and re-inflates the balance later.
          await this.drainLots(tx, branchId, rmId, used);

          lines.push({
            rawMaterialId: rmId,
            name: '',
            unit: '',
            quantityUsed: used,
            stockBefore: before,
            stockAfter: this.round4(Math.max(before - used, 0)),
            shortfall: used > before,
          });
        }

        await tx.rawMaterialInventory.updateMany({
          where: { branchId, rawMaterialId: { in: rmIds }, quantity: { lt: 0 } },
          data: { quantity: new Prisma.Decimal(0) },
        });

        // Stamp exactly the lines whose usage was just deducted.
        const now = new Date();
        for (let i = 0; i < plan.itemIds.length; i += STAMP_CHUNK) {
          const chunk = plan.itemIds.slice(i, i + STAMP_CHUNK);
          const res = await tx.orderItem.updateMany({
            where: { id: { in: chunk }, ingredientsDeductedAt: null },
            data: { ingredientsDeductedAt: now },
          });
          stampedLineCount += res.count;
        }

        // Names for the receipt-style report, resolved after the writes.
        const materials = await tx.rawMaterial.findMany({
          where: { id: { in: lines.map((l) => l.rawMaterialId) }, tenantId },
          select: { id: true, name: true, unit: true },
        });
        const byId = new Map(materials.map((m) => [m.id, m]));
        for (const l of lines) {
          l.name = byId.get(l.rawMaterialId)?.name ?? l.rawMaterialId;
          l.unit = byId.get(l.rawMaterialId)?.unit ?? '';
        }
        lines.sort((a, b) => b.quantityUsed - a.quantityUsed);

        applied = { plan, lines };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    await this.audit.log({
      tenantId,
      action: 'SETTING_CHANGED',
      entityType: AUDIT_ENTITY,
      entityId: branchId,
      description:
        `Recipe catch-up applied: ${stampedLineCount} sale line(s) across ` +
        `${applied.plan.orderIds.size} order(s) from ${from.toISOString()} to ${to.toISOString()}; ` +
        `${applied.lines.length} ingredient(s) adjusted.`,
      after: {
        from: from.toISOString(),
        to: to.toISOString(),
        branchId,
        orderCount: applied.plan.orderIds.size,
        stampedLineCount,
        productIds: [...applied.plan.unitsByProduct.keys()],
        lines: applied.lines.map((l) => ({
          rawMaterialId: l.rawMaterialId,
          name: l.name,
          used: l.quantityUsed,
          before: l.stockBefore,
          after: l.stockAfter,
        })),
      },
      performedBy: userId,
    });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      branchId,
      lineCount: applied.plan.itemIds.length,
      orderCount: applied.plan.orderIds.size,
      alreadyDeductedCount: applied.plan.alreadyDeductedCount,
      deductionPausedAt: null,
      products: [...applied.plan.unitsByProduct.entries()]
        .filter(([pid]) => applied.plan.bomByProduct.has(pid))
        .map(([pid, v]) => ({ productId: pid, name: v.name, unitsSold: v.units, hasRecipe: true })),
      lines: applied.lines,
      skippedNoRecipe: [...applied.plan.unitsByProduct.entries()]
        .filter(([pid]) => !applied.plan.bomByProduct.has(pid))
        .map(([pid, v]) => ({ productId: pid, name: v.name, unitsSold: v.units })),
      priorRuns: [],
      warnings: [],
      applied: true,
      stampedLineCount,
    };
  }

  // ───────────────────────────── planning ─────────────────────────────

  /**
   * Read the un-deducted sale lines in the window and reconstruct their
   * ingredient usage. Runs against either the base client (preview) or a
   * transaction client (apply), so both see one consistent snapshot.
   */
  private async buildPlan(
    db: Db,
    tenantId: string,
    branchId: string,
    from: Date,
    to: Date,
    productIds?: string[],
  ): Promise<CatchupPlan & { itemLines: () => number }> {
    const orderWhere: Prisma.OrderWhereInput = {
      tenantId,
      branchId,
      status: { in: CONSUMING_STATUSES },
      createdAt: { gte: from, lte: to },
    };

    // Line-level scoping. This single clause is what makes the replay safe.
    const items = await db.orderItem.findMany({
      where: { ingredientsDeductedAt: null, order: orderWhere },
      select: {
        id: true,
        orderId: true,
        productId: true,
        productName: true,
        quantity: true,
        refundedQty: true,
        modifiers: { select: { modifierOptionId: true } },
      },
    });

    const alreadyDeductedCount = await db.orderItem.count({
      where: { ingredientsDeductedAt: { not: null }, order: orderWhere },
    });

    const unitsByProduct = new Map<string, { name: string; units: number }>();
    const servings: Array<{ itemId: string; orderId: string; productId: string; qty: number; optionIds: string[] }> = [];

    for (const item of items) {
      // Refunded quantity nets out: a drink rung up and then refunded never
      // consumed anything.
      const netQty = Number(item.quantity) - Number(item.refundedQty ?? 0);
      if (netQty <= 0) continue;

      const seen = unitsByProduct.get(item.productId);
      if (seen) seen.units += netQty;
      else unitsByProduct.set(item.productId, { name: item.productName, units: netQty });

      servings.push({
        itemId: item.id,
        orderId: item.orderId,
        productId: item.productId,
        qty: netQty,
        optionIds: item.modifiers.map((m) => m.modifierOptionId),
      });
    }

    const bomByProduct = new Map<string, Array<{ rawMaterialId: string; quantity: number }>>();
    if (unitsByProduct.size > 0) {
      const boms = await db.bomItem.findMany({
        where: { productId: { in: [...unitsByProduct.keys()] }, product: { tenantId } },
        select: { productId: true, rawMaterialId: true, quantity: true },
      });
      for (const b of boms) {
        const list = bomByProduct.get(b.productId) ?? [];
        list.push({ rawMaterialId: b.rawMaterialId, quantity: Number(b.quantity) });
        bomByProduct.set(b.productId, list);
      }
    }

    // `productIds` narrows a run — chiefly for lines predating the marker,
    // where null cannot be distinguished from "already deducted".
    const requested = productIds?.length ? new Set(productIds) : null;
    const inScope = (pid: string) =>
      bomByProduct.has(pid) && (requested === null || requested.has(pid));

    const allOptionIds = [...new Set(servings.flatMap((s) => s.optionIds))];
    const options = allOptionIds.length
      ? await db.modifierOption.findMany({
          where: { id: { in: allOptionIds } },
          select: {
            id: true,
            recipeMultiplier: true,
            ingredients: { select: { rawMaterialId: true, quantity: true } },
          },
        })
      : [];
    const optionById = new Map(options.map((o) => [o.id, o]));

    const usageByRm = new Map<string, number>();
    const itemIds: string[] = [];
    const orderIds = new Set<string>();

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

      let contributed = false;
      for (const [rmId, perUnit] of netted) {
        const floored = Math.max(perUnit, 0); // over-cancelling settles at "none used"
        if (floored <= 0) continue;
        usageByRm.set(rmId, (usageByRm.get(rmId) ?? 0) + floored * s.qty);
        contributed = true;
      }

      // Only lines that actually produced usage are stamped. A recipe that
      // nets to nothing leaves its line open rather than silently closing it.
      if (contributed) {
        itemIds.push(s.itemId);
        orderIds.add(s.orderId);
      }
    }

    return {
      usageByRm,
      unitsByProduct,
      bomByProduct,
      itemIds,
      orderIds,
      alreadyDeductedCount,
      itemLines: () => itemIds.length,
    };
  }

  /** Drain lot layers FEFO (expiry first, nulls last) then FIFO, as a sale does. */
  private async drainLots(
    tx: Prisma.TransactionClient,
    branchId: string,
    rawMaterialId: string,
    qty: number,
  ): Promise<void> {
    let remaining = qty;
    const lots = await tx.rawMaterialLot.findMany({
      where: { branchId, rawMaterialId, qtyRemaining: { gt: 0 } },
      orderBy: [
        { expirationDate: { sort: 'asc', nulls: 'last' } },
        { receivedAt: 'asc' },
      ],
    });
    for (const lot of lots) {
      if (remaining <= 0) break;
      const lotRem = Number(lot.qtyRemaining);
      const drain = Math.min(lotRem, remaining);
      await tx.rawMaterialLot.update({
        where: { id: lot.id },
        data: { qtyRemaining: new Prisma.Decimal(lotRem - drain) },
      });
      remaining -= drain;
    }
  }

  // ───────────────────────────── warnings ─────────────────────────────

  private buildWarnings(ctx: {
    from: Date;
    lineCount: number;
    alreadyDeductedCount: number;
    deductionPausedAt: Date | null;
    skippedNoRecipe: Array<{ name: string }>;
    lines: CatchupLine[];
  }): CatchupWarning[] {
    const warnings: CatchupWarning[] = [];


    if (ctx.lineCount === 0) {
      warnings.push({
        level: 'info',
        code: 'NOTHING_TO_DO',
        message:
          ctx.alreadyDeductedCount > 0
            ? `Nothing to catch up. All ${ctx.alreadyDeductedCount} sale line(s) in this range already deducted their ingredients.`
            : 'No sales in this range need catching up.',
      });
    } else {
      warnings.push({
        level: 'info',
        code: 'MARKER_SCOPED',
        message:
          `Only sale lines that never deducted are included — ${ctx.lineCount} of ` +
          `${ctx.lineCount + ctx.alreadyDeductedCount} in this range. ` +
          (ctx.alreadyDeductedCount > 0
            ? `The other ${ctx.alreadyDeductedCount} already deducted at sale time and are excluded automatically.`
            : 'None of them had already deducted.'),
      });
    }

    // The marker cannot speak for sales older than itself.
    if (ctx.from < MARKER_INTRODUCED_AT) {
      warnings.push({
        level: 'danger',
        code: 'PREDATES_MARKER',
        message:
          `This range reaches back before ${MARKER_INTRODUCED_AT.toISOString().slice(0, 10)}, when Clerque ` +
          'started recording which sales deducted ingredients. Older lines look "never deducted" whether ' +
          'they did or not, so any product whose recipe already existed back then would be deducted a ' +
          'second time. For that stretch, narrow the run to the products whose recipes you added late.',
      });
    }

    if (ctx.deductionPausedAt) {
      warnings.push({
        level: 'warn',
        code: 'STILL_PAUSED',
        message:
          `Ingredient deduction is still paused (since ${ctx.deductionPausedAt.toISOString().slice(0, 16).replace('T', ' ')}). ` +
          'Sales rung after this catch-up will not deduct either, so you would have to run it again. ' +
          'Turn deduction back on in Settings first, then catch up.',
      });
    }

    if (ctx.skippedNoRecipe.length) {
      warnings.push({
        level: 'warn',
        code: 'NO_RECIPE',
        message:
          `${ctx.skippedNoRecipe.length} product(s) sold in this range still have no recipe, so their usage ` +
          'cannot be reconstructed. Their sale lines stay open, so running this again once those recipes ' +
          'land will pick them up.',
      });
    }

    const short = ctx.lines.filter((l) => l.shortfall);
    if (short.length) {
      warnings.push({
        level: 'warn',
        code: 'SHORTFALL',
        message:
          `${short.length} ingredient(s) show more usage than the stock on hand. Their balance floors at ` +
          'zero rather than going negative — usually a sign the opening count was entered after some of ' +
          'these sales.',
      });
    }

    return warnings;
  }

  // ───────────────────────────── helpers ─────────────────────────────

  /**
   * Earlier runs whose window overlaps [from, to]. Informational only — line
   * stamping is what prevents a double deduction, so an overlapping run is not
   * refused. It is shown so the operator has the history.
   */
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
