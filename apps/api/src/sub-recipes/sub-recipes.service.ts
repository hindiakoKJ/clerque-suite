import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sub-recipes — prepared ingredients that are made in the shop rather than
 * bought, and then used like any other ingredient.
 *
 * White Sugar Syrup is 1000 g White Sugar + 500 ml Water, yielding ~1130 ml.
 * The drink recipe still calls for `30 ml White Sugar Syrup`, one line, the
 * thing the barista actually pours. What was missing was the step between:
 * nothing recorded a batch being made, so selling lattes consumed syrup while
 * the sugar sat untouched. It could never fall, never trip a reorder alert,
 * and never reach a buy list — the shop runs out of sugar with the system
 * insisting it holds eight kilos.
 *
 * Making a batch posts NO journal entry, deliberately. Every ingredient sits
 * in 1050 Merchandise Inventory, so production is Dr 1050 / Cr 1050 — value
 * neutral. Routing it through the existing INVENTORY_ADJUSTMENT handler would
 * be actively wrong: the inputs would post Dr 5010 COGS (expensing the sugar)
 * and the output Dr 1050 / Cr 3010 (recording an owner contribution), for what
 * is stirring sugar into water. The quantity movement and the lot are the
 * record. If 1051/1052 are ever split out, production earns a real entry then:
 * Dr Work in Process / Cr Raw Materials.
 */

export interface MakeBatchDto {
  branchId: string;
  /** How many batches. 1 batch yields RawMaterial.batchYield. */
  batches:  number;
  note?:    string;
  madeAt?:  string;
}

export interface SubRecipeLineInput {
  rawMaterialId: string;
  /** Consumed per ONE batch, in the component's own unit. */
  quantity: number;
}

@Injectable()
export class SubRecipesService {
  constructor(private readonly prisma: PrismaService) {}

  /** An ingredient is a sub-recipe when it has components AND a yield. */
  async get(tenantId: string, rawMaterialId: string) {
    const rm = await this.prisma.rawMaterial.findFirst({
      where:  { id: rawMaterialId, tenantId },
      select: {
        id: true, name: true, unit: true, costPrice: true, batchYield: true,
        subRecipeItems: {
          select: {
            id: true, quantity: true,
            rawMaterial: { select: { id: true, name: true, unit: true, costPrice: true } },
          },
        },
      },
    });
    if (!rm) throw new NotFoundException('Ingredient not found.');
    return rm;
  }

