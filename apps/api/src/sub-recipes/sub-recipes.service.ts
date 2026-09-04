import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canPrepAtStation } from '@repo/shared-types';

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
  /**
   * How long this batch is good for, in days from when it was made.
   *
   * A prepared batch had no expiry at all: the lot was created with
   * `expirationDate` left null, so a tub thawed on Tuesday and a tub thawed
   * three weeks ago were indistinguishable, and FEFO had nothing to sort by.
   *
   * It matters most for the batch that is only PARTLY used. A ready tub sitting
   * on the line is the thing most likely to spoil, precisely because it is not
   * finished in a day — and nothing anywhere recorded when its clock started.
   *
   * Optional: a shop that does not track this is no worse off than before.
   */
  shelfLifeDays?: number;
  /** Or an explicit date, when the cook knows better than a rule of thumb. */
  expiresAt?: string;
  /**
   * WHICH station did this — the kitchen or the bar.
   *
   * A prep consumed raw materials and the record said only that the shop used
   * them. But the two halves of a cafe draw on the same shelf: sugar goes into
   * the bar's syrup and the kitchen's glaze, and "the shop used 4 kg of sugar"
   * cannot be split back apart afterwards. So nobody could answer what the
   * kitchen costs to run, and nobody could see that one side was quietly
   * burning through something the other side also needs.
   *
   * Deliberately a LABEL on the movement and not a separate stock balance.
   * Splitting the shelf in two would mean a bar till refusing a rice bowl
   * because its sauce is booked to the kitchen — the till reads one branch's
   * stock and refuses the sale outright. Recording who used it answers the
   * question without breaking the sale.
   *
   * Optional: a shop with one station, or one that never says, is exactly as
   * it was.
   */
  stationId?: string;
  /**
   * What ACTUALLY came out of the pot, when the cook measured it.
   *
   * The batch yield is a number nobody can know before the first batch. A shop
   * setting up a sauce is asked "how much does one batch make?" and the honest
   * answer is "we have never weighed it" -- so the figure entered at setup is a
   * guess, and every cost derived from it inherits the guess. Worse, the guess
   * never corrects itself: the system multiplies it by the batch count forever,
   * however far reality drifts.
   *
   * Measured once, this replaces it. The cost per unit is already
   * `inputValue / produced`, so a truthful output makes the costing truthful in
   * the same stroke -- a batch that reduced further than expected is more
   * concentrated and genuinely costs more per ml.
   *
   * Optional, and about the WHOLE batch, not per batch: it is what the cook
   * read off the jug, so it is compared against `batchYield x batches`.
   */
  actualYield?: number;
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
  async list(tenantId: string, branchId: string, personaKey?: string | null) {
    const rows = await this.prisma.rawMaterial.findMany({
      where:  { tenantId, isActive: true, subRecipeItems: { some: {} } },
      select: {
        id: true, name: true, unit: true, costPrice: true, batchYield: true,
        // The point at which someone should start the next batch. Read here so
        // the board can say so where the decision is made, rather than only in
        // a nightly alert nobody is standing next to.
        lowStockAlert: true,
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
      What a prep is actually FOR: servings.

      "Fifteen batches" is a number about the recipe. Nobody on the floor
      thinks that way -- a cook thinks "enough sauce for ten more plates" and a
      barista thinks "enough syrup for forty lattes". That is the number that
      decides whether to start prepping now or after the rush, and it is the
      one that was missing.

      Found by walking the other way: every product whose recipe calls for this
      prep, and how much of it one serving takes. The station comes with it,
      because Category routes to Station -- the same routing that already sends
      a ticket to the kitchen printer or the bar. So the kitchen sees kitchen
      preps and the bar sees its own, without anyone tagging anything.
    */
    const usedBy = await this.prisma.bomItem.findMany({
      where:  { rawMaterialId: { in: rows.map((r) => r.id) }, product: { tenantId, isActive: true } },
      select: {
        rawMaterialId: true,
        quantity:      true,
        product: {
          select: {
            id: true, name: true,
            category: { select: { id: true, name: true,
              station: { select: { id: true, name: true, kind: true } } } },
          },
        },
      },
    });
    const feeds = new Map<string, typeof usedBy>();
    for (const b of usedBy) {
      const list = feeds.get(b.rawMaterialId) ?? [];
      list.push(b);
      feeds.set(b.rawMaterialId, list);
    }

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

    /*
      The three levels, standardised.

        LEVEL 1  ready to use, on the line
        LEVEL 2  prepared and parked (frozen), waiting to be thawed into L1
        LEVEL 3  the raw ingredients, already at the station

      Derived, not configured. A prep that a PRODUCT consumes is what the floor
      serves from, so it is Level 1. A prep that only feeds ANOTHER prep is the
      one held behind it, so it is Level 2. The raw materials are Level 3 and
      are already on the card as the component list.

      Deriving it means the shop names nothing and maintains nothing, and the
      numbers cannot drift out of step with the recipes. Where a prep is
      neither -- a middle stage of a genuine multi-step cook, which is not this
      rotation at all -- the level is left null rather than invented.
    */
    const feedsAnotherPrep = new Set<string>();
    for (const parent of rows) {
      for (const line of parent.subRecipeItems) {
        if (prepById.has(line.rawMaterial.id)) feedsAnotherPrep.add(line.rawMaterial.id);
      }
    }

    const mapped = rows.map((r) => {
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

      /*
        Is this MAKING something, or MOVING something between states?

        Cafe Carolina's "levels" are not a cooking hierarchy. Level 2 is 2 kg
        of spaghetti sauce in the freezer and Level 3 is the same 2 kg thawed
        and on the line: same ingredients, same weight, nothing added. When the
        line runs dry the frozen batch is thawed and BECOMES the ready one, and
        the kitchen cooks a fresh batch for the freezer.

        The mechanism carries that already -- a one-line recipe of 2000 g of
        the frozen item yielding 2000 g of the ready one moves the quantity and
        the cost across untouched. What does not carry is the vocabulary:
        "batches", "made from", "I made some" are cooking words, and calling a
        thaw a batch reads as nonsense to the person doing it.

        So the shape is inferred rather than configured, because every shop
        does this differently and none of them should have to fill in a form
        about it. One component, that component is itself a prep, and the yield
        equals what goes in => nothing is being added, so it is a MOVE. Anything
        else is a MAKE.
      */
      const only = r.subRecipeItems.length === 1 ? r.subRecipeItems[0] : null;
      const isMove = !!only
        && prepById.has(only.rawMaterial.id)
        && r.batchYield != null
        && Math.abs(Number(only.quantity) - Number(r.batchYield)) < 1e-6;

      return {
        id:            r.id,
        name:          r.name,
        unit:          r.unit,
        costPrice:     r.costPrice != null ? Number(r.costPrice) : null,
        batchYield:    r.batchYield != null ? Number(r.batchYield) : null,
        onHand:        Number(r.inventory[0]?.quantity ?? 0),
        /**
         * When to start the next batch, and whether it is time.
         *
         * Zero is the wrong trigger for anything prepped ahead: a shop that
         * keeps a ready tub and a backup tub has the backup at zero for half
         * its life by design, and waiting for the READY one to hit zero means
         * waiting for the shortage itself. The par level is the point where
         * there is still enough on the line to serve from while the next batch
         * is made.
         *
         * Null when nobody has set one — reported honestly rather than guessed
         * at, because a made-up par level would fire warnings the shop learns
         * to ignore.
         */
        /**
         * 1 = ready to use, 2 = parked waiting to be thawed, null = neither.
         *
         * Level 3 is not a row here on purpose: it is the raw ingredients, and
         * they are already listed on the card as what a batch is made from.
         */
        level: (feeds.get(r.id) ?? []).length > 0
          ? 1 as const
          : feedsAnotherPrep.has(r.id) ? 2 as const : null,
        parLevel:      r.lowStockAlert != null ? Number(r.lowStockAlert) : null,
        belowPar:      r.lowStockAlert != null
                        && Number(r.inventory[0]?.quantity ?? 0) <= Number(r.lowStockAlert),
        /**
         * 'MOVE' when this is the same thing in a different state — thawed,
         * decanted, portioned — and 'MAKE' when it is genuinely produced from
         * other ingredients. Drives the wording only; the mechanics are the
         * same either way.
         */
        kind:          isMove ? ('MOVE' as const) : ('MAKE' as const),
        /** For a MOVE, where it comes from: the frozen tub, the bulk drum. */
        movesFrom:     isMove ? only!.rawMaterial.name : null,
        /*
          How many of each dish or drink this prep can still serve, from what
          is on hand right now. Several products share one prep and they
          compete for it, so each line is a ceiling on its own, not a total --
          the same honesty as the batch counts above.
        */
        serves: (feeds.get(r.id) ?? [])
          .filter((b) => Number(b.quantity) > 0)
          .map((b) => ({
            productId:    b.product.id,
            productName:  b.product.name,
            perServing:   Number(b.quantity),
            servingsLeft: Math.floor(Number(r.inventory[0]?.quantity ?? 0) / Number(b.quantity)),
          }))
          .sort((a, b) => a.servingsLeft - b.servingsLeft),
        /*
          Which station preps this, inferred from the products it feeds rather
          than tagged by hand. Category already routes to Station for kitchen
          and bar tickets, so a prep used only by pasta belongs to the kitchen
          and one used only by drinks belongs to the bar. Null when the
          products have no station set, or when a prep genuinely feeds both.
        */
        station: (() => {
          const st = [...new Map(
            (feeds.get(r.id) ?? [])
              .map((b) => b.product.category?.station)
              .filter((x): x is NonNullable<typeof x> => !!x)
              .map((x) => [x.id, x]),
          ).values()];
          return st.length === 1 ? st[0] : null;
        })(),
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

    /*
      A barista sees the bar's preps; a cook sees the kitchen's.

      Both jobs used the same account type, so every prep board showed every
      prep and each person had to pick their own out of the other's. On a phone
      mid-service that is how the wrong batch gets recorded -- and a wrongly
      attributed batch is worse than an unattributed one, because it reads as
      fact.

      A prep with NO station stays visible to EVERYONE. Null means the category
      was never routed to a station, or the prep genuinely feeds both sides --
      neither is a permission boundary, and hiding them would hand a shop that
      has not finished its menu setup a blank screen and the conclusion that
      the feature is broken.

      Someone with no persona, or a persona that names no station, sees
      everything. That is every account that exists today.
    */
    /*
      A parked batch belongs to whoever thaws it.

      Station is derived from the PRODUCTS a prep feeds, and a Level 2 tub feeds
      no product -- only the Level 1 tub in front of it. So every backup batch
      came back with no station and was therefore visible to everyone: the
      kitchen's frozen sauce sat on the barista's board, which is precisely the
      confusion the scoping exists to remove.

      Inherited one hop up, and only when the parents agree. A tub feeding two
      preps that belong to different stations genuinely has no single owner, and
      guessing one would be worse than leaving it visible to both.
    */
    for (const row of mapped) {
      if (row.station) continue;
      const parents = mapped.filter((m) =>
        m.components.some((c) => c.rawMaterialId === row.id));
      const stations = [...new Map(
        parents.map((m) => m.station).filter((x): x is NonNullable<typeof x> => !!x)
          .map((x) => [x.id, x]),
      ).values()];
      if (stations.length === 1) row.station = stations[0];
    }

    /*
      The shop's OWN stations, so a persona written for a floor plan this shop
      does not have cannot blank the board. See canPrepAtStation.
    */
    const shopKinds: string[] = [...new Set(
      mapped.map((m) => m.station?.kind).filter(Boolean).map(String),
    )];
    return mapped.filter((row) =>
      canPrepAtStation(personaKey, row.station?.kind ?? null, shopKinds));
  }

  /**
   * Which station preps ONE item — the same derivation the board uses.
   *
   * Written as its own method rather than inlined so the station a barista is
   * SHOWN and the station the server ENFORCES come from one place. Two copies
   * of this walk would drift, and the drift would show up as a cook being
   * refused a batch the board had just offered them.
   *
   * Null when the products it feeds have no station routed, or when it feeds
   * both sides. Null is permissive everywhere it is read.
   */
  private async stationOfPrep(
    tenantId: string,
    rawMaterialId: string,
    followParents = true,
  ): Promise<{ id: string; name: string; kind: string } | null> {
    const usedBy = await this.prisma.bomItem.findMany({
      where:  { rawMaterialId, product: { tenantId, isActive: true } },
      select: { product: { select: { category: { select: {
        station: { select: { id: true, name: true, kind: true } },
      } } } } },
    });
    const stations = [...new Map(
      usedBy
        .map((b) => b.product.category?.station)
        .filter((x): x is NonNullable<typeof x> => !!x)
        .map((x) => [x.id, x]),
    ).values()];
    if (stations.length === 1) {
      return { id: stations[0].id, name: stations[0].name, kind: String(stations[0].kind) };
    }
    if (stations.length > 1 || !followParents) return null;

    /*
      Nothing routed it directly, so ask whatever it feeds.

      A Level 2 tub feeds no product -- only the Level 1 tub in front of it --
      so it can never derive a station of its own, and without this the backup
      batch would be recordable by anyone. It belongs to whoever thaws it.

      One hop, and only when the parents agree: a tub feeding two preps at
      different stations genuinely has no single owner, and the permissive
      answer is the right one there.
    */
    const parents = await this.prisma.subRecipeItem.findMany({
      where:  { rawMaterialId, parent: { tenantId, isActive: true } },
      select: { parentRawMaterialId: true },
    });
    const found: Array<{ id: string; name: string; kind: string }> = [];
    for (const parent of parents) {
      // followParents=false: one hop only, so a cycle cannot spin here.
      const st = await this.stationOfPrep(tenantId, parent.parentRawMaterialId, false);
      if (st) found.push(st);
    }
    const uniq = [...new Map(found.map((x) => [x.id, x])).values()];
    return uniq.length === 1 ? uniq[0] : null;
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
  async makeBatch(
    tenantId: string,
    rawMaterialId: string,
    dto: MakeBatchDto,
    userId: string,
    personaKey?: string | null,
  ) {
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

    /*
      Who did this — resolved to a NAME here, while the row is in front of us.

      The payload is read back by Stock Movements long after the fact, and a
      bare id there would mean a join per row or, more likely, a screen that
      shows nothing. Storing the name alongside also survives the station being
      renamed later: the record says where the sugar went on the day it went.
    */
    let station: { id: string; name: string; kind: string } | null = null;
    if (dto.stationId) {
      const found = await this.prisma.station.findFirst({
        where:  { id: dto.stationId, tenantId },
        select: { id: true, name: true, kind: true },
      });
      if (!found) throw new BadRequestException('That station is not in your organization.');
      station = { id: found.id, name: found.name, kind: String(found.kind) };
    }

    /*
      A barista may not record the kitchen's batch, and a cook may not record
      the bar's.

      Enforced HERE and not only on the board, because the board is a picture:
      a stale tab, a bookmarked id, or the tablet app posting straight to the
      API would all sail past a filtered list. The rule and the filter share
      one derivation (stationOfPrep) and one predicate (canPrepAtStation), so
      the two cannot disagree.

      A prep with no station routed is allowed to everyone. That is a setup
      gap, not a boundary -- refusing it would block a whole shop's prep on a
      menu-routing task nobody has been asked to do.
    */
    const prepStation = await this.stationOfPrep(tenantId, rawMaterialId);
    // The same backstop the board uses: read the shop's real stations so a
    // persona written for a floor plan this shop does not have cannot refuse
    // every batch. Board and server must agree, so both consult it.
    const shopStations = await this.prisma.station.findMany({
      where: { tenantId, isActive: true }, select: { kind: true },
    });
    const shopKinds = [...new Set(shopStations.map((x) => String(x.kind)))];
    if (!canPrepAtStation(personaKey, prepStation?.kind ?? null, shopKinds)) {
      throw new BadRequestException(
        `"${rm.name}" is a ${prepStation?.name ?? 'different station'} prep. ` +
        `Ask the ${prepStation?.name ?? 'other station'} to record this batch.`,
      );
    }

    /*
      And when nobody said which station, fall back to the one this prep
      belongs to.

      Attribution was caller-supplied and therefore blank by default, which
      made the whole point of recording it -- what did the kitchen use this
      week -- depend on a person remembering to answer a question. The prep's
      own station is a fact already in the data, so use it.
    */
    if (!station && prepStation) {
      station = { id: prepStation.id, name: prepStation.name, kind: String(prepStation.kind) };
    }

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

    /*
      When this batch stops being good.

      An explicit date wins, because the person holding the tub knows more than
      a rule of thumb. Otherwise it is counted forward from when it was made,
      which is the only honest starting point: a batch's clock starts when it
      is prepared, not when it is first used.
    */
    let expiresAt: Date | null = null;
    if (dto.expiresAt) {
      expiresAt = new Date(dto.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException('The "good until" date is not a valid date.');
      }
    } else if (dto.shelfLifeDays != null) {
      const days = Number(dto.shelfLifeDays);
      if (!Number.isFinite(days) || days <= 0) {
        throw new BadRequestException('Shelf life has to be a positive number of days.');
      }
      expiresAt = new Date(madeAt.getTime() + days * 24 * 60 * 60 * 1000);
    }

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

    /*
      What the recipe SAYS this makes, and what the cook says it made.

      Expected is the setup figure; actual is a measurement. Where a
      measurement exists it wins, because it is the only one of the two that
      was ever checked against a jug.
    */
    const expected = Number(rm.batchYield) * batches;
    if (dto.actualYield != null) {
      const measured = Number(dto.actualYield);
      if (!Number.isFinite(measured) || measured <= 0) {
        throw new BadRequestException(
          'How much came out has to be a number greater than zero.',
        );
      }
    }
    const produced = dto.actualYield != null ? Number(dto.actualYield) : expected;
    /*
      How far the pot drifted from the recipe, as a fraction.

      Reported rather than acted on. A first measurement is one data point, and
      silently rewriting the recipe from it would let one badly-read jug
      redefine the costing of every future batch. The screen shows the drift and
      the owner decides.
    */
    const yieldVariance = expected > 0 ? +((produced - expected) / expected).toFixed(4) : null;
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
          // Null when the shop does not track it, which is the old behaviour.
          // Set, it gives FEFO something to sort by and the board something to
          // warn about before a tub is thrown away.
          expirationDate:  expiresAt,
          // The caller's key when it gave one, so a retry is caught above; the
          // generated form otherwise, which is descriptive but NOT unique --
          // two genuine batches of the same thing on the same day share it.
          referenceNumber: ref
            ?? `BATCH-${madeAt.toISOString().slice(0, 10)}-${rawMaterialId.slice(-6)}`,
          paymentMethod:   'OWNER_FUNDED',
        },
      });

      /*
        The record of the preparation itself.

        Stock Movements is built from AccountingEvent payloads, and a batch
        emitted none -- so making 2 kg of syrup was the one stock movement in
        the whole system with no trail. The sugar left the shelf, the syrup
        appeared, and nothing anywhere said who did it or when. For a shop that
        wants each preparation documented, that is the gap.

        Recorded as SUB_RECIPE_BATCH, which the journal deliberately posts
        NOTHING for: the components and the output are both raw-material
        inventory and the value is identical on both sides, so there is no
        entry to make. The event exists to be READ -- it is the paper trail,
        not a ledger instruction.

        Carries both sides, so the movement reads as one event rather than
        several unrelated ones: what was made, and everything it took.
      */
      await tx.accountingEvent.create({
        data: {
          tenantId,
          type:   'INVENTORY_ADJUSTMENT',
          status: 'PENDING',
          payload: {
            kind:            'SUB_RECIPE_BATCH',
            rawMaterialId,
            rawMaterialName: rm.name,
            unit:            rm.unit,
            branchId:        dto.branchId,
            // Null when the shop never said. Reported honestly rather than
            // guessed at -- a station attributed by assumption would put the
            // kitchen's sugar on the bar's running cost.
            stationId:       station?.id ?? null,
            stationName:     station?.name ?? null,
            stationKind:     station?.kind ?? null,
            batches,
            quantity:        produced,
            // What the recipe expected, so a drift is visible in the record and
            // not only in the moment.
            expectedQuantity: expected,
            measuredYield:    dto.actualYield != null ? Number(dto.actualYield) : null,
            yieldVariance,
            quantityBefore:  before,
            quantityAfter:   after,
            unitCost,
            totalValue:      +(produced * unitCost).toFixed(2),
            madeAt:          madeAt.toISOString(),
            madeById:        userId,
            expiresAt:       expiresAt ? expiresAt.toISOString() : null,
            referenceNumber: ref ?? null,
            note:            dto.note ?? null,
            consumed: rm.subRecipeItems.map((l) => ({
              rawMaterialId: l.rawMaterial.id,
              name:          l.rawMaterial.name,
              unit:          l.rawMaterial.unit,
              quantity:      Number(l.quantity) * batches,
              unitCost:      Number(l.rawMaterial.costPrice ?? 0),
            })),
          } as unknown as Prisma.JsonObject,
        },
      });

      return {
        rawMaterialId,
        name:      rm.name,
        station,
        batches,
        /** What the recipe said it would make. */
        expected,
        /** Non-null only when the cook measured. Positive = more than expected. */
        yieldVariance: dto.actualYield != null ? yieldVariance : null,
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
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
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
