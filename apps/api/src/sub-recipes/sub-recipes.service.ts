import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
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
  /**
   * Idempotency key. The same string only ever makes the batch once.
   *
   * Recording a batch is not something a person can SEE happening, and it is
   * done on a phone in a kitchen: a double-tap, or a retry after the signal
   * dropped, would consume the sugar twice and invent syrup nobody made. The
   * lot's own generated reference cannot serve as the key -- it is
   * BATCH-<date>-<id>, identical for two genuine batches of the same thing
   * on the same day.
   */
  referenceNumber?: string;
}

export interface SubRecipeLineInput {
  rawMaterialId: string;
  /** Consumed per ONE batch, in the component's own unit. */
  quantity: number;
}

@Injectable()
export class SubRecipesService {
  constructor(
    private readonly prisma: PrismaService,
    /*
      Making a batch moves stock and revalues an ingredient, so it belongs
      inside the period lock like every other stock movement. Optional so an
      older wiring that constructs this with Prisma alone still boots.
    */
    @Optional() private readonly periods?: AccountingPeriodsService,
  ) {}

  /**
   * Every prepared ingredient the shop makes, with what it can still produce.
   *
   * There was no way to LIST these, which is why there has never been a screen:
   * the API could fetch one by id, cost it and record a batch, but nothing
   * could show a cook what there was to make. So a shop that defined a house
   * syrup or a sauce had a recipe nobody could act on, and its components never
   * moved — they never tripped a reorder level, never reached a buy list, and
   * ran out mid-service while the system insisted they were on the shelf.
   */
  async list(tenantId: string, branchId: string) {
    const rows = await this.prisma.rawMaterial.findMany({
      where:  { tenantId, isActive: true, subRecipeItems: { some: {} } },
      select: {
        id: true, name: true, unit: true, costPrice: true, batchYield: true,
        inventory: { where: { branchId }, select: { quantity: true } },
        subRecipeItems: {
          select: {
            quantity: true,
            rawMaterial: { select: { id: true, name: true, unit: true, costPrice: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // One stock read for everything the whole tree touches, rather than a round
    // trip per recipe: a kitchen with a dozen preps would otherwise pay a dozen
    // queries to draw one list.
    const allIds = [...new Set([
      ...rows.map((r) => r.id),
      ...rows.flatMap((r) => r.subRecipeItems.map((l) => l.rawMaterial.id)),
    ])];
    const stock = await this.stockOf(branchId, allIds);
    const prepById = new Map(rows.map((r) => [r.id, r]));

    /*
      How much of something could this shop actually get its hands on.

      Not just what is on the shelf: a prepared item can be MADE, and what it
      is made from can often be made too. Three levels deep is the shape the
      owner actually runs — a base, a mother sauce built on the base, a
      finishing sauce built on that — and it exists precisely so service is
      fast, because the slow work is already done before the customer orders.

      Looking only one level down (what this used to do) tells a cook "you
      cannot make the finishing sauce, you are out of mother sauce" and stops
      there. That is the least useful true statement available: the cook still
      has to walk the chain by hand to discover there is plenty of base and the
      thing actually missing is sugar.

      NOTE: this is an upper bound per item, not a production plan. Two preps
      sharing a component are each told what they could make if they had it
      all; making one really does reduce what the other can make. For "what
      should I prep next" that is the right number, and the batch screen still
      refuses anything the shelf cannot actually support.
    */
    const memo = new Map<string, number>();
    const available = (id: string, visiting: Set<string>): number => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      const onHand = stock.get(id) ?? 0;
      const prep = prepById.get(id);
      // A cycle cannot be created through setRecipe, which walks the whole tree
      // and refuses one. Guarded anyway so older data cannot hang a request.
      if (!prep || prep.batchYield == null || Number(prep.batchYield) <= 0 || visiting.has(id)) {
        memo.set(id, onHand);
        return onHand;
      }
      visiting.add(id);
      let couldMake = Number.POSITIVE_INFINITY;
      for (const line of prep.subRecipeItems) {
        const per = Number(line.quantity);
        if (per <= 0) continue;
        couldMake = Math.min(couldMake, Math.floor(available(line.rawMaterial.id, visiting) / per));
      }
      visiting.delete(id);
      const total = onHand + (Number.isFinite(couldMake) ? couldMake * Number(prep.batchYield) : 0);
      memo.set(id, total);
      return total;
    };

    /*
      Which RAW material finally runs out, and the path down to it.

      Follows the binding component at each level until it reaches something
      that is not itself a prep. "Short on sugar" is actionable; "short on
      mother sauce" is a puzzle.
    */
    const rootLimiter = (id: string, seen: Set<string>): { name: string; chain: string[] } | null => {
      const prep = prepById.get(id);
      if (!prep || seen.has(id)) return null;
      seen.add(id);
      let worst: { id: string; name: string; can: number } | null = null;
      for (const line of prep.subRecipeItems) {
        const per = Number(line.quantity);
        if (per <= 0) continue;
        const can = Math.floor(available(line.rawMaterial.id, new Set()) / per);
        if (!worst || can < worst.can) {
          worst = { id: line.rawMaterial.id, name: line.rawMaterial.name, can };
        }
      }
      if (!worst) return null;
      const deeper = rootLimiter(worst.id, seen);
      return deeper
        ? { name: deeper.name, chain: [worst.name, ...deeper.chain] }
        : { name: worst.name, chain: [worst.name] };
    };

    return rows.map((r) => {
      // What the shelf supports RIGHT NOW, with no prep in between. This is
      // what the cook can start on this minute.
      let readyNow = Number.POSITIVE_INFINITY;
      let blockedBy: string | null = null;
      for (const line of r.subRecipeItems) {
        const per = Number(line.quantity);
        if (per <= 0) continue;
        const can = Math.floor((stock.get(line.rawMaterial.id) ?? 0) / per);
        if (can < readyNow) { readyNow = can; blockedBy = line.rawMaterial.name; }
      }
      const batchesNow = Number.isFinite(readyNow) ? readyNow : 0;

      // And what it supports if the levels underneath are made first.
      let withPrep = Number.POSITIVE_INFINITY;
      for (const line of r.subRecipeItems) {
        const per = Number(line.quantity);
        if (per <= 0) continue;
        withPrep = Math.min(withPrep, Math.floor(available(line.rawMaterial.id, new Set()) / per));
      }
      const batchesWithPrep = Number.isFinite(withPrep) ? withPrep : 0;
      const root = rootLimiter(r.id, new Set());

      return {
        id:            r.id,
        name:          r.name,
        unit:          r.unit,
        costPrice:     r.costPrice != null ? Number(r.costPrice) : null,
        batchYield:    r.batchYield != null ? Number(r.batchYield) : null,
        onHand:        Number(r.inventory[0]?.quantity ?? 0),
        /** Batches the shelf supports with no prep in between. */
        batches:       batchesNow,
        /** The component that stops it right now — often another prep. */
        limitedBy:     batchesNow === 0 ? blockedBy : null,
        /** Batches once the levels underneath are made first. */
        batchesWithPrep,
        /** The raw material that finally runs out, however deep it sits. */
        rootLimitedBy: root?.name ?? null,
        /** The path from this item down to that raw material. */
        limiterChain:  root?.chain ?? [],
        /** Whether anything below this has to be made before it can be. */
        needsPrep:     batchesWithPrep > batchesNow,
        components: r.subRecipeItems.map((l) => ({
          rawMaterialId: l.rawMaterial.id,
          name:          l.rawMaterial.name,
          unit:          l.rawMaterial.unit,
          quantity:      Number(l.quantity),
          onHand:        stock.get(l.rawMaterial.id) ?? 0,
          /** True when this component is itself something the shop preps. */
          isPrep:        prepById.has(l.rawMaterial.id),
        })),
      };
    });
  }

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

    if (this.periods) await this.periods.assertDateIsOpen(tenantId, madeAt);

    /*
      The same reference only ever makes the batch once.

      Checked before any write, and returns the original outcome rather than
      throwing, so a client retrying after a timeout gets the answer it would
      have got the first time.
    */
    const ref = dto.referenceNumber?.trim();
    if (ref) {
      const already = await this.prisma.rawMaterialLot.findFirst({
        where:  { tenantId, rawMaterialId, referenceNumber: ref },
        select: { id: true, qtyReceived: true },
      });
      if (already) {
        return {
          rawMaterialId,
          branchId:  dto.branchId,
          produced:  Number(already.qtyReceived),
          duplicate: true,
          message:   'This batch was already recorded. Nothing was made again.',
        };
      }
    }

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
        // Relative, so a sale ringing at the same moment is not erased by a
        // total computed from a snapshot taken before it.
        await tx.rawMaterialInventory.update({
          where: { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId: line.rawMaterial.id } },
          data:  { quantity: { decrement: new Prisma.Decimal(used) } },
        });

        /*
          Drain the components' lot layers too.

          The batch CREATES a lot for its output and never touched the inputs',
          so qtyRemaining on the sugar and the mirin kept counting stock that
          had already been stirred into syrup. On a FIFO or lot-tracked
          ingredient the next sale then drained a layer that was not there,
          costing it at a price the shop had already used up, and the oldest
          layer never aged out.

          Oldest first, the same order the sale path uses.
        */
        let remaining = used;
        const lots = await tx.rawMaterialLot.findMany({
          where:   { branchId: dto.branchId, rawMaterialId: line.rawMaterial.id, qtyRemaining: { gt: 0 } },
          orderBy: [{ receivedAt: 'asc' }],
        });
        for (const lot of lots) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, Number(lot.qtyRemaining));
          await tx.rawMaterialLot.update({
            where: { id: lot.id },
            data:  { qtyRemaining: { decrement: new Prisma.Decimal(take) } },
          });
          remaining -= take;
        }
      }

      // Whatever the decrements pushed below zero, floor once. A relative
      // write cannot clamp itself, and negative stock makes every later
      // number -- maxProducible, count variance, valuation -- nonsense.
      await tx.rawMaterialInventory.updateMany({
        where: {
          branchId: dto.branchId,
          rawMaterialId: { in: rm.subRecipeItems.map((l) => l.rawMaterial.id) },
          quantity: { lt: 0 },
        },
        data: { quantity: new Prisma.Decimal(0) },
      });

      const existing = await tx.rawMaterialInventory.findUnique({
        where:  { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId } },
        select: { quantity: true },
      });
      const before = existing ? Number(existing.quantity) : 0;
      const after  = before + produced;

      await tx.rawMaterialInventory.upsert({
        where:  { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId } },
        create: { tenantId, branchId: dto.branchId, rawMaterialId, quantity: new Prisma.Decimal(after) },
        // Relative for the same reason the components are.
        update: { quantity: { increment: new Prisma.Decimal(produced) } },
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
          // The caller's key when it gave one, so a retry is caught above; the
          // generated form otherwise, which is descriptive but NOT unique --
          // two genuine batches of the same thing on the same day share it.
          referenceNumber: ref
            ?? `BATCH-${madeAt.toISOString().slice(0, 10)}-${rawMaterialId.slice(-6)}`,
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