  /**
   * Define or replace what one batch is made from.
   *
   * Rejects cycles by walking the whole tree, not just the immediate parent:
   * the database CHECK catches A-contains-A, but A needs B needs A would
   * otherwise make cost derivation and batch counting recurse forever.
   */
  async setRecipe(
    tenantId: string,
    rawMaterialId: string,
    batchYield: number,
    lines: SubRecipeLineInput[],
  ) {
    if (!(batchYield > 0)) {
      throw new BadRequestException(
        'A batch has to yield something. Enter how much one batch makes, in this ingredient\'s own unit.',
      );
    }
    if (lines.length === 0) {
      throw new BadRequestException('A sub-recipe needs at least one ingredient.');
    }

    const parent = await this.prisma.rawMaterial.findFirst({
      where: { id: rawMaterialId, tenantId }, select: { id: true, name: true },
    });
    if (!parent) throw new NotFoundException('Ingredient not found.');

    const ids = lines.map((l) => l.rawMaterialId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'The same ingredient is listed twice. Combine them into one line — two lines would double the batch.',
      );
    }
    const found = await this.prisma.rawMaterial.findMany({
      where: { id: { in: ids }, tenantId }, select: { id: true, name: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException('One of the ingredients does not exist in your list.');
    }
    for (const l of lines) {
      if (!(l.quantity > 0)) {
        throw new BadRequestException('Every line needs a quantity greater than zero.');
      }
    }
    for (const id of ids) {
      if (await this.wouldCycle(tenantId, rawMaterialId, id)) {
        const name = found.find((f) => f.id === id)?.name ?? 'that ingredient';
        throw new BadRequestException(
          `"${name}" is made from "${parent.name}" (directly or further down), so this would loop.`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.subRecipeItem.deleteMany({ where: { parentRawMaterialId: rawMaterialId } });
      await tx.subRecipeItem.createMany({
        data: lines.map((l) => ({
          parentRawMaterialId: rawMaterialId,
          rawMaterialId:       l.rawMaterialId,
          quantity:            new Prisma.Decimal(l.quantity),
        })),
      });
      await tx.rawMaterial.update({
        where: { id: rawMaterialId },
        data:  { batchYield: new Prisma.Decimal(batchYield) },
      });
      return { rawMaterialId, batchYield, lines: lines.length };
    });
  }

  /** True when `candidate` already depends on `root`, at any depth. */
  private async wouldCycle(tenantId: string, root: string, candidate: string): Promise<boolean> {
    if (candidate === root) return true;
    const seen = new Set<string>();
    let frontier = [candidate];
    while (frontier.length) {
      const rows = await this.prisma.subRecipeItem.findMany({
        where:  { parentRawMaterialId: { in: frontier }, parent: { tenantId } },
        select: { rawMaterialId: true },
      });
      const next: string[] = [];
      for (const r of rows) {
        if (r.rawMaterialId === root) return true;
        if (!seen.has(r.rawMaterialId)) { seen.add(r.rawMaterialId); next.push(r.rawMaterialId); }
      }
      frontier = next;
    }
    return false;
  }

  /**
   * How many batches the raw materials on hand could still produce — the
   * "available refill" number. Same shape as maxProducible on a product:
   * MIN(stock / per-batch) across the components, and the limiting one is
   * named, because "8 left" without a cause sends the wrong person running.
   */
  async maxBatches(tenantId: string, rawMaterialId: string, branchId: string) {
    const rm = await this.get(tenantId, rawMaterialId);
    if (rm.subRecipeItems.length === 0 || rm.batchYield == null) {
      return { batches: null, limitedBy: null, yieldPerBatch: null };
    }
    const stock = await this.stockOf(branchId, rm.subRecipeItems.map((l) => l.rawMaterial.id));

    let batches = Number.POSITIVE_INFINITY;
    let limitedBy: string | null = null;
    for (const line of rm.subRecipeItems) {
      const per = Number(line.quantity);
      if (per <= 0) continue;
      const can = Math.floor((stock.get(line.rawMaterial.id) ?? 0) / per);
      if (can < batches) { batches = can; limitedBy = line.rawMaterial.name; }
    }
    return {
      batches:       batches === Number.POSITIVE_INFINITY ? 0 : batches,
      limitedBy,
      yieldPerBatch: Number(rm.batchYield),
    };
  }

  /**
   * Record that a batch was made: consume the inputs, add the yield.
   *
   * Refuses rather than going negative. A batch that could not physically have
   * been made is worse than no record — it would blend a cost for stock that
   * does not exist and quietly corrupt the WAC of everything downstream.
   */
  async makeBatch(tenantId: string, rawMaterialId: string, dto: MakeBatchDto, userId: string) {
    const batches = Number(dto.batches);
    if (!(batches > 0)) throw new BadRequestException('Enter how many batches were made.');

    const rm = await this.get(tenantId, rawMaterialId);
    if (rm.subRecipeItems.length === 0) {
      throw new BadRequestException(
        `"${rm.name}" has no recipe yet. Add what one batch is made from before recording production.`,
      );
    }
    if (rm.batchYield == null || Number(rm.batchYield) <= 0) {
      throw new BadRequestException(
        `"${rm.name}" has no batch yield. Enter how much one batch makes.`,
      );
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, tenantId }, select: { id: true },
    });
    if (!branch) throw new BadRequestException('Branch not found in your organization.');

    const stock  = await this.stockOf(dto.branchId, rm.subRecipeItems.map((l) => l.rawMaterial.id));
    const short  = rm.subRecipeItems
      .map((l) => ({
        name:   l.rawMaterial.name,
        unit:   l.rawMaterial.unit,
        need:   Number(l.quantity) * batches,
        have:   stock.get(l.rawMaterial.id) ?? 0,
      }))
      .filter((l) => l.have < l.need);
    if (short.length) {
      const worst = short[0];
      throw new BadRequestException(
        `Not enough ${worst.name}: ${batches} batch(es) needs ${worst.need} ${worst.unit}, ` +
        `and there is ${worst.have}. Receive more before recording this.`,
      );
    }

    const madeAt = dto.madeAt ? new Date(dto.madeAt) : new Date();
    if (Number.isNaN(madeAt.getTime())) throw new BadRequestException('madeAt is not a valid date.');

    const produced   = Number(rm.batchYield) * batches;
    const inputValue = rm.subRecipeItems.reduce(
      (sum, l) => sum + Number(l.quantity) * batches * Number(l.rawMaterial.costPrice ?? 0), 0,
    );
    // The batch is worth exactly what went into it. Anything else would mean
    // stirring created or destroyed value.
    const unitCost = produced > 0 ? inputValue / produced : 0;

    return this.prisma.$transaction(async (tx) => {
      for (const line of rm.subRecipeItems) {
        const used = Number(line.quantity) * batches;
        const have = stock.get(line.rawMaterial.id) ?? 0;
        await tx.rawMaterialInventory.update({
          where: { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId: line.rawMaterial.id } },
          data:  { quantity: new Prisma.Decimal(have - used) },
        });
      }

      const existing = await tx.rawMaterialInventory.findUnique({
        where:  { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId } },
        select: { quantity: true },
      });
      const before = existing ? Number(existing.quantity) : 0;
      const after  = before + produced;

      await tx.rawMaterialInventory.upsert({
        where:  { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId } },
        create: { tenantId, branchId: dto.branchId, rawMaterialId, quantity: new Prisma.Decimal(after) },
        update: { quantity: new Prisma.Decimal(after) },
      });

      // Blend the batch into the sub-recipe's own WAC, exactly as a delivery
      // would — syrup made in March at old sugar prices and syrup made today
      // are the same ingredient in the same bottle.
      const oldCost = rm.costPrice != null ? Number(rm.costPrice) : 0;
      const newWac  = after > 0 ? (before * oldCost + produced * unitCost) / after : unitCost;
      await tx.rawMaterial.update({
        where: { id: rawMaterialId },
        data:  { costPrice: new Prisma.Decimal(newWac) },
      });

      await tx.rawMaterialLot.create({
        data: {
          tenantId,
          branchId:        dto.branchId,
          rawMaterialId,
          qtyReceived:     new Prisma.Decimal(produced),
          qtyRemaining:    new Prisma.Decimal(produced),
          unitCost:        new Prisma.Decimal(unitCost),
          receivedAt:      madeAt,
          referenceNumber: `BATCH-${madeAt.toISOString().slice(0, 10)}-${rawMaterialId.slice(-6)}`,
          paymentMethod:   'OWNER_FUNDED',
        },
      });

      return {
        rawMaterialId,
        name:      rm.name,
        batches,
        produced,
        unit:      rm.unit,
        unitCost,
        inputValue,
        newWac,
        quantityBefore: before,
        quantityAfter:  after,
        consumed: rm.subRecipeItems.map((l) => ({
          name:     l.rawMaterial.name,
          quantity: Number(l.quantity) * batches,
          unit:     l.rawMaterial.unit,
        })),
        madeAt: madeAt.toISOString(),
        madeBy: userId,
      };
    }, { timeout: 30_000, maxWait: 10_000 });
  }

  private async stockOf(branchId: string, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.rawMaterialInventory.findMany({
      where:  { branchId, rawMaterialId: { in: ids } },
      select: { rawMaterialId: true, quantity: true },
    });
    return new Map(rows.map((r) => [r.rawMaterialId, Number(r.quantity)]));
  }
}
