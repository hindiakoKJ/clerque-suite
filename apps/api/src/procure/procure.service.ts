import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, PurchaseRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { SimpleEntriesService } from '../simple-entries/simple-entries.service';
import { ExpenseCategory } from '../simple-entries/dto/simple-entry.dto';
import { DocumentsService } from '../documents/documents.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { PH_TIMEZONE } from '@repo/shared-types';
import { canSeePurchaseCosts, COST_DECIDER_ROLES } from './cost-visibility';
import { ProcurePocket, ShortOutcome, PhotoLabel } from './dto/receive-request.dto';
import { appendNote, withTag } from './procure-notes';

/**
 * Clerque Procure — the shop asking the owner to buy something.
 *
 * The failure this removes is one of timing, not paperwork: a shortage is
 * found while someone is already standing in the grocery, so a message goes to
 * the owners and somebody makes a second trip, purely to keep "nothing
 * unavailable on the menu" true. A better form does not prevent that. Knowing
 * before anyone leaves does.
 *
 * No vendor, no terms, no accrual. An MSME cafe buys at the grocery and on
 * Shopee and owes nobody, so a request becomes a cash or owner-funded receipt
 * directly. OWNER_FUNDED credits 3010 Owner's Capital, which is the honest
 * treatment when an owner pays out of pocket.
 *
 * The line's control number is passed through as the receive reference, so
 * "do not receive the same line twice" is enforced by the database instead of
 * by someone remembering.
 */

export interface AddLineDto {
  rawMaterialId: string;
  qtyRequested:  number;
  shortBy?:      number;
}

export interface BoughtLineDto {
  lineId:      string;
  packsBought: number;
  packSize:    number;
  packCost:    number;
  brandNote?:  string;
}

/** What one post to stock may carry beyond the pocket. */
export interface ReceiveOpts {
  /** The day the goods came (YYYY-MM-DD). Defaults to today. */
  receivedAt?: string;
  /** One line for a person: the stall, the receipt number, "no receipt". */
  note?: string;
  acceptCostChangeFor?: Set<string>;
  acceptCostChangeAll?: boolean;
  /** Only these lines, each with how many packs actually came. Omit = every line with packs. */
  lines?: Array<{ lineId: string; packsArrived?: number }>;
  /** For a line that came short, what happens to the rest. Default: still coming. */
  closeShort?: Array<{ lineId: string; outcome: ShortOutcome }>;
  /** Close the request after this post; what was not posted goes back on the shopping list. */
  closeRest?: boolean;
  /** Charges that came with the goods: shipping, a platform fee, parking. Posted once, with the lines. */
  charges?: Array<{ description: string; amount: number; category?: ExpenseCategory }>;
}

/** What the newest received line of an ingredient held and cost. */
export interface LastPack {
  packSize:   number;
  packCost:   number | null;
  brandNote:  string | null;
  receivedAt: Date | null;
}

/** What somebody counted on the shelf while building the list, waiting to be posted. */
export interface CountedLine {
  qty: number;
  expected: number;
  countId: string;
  countNumber: string;
}

export interface PostedExpense {
  description: string;
  amount: number;
  entryNumber?: string;
  status?: string;
  error?: string;
}

@Injectable()
export class ProcureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    /*
      Optional so the specs that build this service with the two above keep
      running as they are; the methods that need these say so when absent.
    */
    @Optional() private readonly simple?: SimpleEntriesService,
    @Optional() private readonly documents?: DocumentsService,
    @Optional() private readonly warehouse?: WarehouseService,
  ) {}

  /**
   * The branch a request belongs to, when the caller did not say.
   *
   * A second owner or an MDM account is often created with no branch, and
   * every Procure route read `user.branchId!` -- so for them the open list,
   * Check stock and the menu ceiling all queried a branch of `undefined` and
   * came back empty with no error. Given nothing, the shop's first branch;
   * given something, it has to be this tenant's.
   */
  async resolveBranch(tenantId: string, branchId?: string | null): Promise<string> {
    if (branchId) {
      const own = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId }, select: { id: true } });
      if (!own) throw new BadRequestException('Branch not found in your organization.');
      return own.id;
    }
    const first = await this.prisma.branch.findFirst({
      where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { id: true },
    });
    if (!first) throw new BadRequestException('This organization has no branch yet.');
    return first.id;
  }

  /**
   * What one viewer is allowed to see of a request's money.
   *
   * Read per call rather than carried in the JWT: an owner who turns this off
   * expects it to take effect now, not after every member of staff has logged
   * out and back in again.
   */
  private async costsVisibleTo(tenantId: string, role?: string | null): Promise<boolean> {
    // The people who decide always see; only for everyone else is it worth
    // a query to find out what this shop has chosen.
    if (COST_DECIDER_ROLES.includes(role ?? '')) return true;
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { showPurchaseCostsToStaff: true },
    });
    return canSeePurchaseCosts(role, tenant?.showPurchaseCostsToStaff);
  }

  /**
   * Blank the cost of every line and flag the request, so the screen can drop
   * the total and the receipt photo rather than render an empty money column.
   * Quantities stay: what was asked for and how much arrived is the staff's
   * own work, and hiding it would make the screen useless to them.
   */
  private stripCosts<T extends { lines?: Array<Record<string, unknown>> }>(req: T): T {
    return {
      ...req,
      costsHidden: true,
      lines: (req.lines ?? []).map((l) => ({
        ...l,
        packCost: null,
        // The ingredient's own running cost rides along on every line. The
        // screen does not print it, but it is the same information -- what
        // the shop pays for things -- and it is one network tab away.
        rawMaterial: l.rawMaterial ? { ...(l.rawMaterial as Record<string, unknown>), costPrice: null } : l.rawMaterial,
        // So does what it cost last time.
        lastPack: l.lastPack ? { ...(l.lastPack as Record<string, unknown>), packCost: null } : l.lastPack,
      })),
    } as T;
  }

  // ── the open request ──────────────────────────────────────────────────────

  /**
   * One OPEN request per branch at a time. Anyone can add to it through the
   * day; a second open request would split the shopping list in half and
   * guarantee two trips, which is the thing being fixed.
   */
  async openRequest(tenantId: string, branchId: string, userId: string, viewerRole?: string | null) {
    const [opened] = await this.enrich(tenantId, [await this.openRequestRaw(tenantId, branchId, userId)]);
    if (await this.costsVisibleTo(tenantId, viewerRole)) return opened;
    return this.stripCosts(opened);
  }

  private async openRequestRaw(tenantId: string, branchId: string, userId: string) {
    const existing = await this.prisma.purchaseRequest.findFirst({
      where:   { tenantId, branchId, status: 'OPEN' },
      include: this.lineInclude(),
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;

    const requestNumber = await this.nextNumber(tenantId);
    return this.prisma.purchaseRequest.create({
      data:    { tenantId, branchId, requestNumber, createdById: userId },
      include: this.lineInclude(),
    });
  }

  async list(tenantId: string, branchId?: string, status?: PurchaseRequestStatus, viewerRole?: string | null) {
    const rows = await this.enrich(tenantId, await this.prisma.purchaseRequest.findMany({
      where:   { tenantId, ...(branchId ? { branchId } : {}), ...(status ? { status } : {}) },
      include: this.lineInclude(),
      orderBy: { createdAt: 'desc' },
      take:    100,
    }));
    if (await this.costsVisibleTo(tenantId, viewerRole)) return rows;
    return rows.map((r) => this.stripCosts(r));
  }

  /**
   * The request as it really is, costs and all. Every write path reads it
   * this way: sending, recording what was bought and posting to stock all
   * need the money, and must never be handed a copy that was blanked for
   * somebody's screen.
   */
  private async getRaw(tenantId: string, id: string) {
    const req = await this.prisma.purchaseRequest.findFirst({
      where: { id, tenantId }, include: this.lineInclude(),
    });
    if (!req) throw new NotFoundException('Purchase request not found.');
    return req;
  }

  /** The request as this viewer is allowed to see it. */
  async get(tenantId: string, id: string, viewerRole?: string | null) {
    const [req] = await this.enrich(tenantId, [await this.getRaw(tenantId, id)]);
    if (!(await this.costsVisibleTo(tenantId, viewerRole))) return this.stripCosts(req);
    return req;
  }

  /**
   * Add a line, or raise an existing one. Asking for the same ingredient twice
   * on one request is always a mistake — it would send someone for sugar twice.
   */
  async addLine(tenantId: string, requestId: string, dto: AddLineDto) {
    const req = await this.getRaw(tenantId, requestId);
    if (req.status !== 'OPEN') {
      throw new BadRequestException(
        `This request is already ${req.status.toLowerCase()}. Start a new one to add more.`,
      );
    }
    if (!(dto.qtyRequested > 0)) {
      throw new BadRequestException('Enter how much is needed.');
    }
    const rm = await this.prisma.rawMaterial.findFirst({
      where: { id: dto.rawMaterialId, tenantId }, select: { id: true, name: true },
    });
    if (!rm) throw new BadRequestException('Ingredient not found in your list.');

    const existing = req.lines.find((l) => l.rawMaterialId === dto.rawMaterialId);
    if (existing) {
      return this.prisma.purchaseRequestLine.update({
        where: { id: existing.id },
        data:  { qtyRequested: new Prisma.Decimal(dto.qtyRequested) },
      });
    }
    return this.prisma.purchaseRequestLine.create({
      data: {
        purchaseRequestId: requestId,
        lineNumber:        this.nextLineNumber(req.requestNumber, req.lines),
        rawMaterialId:     dto.rawMaterialId,
        qtyRequested:      new Prisma.Decimal(dto.qtyRequested),
        shortBy:           dto.shortBy != null ? new Prisma.Decimal(dto.shortBy) : null,
      },
    });
  }

  async removeLine(tenantId: string, requestId: string, lineId: string) {
    const req = await this.getRaw(tenantId, requestId);
    if (req.status !== 'OPEN') {
      throw new BadRequestException('Only an open request can be edited.');
    }
    await this.prisma.purchaseRequestLine.deleteMany({
      where: { id: lineId, purchaseRequestId: requestId },
    });
    return { removed: lineId };
  }

  /**
   * Pull everything currently below its reorder level onto the open request.
   *
   * This is the whole point of the feature: the list assembles itself from
   * what the shop already knows, instead of from whoever happens to notice.
   */
  async pullLowStock(tenantId: string, branchId: string, userId: string) {
    const req = await this.openRequest(tenantId, branchId, userId);
    if (req.status !== 'OPEN') throw new BadRequestException('The current request is closed.');

    const low = await this.inventory.getLowStock(tenantId, branchId);
    /*
      Only things the shop can BUY.

      A prepared item is short of being MADE. Putting "White Sugar Syrup --
      SHORT 800 ml" on a grocery slip sends someone to a supplier for
      something their own bar produces, and for a shop that rotates a parked
      batch it would nag every single day, because empty is that batch's
      normal state.
    */
    const ingredients = (low as Array<Record<string, unknown>>).filter(
      (r) => r['kind'] !== 'PREP' && (r['kind'] === 'INGREDIENT' || r['rawMaterialId']),
    );
    const toMake = (low as Array<Record<string, unknown>>).filter((r) => r['kind'] === 'PREP');

    let added = 0;
    for (const row of ingredients) {
      const rawMaterialId = String(row['rawMaterialId'] ?? row['id'] ?? '');
      if (!rawMaterialId) continue;
      /*
        An item sitting EXACTLY on its line is short too.

        "Is this low?" is asked in three places and this one disagreed with the
        other two at the boundary. getLowStock flags `onHand <= lowStockAlert`
        and the nightly alert uses the same test, so an item resting exactly on
        its level is flagged by both -- but its shortfall is 0, and `> 0`
        dropped it here. One shop, one night, three answers: the email said
        "Straws - 6 pcs left", the printed slip said "SHORT 0 pcs", and Check
        stock said "Nothing is below its reorder level right now."

        A cafe weighing grams almost never lands on exact equality, which is
        why this stayed hidden. A shop counting whole units -- cups, lids,
        sachets, slices -- lands on it constantly, and Carolina counts cups and
        lids in pieces.

        `>= 0` also keeps a NaN out, the way `> 0` did.
      */
      const shortBy = Number(row['shortBy'] ?? 0);
      if (!(shortBy >= 0)) continue;
      if (req.lines.some((l) => l.rawMaterialId === rawMaterialId)) continue;
      /*
        Buy PAST the line, not exactly to it.

        The low-stock test is `quantity <= lowStockAlert`, so restoring stock to
        exactly the reorder level leaves the item still flagged: it reappears on
        the next Check stock, gets bought again, and never clears. A reorder
        level is the point at which you buy, not the amount you want on the
        shelf — so ask for enough to get above it and leave some cover.

        Doubling the shortfall is a deliberately simple rule. A real
        reorder-quantity per ingredient is worth having, but guessing one is
        worse than a rule the owner can see and override on the line.
      */
      /*
        Exactly on the line the shortfall is zero, and asking for zero is not
        asking. Fall back to the reorder level itself, which follows the same
        rule as the doubling: get above the line and leave some cover.
      */
      const level = Number(row['lowStockAlert'] ?? 0);
      const qtyRequested = shortBy > 0 ? shortBy * 2 : (level > 0 ? level : 1);
      await this.addLine(tenantId, req.id, { rawMaterialId, qtyRequested, shortBy });
      added++;
    }

    /*
      How many ingredients this check could not have found, whatever their
      stock.

      The low-stock test is `quantity <= lowStockAlert`, and an ingredient with
      no reorder level fails the `!= null` guard before the comparison. So it
      can never appear here — not when it runs low, not when it hits zero.
      Adding nothing therefore has two completely different meanings, and the
      screen said the reassuring one for both: "nothing is below its reorder
      level" reads as "you are fine" when the truth may be "nobody is
      watching any of these".

      A shop can pass a whole kitchen through the app or the onboarding
      workbook without filling this column once — it is optional in both — and
      then wonder why Check stock keeps coming back empty while the rice runs
      out. Counting them is the fix; inventing a default reorder level is not,
      because a threshold nobody chose is a number nobody can trust.
    */
    const unmonitored = await this.prisma.rawMaterial.count({
      where: { tenantId, isActive: true, lowStockAlert: null },
    });

    return {
      requestId: req.id, requestNumber: req.requestNumber, added, unmonitored,
      /*
        Prepared items that are low, reported separately so the screen can send
        someone to make them instead of to the market. Silence about these
        would be worse than the old behaviour: the shortage is real, only the
        remedy is different.
      */
      toMake: toMake.map((r) => ({
        id:       String(r['id'] ?? ''),
        name:     String(r['name'] ?? ''),
        unit:     String(r['unit'] ?? ''),
        quantity: Number(r['quantity'] ?? 0),
        shortBy:  Number(r['shortBy'] ?? 0),
      })),
    };
  }

  // ── cutoff ────────────────────────────────────────────────────────────────

  /**
   * Close the request and send it.
   *
   * An EMPTY request is still sent, on purpose. Silence cannot be told apart
   * from a cron that died or a shop that never looked, so an explicit "nothing
   * hit the warning level" is what makes the absence of a request mean
   * something. That is why this returns `empty` rather than refusing.
   */
  async sendRequest(tenantId: string, requestId: string, userId: string) {
    const req = await this.getRaw(tenantId, requestId);
    if (req.status !== 'OPEN') {
      throw new BadRequestException(`This request was already sent (${req.status.toLowerCase()}).`);
    }
    const updated = await this.prisma.purchaseRequest.update({
      where:   { id: requestId },
      data:    { status: 'SENT', sentAt: new Date(), sentById: userId },
      include: this.lineInclude(),
    });
    return { ...updated, empty: updated.lines.length === 0 };
  }

  // ── shopping ──────────────────────────────────────────────────────────────

  /**
   * Record what was actually bought: containers, what each holds, what each
   * cost. Doing the packs-to-units maths here is what lets the spreadsheet be
   * a backup rather than the only place the conversion can happen.
   *
   * Whoever is holding the bag may record it, not only the owner -- on one
   * condition: the shop shows purchase costs to its staff. Recording a price
   * you are not allowed to see makes no sense, and that one switch already
   * says which kind of shop this is. Recording never posts anything.
   */
  async recordBought(
    tenantId: string,
    requestId: string,
    lines: BoughtLineDto[],
    actor?: { userId: string; role?: string | null },
    extra: { note?: string; boughtAt?: string; onTheWay?: boolean } = {},
  ) {
    const req = await this.getRaw(tenantId, requestId);
    if (req.status !== 'SENT' && req.status !== 'BOUGHT') {
      throw new BadRequestException(
        `A request has to be sent before it can be bought against (this one is ${req.status.toLowerCase()}).`,
      );
    }
    const decider = !actor || COST_DECIDER_ROLES.includes(actor.role ?? '');
    if (!decider) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId }, select: { showPurchaseCostsToStaff: true },
      });
      if (!canSeePurchaseCosts(actor.role, tenant?.showPurchaseCostsToStaff)) {
        throw new BadRequestException(
          'On this account only the owner or manager records what was bought. '
          + 'The owner can open it to staff by showing purchase costs to staff under Settings.',
        );
      }
    }
    for (const l of lines) {
      if (!(l.packsBought > 0)) throw new BadRequestException('How many packs were bought?');
      if (!(l.packSize    > 0)) throw new BadRequestException('What does one pack hold?');
      /*
        Zero is refused, the way the receipt path refuses it. A zero here is
        almost always a price that was not typed -- and it does not stay
        here: receiving blends it into the ingredient's average cost, and
        every recipe using it gets cheaper on paper. A pack that really was
        free is left out of the count and mentioned under Brand.
      */
      if (!(l.packCost > 0)) {
        throw new BadRequestException(
          'What did one pack cost? A zero would pull the ingredient\'s average cost down. '
          + 'If a pack was free, leave it out of the count and say so under Brand.',
        );
      }
      const owned = req.lines.find((x) => x.id === l.lineId);
      if (!owned) throw new BadRequestException('That line is not on this request.');
      /*
        The status window above admits BOUGHT, which is where a request sits
        when one of its lines failed to post. Its OTHER lines are already on
        the shelf and already in the books, and rewriting their packs or
        price here changed neither -- it just left the request disagreeing
        with the lot and the journal entry, with nothing to reconcile them.
        The screen has always hidden these boxes for a posted line; the
        server never checked.
      */
      if (owned.receivedAt) {
        throw new BadRequestException(
          `"${owned.rawMaterial?.name ?? 'That line'}" is already in stock. `
          + 'Correct it under Stock instead — changing it here would leave the books behind.',
        );
      }
      /*
        Staff get one go at a line. Nothing records who typed what, so the
        only way to keep a cook from overwriting the owner's correction is to
        let staff fill a blank line and leave a filled one to the deciders.
      */
      if (!decider && owned.packsBought != null) {
        throw new BadRequestException(
          `"${owned.rawMaterial?.name ?? 'That line'}" was already recorded. Ask the owner or manager to change it.`,
        );
      }
    }

    await this.prisma.$transaction(
      lines.map((l) =>
        this.prisma.purchaseRequestLine.update({
          where: { id: l.lineId },
          data: {
            packsBought: new Prisma.Decimal(l.packsBought),
            packSize:    new Prisma.Decimal(l.packSize),
            packCost:    new Prisma.Decimal(l.packCost),
            brandNote:   l.brandNote?.trim() || null,
          },
        }),
      ),
    );

    let notes = req.notes;
    if (extra.note) notes = appendNote(notes, extra.note);
    const boughtDay = extra.boughtAt ? this.dayOf(extra.boughtAt) : null;
    if (extra.onTheWay) notes = withTag(notes, 'ONTHEWAY', boughtDay ?? this.today());
    return this.prisma.purchaseRequest.update({
      where:   { id: requestId },
      data:    {
        status:   'BOUGHT',
        // The first recording sets the day; a correction later does not move it.
        boughtAt: boughtDay ? this.manilaMidnight(boughtDay) : (req.boughtAt ?? new Date()),
        ...(notes !== req.notes ? { notes } : {}),
      },
      include: this.lineInclude(),
    });
  }

  // ── posting to stock ──────────────────────────────────────────────────────

  /**
   * Post what arrived to stock.
   *
   * Each line is received on its own, with its own control number as the
   * reference. A line that fails — a locked period, say — does not cost the
   * rest of the delivery, and a line already received is skipped rather than
   * doubled, because receiveRawMaterial refuses a reference it has seen.
   *
   * What is posted is what ARRIVED, at the price paid per pack. A line that
   * came short is rewritten to the packs that came, so the line, the lot and
   * the books agree, and the rest goes one of four ways: a follow-up request
   * already "on the way", a refund (nothing more to post -- the pocket was
   * charged only for what came), a loss (an expense for packs paid for and
   * gone), or simply not coming. Lines nobody bought go back on the branch's
   * shopping list when the request closes, which is what the screen has
   * always promised.
   */
  async receiveRequest(
    tenantId: string,
    requestId: string,
    userId: string,
    paymentMethod: ProcurePocket = 'CASH',
    opts: ReceiveOpts = {},
  ) {
    const req = await this.getRaw(tenantId, requestId);
    if (req.status !== 'BOUGHT' && req.status !== 'RECEIVED') {
      throw new BadRequestException(
        `Record what was bought before posting it to stock (this one is ${req.status.toLowerCase()}).`,
      );
    }

    // Which lines this call is about. Given nothing: every line with packs.
    const chosen = new Map<string, number | undefined>();
    for (const l of opts.lines ?? []) {
      if (!req.lines.some((x) => x.id === l.lineId)) throw new BadRequestException('That line is not on this request.');
      chosen.set(l.lineId, l.packsArrived);
    }
    const outcomeOf = new Map<string, ShortOutcome>((opts.closeShort ?? []).map((c) => [c.lineId, c.outcome]));
    const receivedDay = opts.receivedAt ? this.dayOf(opts.receivedAt) : this.today();

    const posted:  Array<{ line: string; name: string; quantity: number; unitCost: number; warning: string | null }> = [];
    const skipped: Array<{ line: string; name: string; reason: string }> = [];
    const failed:  Array<{ line: string; name: string; reason: string }> = [];
    const short:   Array<{
      line: string; name: string; rawMaterialId: string;
      packsBought: number; packsArrived: number; packSize: number; packCost: number; brandNote: string | null;
      outcome: ShortOutcome;
    }> = [];
    const done = new Set<string>();

    for (const line of req.lines) {
      const name = line.rawMaterial.name;
      if (line.receivedAt) { skipped.push({ line: line.lineNumber, name, reason: 'Already posted.' }); continue; }
      if (line.packsBought == null || line.packSize == null || line.packCost == null) {
        skipped.push({ line: line.lineNumber, name, reason: 'Nothing was bought for this line.' });
        continue;
      }
      if (opts.lines && !chosen.has(line.id)) continue;   // left for a later post

      const bought  = Number(line.packsBought);
      const arrived = chosen.get(line.id) ?? bought;
      if (arrived > bought + 1e-9) {
        failed.push({ line: line.lineNumber, name, reason: `More arrived than were bought (${arrived} of ${bought}). Change Packs first, then post.` });
        continue;
      }
      const size     = Number(line.packSize);
      const cost     = Number(line.packCost);
      const quantity = arrived * size;
      const unitCost = cost / size;
      if (!(size > 0) || !(quantity >= 0)) { skipped.push({ line: line.lineNumber, name, reason: 'Zero quantity.' }); continue; }

      if (quantity > 0) {
        try {
          const res: { duplicate?: boolean; warning?: string | null } = await this.inventory.receiveRawMaterial(tenantId, line.rawMaterialId, {
            branchId:        req.branchId,
            quantity,
            costPrice:       unitCost,
            paymentMethod,
            referenceNumber: line.lineNumber,
            note:            [opts.note, line.brandNote].filter(Boolean).join(' · ') || undefined,
            receivedAt:      receivedDay,
            ...(opts.acceptCostChangeAll || opts.acceptCostChangeFor?.has(line.rawMaterialId) ? { acceptCostChange: true } : {}),
          } as never);
          if (res.duplicate) {
            skipped.push({ line: line.lineNumber, name, reason: 'This line was already received.' });
          } else {
            posted.push({ line: line.lineNumber, name, quantity, unitCost, warning: res.warning ?? null });
          }
        } catch (err) {
          failed.push({
            line: line.lineNumber, name,
            reason: err instanceof Error ? err.message : 'Could not post this line.',
          });
          continue;
        }
      }

      // The line now says what is on the shelf. What was paid for and did
      // not come is written down below, never lost.
      const data: Prisma.PurchaseRequestLineUpdateInput = { receivedAt: new Date() };
      if (arrived < bought) {
        data.packsBought = new Prisma.Decimal(arrived);
        short.push({
          line: line.lineNumber, name, rawMaterialId: line.rawMaterialId,
          packsBought: bought, packsArrived: arrived, packSize: size, packCost: cost, brandNote: line.brandNote,
          outcome: outcomeOf.get(line.id) ?? 'STILL_COMING',
        });
      }
      await this.prisma.purchaseRequestLine.update({ where: { id: line.id }, data });
      done.add(line.id);
    }

    // ── what was short ─────────────────────────────────────────────────────
    const stillComing = short.filter((x) => x.outcome === 'STILL_COMING');
    const followUp = stillComing.length > 0 ? await this.createFollowUp(tenantId, req, userId, stillComing) : null;
    let notes = req.notes;
    const lost: Array<{ description: string; amount: number; category: ExpenseCategory }> = [];
    for (const x of short) {
      const missing = +(x.packsBought - x.packsArrived).toFixed(4);
      const word: Record<ShortOutcome, string> = {
        STILL_COMING: followUp ? `still coming (${followUp.requestNumber})` : 'still coming',
        REFUNDED:     'refunded',
        LOST:         'lost, expensed',
        NOT_COMING:   'not coming',
      };
      notes = appendNote(notes, `${x.name}: bought ${x.packsBought}, ${x.packsArrived} arrived, ${missing} ${word[x.outcome]}`);
      if (x.outcome === 'LOST') {
        lost.push({
          description: `${x.name} — ${missing} pack${missing === 1 ? '' : 's'} paid for and lost`,
          amount:      +(missing * x.packCost).toFixed(2),
          category:    'OTHER',
        });
      }
    }
    if (opts.note) notes = appendNote(notes, opts.note);

    // ── charges: with the goods, once ──────────────────────────────────────
    let charges: PostedExpense[] = [];
    const side = [...(opts.charges ?? []), ...lost];
    if (side.length > 0) {
      if (posted.length > 0 || lost.length > 0) {
        charges = await this.postExpenses(tenantId, userId, receivedDay, req.requestNumber, paymentMethod, side);
      } else {
        // Nothing reached the shelf in this call, so nothing rides along
        // with it: a charge posted twice is worse than one posted late.
        charges = side.map((c) => ({ description: c.description, amount: c.amount, error: 'Not recorded: nothing was posted in this call. Add it with the lines you post.' }));
      }
    }

    // ── closing, and what goes back on the list ────────────────────────────
    const remaining  = req.lines.filter((l) => !l.receivedAt && !done.has(l.id));
    const filledLeft = remaining.filter((l) => l.packsBought != null && !failed.some((f) => f.line === l.lineNumber));
    const closing = failed.length === 0 && req.status === 'BOUGHT' && (opts.closeRest === true || filledLeft.length === 0);
    const carried = closing ? await this.carryForward(tenantId, req, remaining, userId) : [];

    const updated = await this.prisma.purchaseRequest.update({
      where: { id: requestId },
      data:  {
        ...(closing ? { status: 'RECEIVED' as const, receivedAt: new Date(), receivedById: userId } : {}),
        ...(notes !== req.notes ? { notes } : {}),
      },
      include: this.lineInclude(),
    });
    return {
      request: updated, posted, skipped, failed, carried, charges,
      short: short.map(({ line, name, packsBought, packsArrived, outcome }) => ({ line, name, packsBought, packsArrived, outcome })),
      followUp: followUp ? { id: followUp.id, requestNumber: followUp.requestNumber, lines: followUp.lines.length } : null,
    };
  }

  /**
   * Lines nobody bought, back onto the branch's open list with their own
   * control numbers. They still have to be bought; dropping them was the
   * thing the screen promised not to do.
   */
  private async carryForward(
    tenantId: string,
    req: { branchId: string; requestNumber: string },
    lines: Array<{ lineNumber: string; rawMaterialId: string; qtyRequested: Prisma.Decimal; shortBy: Prisma.Decimal | null; rawMaterial: { name: string } }>,
    userId: string,
  ) {
    const carried: Array<{ line: string; name: string; qtyRequested: number; to: string; alreadyThere: boolean }> = [];
    if (lines.length === 0) return carried;
    const open = await this.openRequestRaw(tenantId, req.branchId, userId);
    const onOpen = new Set(open.lines.map((l) => l.rawMaterialId));
    const numbered: Array<{ lineNumber: string }> = open.lines.map((l) => ({ lineNumber: l.lineNumber }));
    for (const l of lines) {
      const name = l.rawMaterial.name;
      const base = { line: l.lineNumber, name, qtyRequested: Number(l.qtyRequested), to: open.requestNumber };
      // Already asked for again, with a number somebody chose: theirs stands.
      if (onOpen.has(l.rawMaterialId)) { carried.push({ ...base, alreadyThere: true }); continue; }
      const lineNumber = this.nextLineNumber(open.requestNumber, numbered);
      try {
        await this.prisma.purchaseRequestLine.create({
          data: { purchaseRequestId: open.id, lineNumber, rawMaterialId: l.rawMaterialId, qtyRequested: l.qtyRequested, shortBy: l.shortBy },
        });
      } catch (err) {
        // Somebody put the same ingredient on the open list a moment ago.
        // It is there, which is all that was wanted.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          carried.push({ ...base, alreadyThere: true });
          continue;
        }
        throw err;
      }
      numbered.push({ lineNumber });
      onOpen.add(l.rawMaterialId);
      carried.push({ ...base, alreadyThere: false });
    }
    return carried;
  }

  /**
   * The packs still to come, as their own request -- already bought, already
   * "on the way", never on the open shopping list where Check stock would
   * buy them a second time.
   */
  private async createFollowUp(
    tenantId: string,
    req: { branchId: string; requestNumber: string },
    userId: string,
    short: Array<{ rawMaterialId: string; packsBought: number; packsArrived: number; packSize: number; packCost: number; brandNote: string | null }>,
  ) {
    const requestNumber = await this.nextNumber(tenantId);
    const numbered: Array<{ lineNumber: string }> = [];
    const now = new Date();
    const notes = appendNote(
      withTag(withTag(null, 'BALANCEOF', req.requestNumber), 'ONTHEWAY', this.today()),
      `Balance of ${req.requestNumber}: still coming`,
    );
    return this.prisma.purchaseRequest.create({
      data: {
        tenantId, branchId: req.branchId, requestNumber,
        status: 'BOUGHT', sentAt: now, boughtAt: now, sentById: userId, createdById: userId, notes,
        lines: {
          create: short.map((x) => {
            const missing = +(x.packsBought - x.packsArrived).toFixed(4);
            const lineNumber = this.nextLineNumber(requestNumber, numbered);
            numbered.push({ lineNumber });
            return {
              lineNumber,
              rawMaterialId: x.rawMaterialId,
              qtyRequested:  new Prisma.Decimal(+(missing * x.packSize).toFixed(4)),
              packsBought:   new Prisma.Decimal(missing),
              packSize:      new Prisma.Decimal(x.packSize),
              packCost:      new Prisma.Decimal(x.packCost),
              brandNote:     x.brandNote,
            };
          }),
        },
      },
      include: this.lineInclude(),
    });
  }

  /**
   * Lines that were never stock: a delivery fee, a platform fee, parking, a
   * pack paid for and lost. Simple entries from the same pocket, on the same
   * day.
   *
   * Owner-funded is two honest entries, not one clever one: the owner put
   * the money in (Dr cash, Cr owner's capital), then the business spent it
   * (Dr expense, Cr cash). Same end state as a direct Dr expense / Cr
   * capital, and both halves are entries the simple ledger already knows how
   * to reverse. The expense goes first, so a failure there leaves nothing
   * behind; the contribution second, so a failure THERE leaves a real
   * expense on the books and a message saying which half is missing --
   * never an orphan contribution with no spend against it.
   */
  async postExpenses(
    tenantId: string,
    userId: string,
    date: string,
    label: string,
    pocket: ProcurePocket,
    expenses: Array<{ description: string; amount: number; category?: ExpenseCategory }>,
  ): Promise<PostedExpense[]> {
    if (expenses.length === 0) return [];
    if (!this.simple) throw new BadRequestException('Expenses cannot be posted on this deployment.');
    const out: PostedExpense[] = [];
    for (const e of expenses) {
      try {
        const note = `${label ? label + ': ' : ''}${e.description}`.slice(0, 200);
        const je = await this.simple.create(tenantId, userId, {
          type: 'EXPENSE', amount: e.amount, date,
          source: pocket === 'BANK' ? 'BANK' : 'CASH',
          category: e.category ?? 'OTHER', note,
        });
        let contributionNote: string | undefined;
        if (pocket === 'OWNER_FUNDED') {
          try {
            await this.simple.create(tenantId, userId, {
              type: 'OWNER_CONTRIBUTION', amount: e.amount, date, source: 'CASH',
              note: `Owner paid: ${note}`.slice(0, 200),
            });
          } catch (err) {
            contributionNote = `Expense posted, but the owner contribution did not: ${
              err instanceof Error ? err.message : 'unknown error'}. Record it under Ledger > Record Entry.`;
          }
        }
        // status is PENDING_APPROVAL when the shop has a journal threshold:
        // the entry exists but is not in the books until someone approves it.
        out.push({ description: e.description, amount: e.amount, entryNumber: je.entryNumber, status: je.status,
                   ...(contributionNote ? { error: contributionNote } : {}) });
      } catch (err) {
        out.push({
          description: e.description, amount: e.amount,
          error: err instanceof Error ? err.message : 'Could not post this expense.',
        });
      }
    }
    return out;
  }

  // ── the paper ─────────────────────────────────────────────────────────────

  /**
   * A photo of the receipt, the order screen or the delivery slip, filed
   * against the request by whoever is holding it. Filing is not reading:
   * nothing is parsed and nothing posts. It is the evidence, kept with the
   * request the moment it exists, instead of on a phone until tonight.
   */
  async attachPhoto(
    tenantId: string,
    requestId: string,
    userId: string,
    dto: { imageBase64: string; mediaType?: string; label?: PhotoLabel },
  ) {
    if (!this.documents) throw new BadRequestException('Photos cannot be filed on this deployment.');
    const req = await this.getRaw(tenantId, requestId);
    if (req.status === 'CANCELLED') throw new BadRequestException('This request was cancelled.');
    const buffer = Buffer.from(dto.imageBase64, 'base64');
    if (buffer.length === 0) throw new BadRequestException('The photo is empty.');
    if (buffer.length > 8_000_000) throw new BadRequestException('That photo is too large. Take it again at a lower resolution.');
    const mime  = dto.mediaType ?? 'image/jpeg';
    const ext   = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const label = dto.label ?? 'Receipt';
    const n = await this.prisma.document.count({ where: { tenantId, entityType: 'PurchaseRequest', entityId: req.id } }) + 1;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const doc = await this.documents.uploadBuffer(
      tenantId, 'PurchaseRequest', req.id, buffer, mime,
      `${slug}-${req.requestNumber}-${n}.${ext}`, label, userId,
    );
    return { id: doc.id, filename: doc.filename, label };
  }

  async cancel(tenantId: string, requestId: string) {
    const req = await this.getRaw(tenantId, requestId);
    if (req.status === 'RECEIVED') {
      throw new BadRequestException('This request is already in stock and cannot be cancelled.');
    }
    /*
      A request can be PARTLY received -- some lines post, one fails on a closed
      period -- and its status stays BOUGHT rather than RECEIVED so the failures
      stay visible. Cancelling then hid lines whose stock was already on the
      shelf and whose journal entries were already posted, leaving a CANCELLED
      request that had genuinely moved inventory.
    */
    const received = req.lines.filter((l) => l.receivedAt != null);
    if (received.length > 0) {
      throw new BadRequestException(
        `${received.length} line${received.length === 1 ? ' is' : 's are'} already in stock `
        + `(${received.map((l) => l.rawMaterial?.name ?? l.lineNumber).join(', ')}), so this `
        + 'request cannot be cancelled. Post the rest, or write off what was received.',
      );
    }
    return this.prisma.purchaseRequest.update({
      where: { id: requestId }, data: { status: 'CANCELLED' }, include: this.lineInclude(),
    });
  }

  // ── what is capping the menu ───────────────────────────────────────────────

  /**
   * Which ingredients are limiting how many things the shop can sell.
   *
   * The POS tile says "16 left" and that number is real, but it is the wrong
   * end of the telescope for anyone who can act on it. The cashier sees a
   * consequence; whoever buys stock needs the cause. This inverts it: instead
   * of a product and its ceiling, an ingredient and everything it is holding
   * back.
   *
   * "Fresh Milk — 16 servings, capping 14 drinks" is a buy decision. "16 left"
   * on a latte tile is a reason to shout across the room.
   *
   * Deliberately its own query rather than reusing the POS product payload,
   * which drags in price lists, modifier groups and variants to answer a
   * question about stock.
   */
  async menuCeiling(tenantId: string, branchId: string) {
    const products = await this.prisma.product.findMany({
      where: { tenantId, isActive: true, inventoryMode: 'RECIPE_BASED' },
      select: {
        id: true, name: true,
        bomItems: {
          select: {
            rawMaterialId: true,
            quantity: true,
            rawMaterial: { select: { id: true, name: true, unit: true, lowStockAlert: true } },
          },
        },
      },
    });

    const rawMaterialIds = [...new Set(products.flatMap((p) => p.bomItems.map((b) => b.rawMaterialId)))];
    if (rawMaterialIds.length === 0) return { branchId, ingredients: [], productsChecked: 0 };

    const stockRows = await this.prisma.rawMaterialInventory.findMany({
      where:  { branchId, rawMaterialId: { in: rawMaterialIds } },
      select: { rawMaterialId: true, quantity: true },
    });
    const stockOf = new Map(stockRows.map((r) => [r.rawMaterialId, Number(r.quantity)]));

    // ingredientId -> what it is holding back
    const capping = new Map<string, {
      rawMaterialId: string; name: string; unit: string;
      stock: number; servingsLeft: number;
      products: Array<{ id: string; name: string; canMake: number }>;
    }>();

    for (const p of products) {
      if (p.bomItems.length === 0) continue;

      let min = Number.POSITIVE_INFINITY;
      let limiter: (typeof p.bomItems)[number] | null = null;
      for (const bom of p.bomItems) {
        const perUnit = Number(bom.quantity);
        if (perUnit <= 0) continue;
        const producible = Math.floor((stockOf.get(bom.rawMaterialId) ?? 0) / perUnit);
        if (producible < min) { min = producible; limiter = bom; }
      }
      if (!limiter || min === Number.POSITIVE_INFINITY) continue;

      const key = limiter.rawMaterialId;
      const entry = capping.get(key) ?? {
        rawMaterialId: key,
        name: limiter.rawMaterial?.name ?? 'Unknown ingredient',
        unit: limiter.rawMaterial?.unit ?? '',
        stock: stockOf.get(key) ?? 0,
        servingsLeft: min,
        products: [],
      };
      // The tightest product is the one that runs out first, so it sets the
      // number a person should act on.
      entry.servingsLeft = Math.min(entry.servingsLeft, min);
      entry.products.push({ id: p.id, name: p.name, canMake: min });
      capping.set(key, entry);
    }

    const ingredients = [...capping.values()]
      .map((i) => ({ ...i, productCount: i.products.length,
                     products: i.products.sort((a, b) => a.canMake - b.canMake) }))
      // Most urgent first: fewest servings, then whatever blocks the most menu.
      .sort((a, b) => a.servingsLeft - b.servingsLeft || b.productCount - a.productCount);

    return { branchId, productsChecked: products.length, ingredients };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * The next line control number on a request.
   *
   * Derived from the highest suffix used, not from how many lines there are.
   * Removing line 02 of three left a count of 2, so the next add produced
   * -03 again -- a duplicate control number, and that number is the
   * idempotency key the receive relies on to know a line has been posted.
   * Never below the line count either: a row whose number cannot be parsed
   * must not let the next one collide with an existing suffix.
   */
  nextLineNumber(requestNumber: string, lines: Array<{ lineNumber: string }>): string {
    const highest = lines.reduce((max, l) => {
      const n = parseInt(String(l.lineNumber ?? '').slice(-2), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `${requestNumber}-${String(Math.max(lines.length, highest) + 1).padStart(2, '0')}`;
  }

  /**
   * What each ingredient cost last time, and what one pack held.
   *
   * RawMaterial stores no pack size, so "Emborg 1 L" was typed as 1000 on
   * every single request. The newest received line of the same ingredient
   * already knows -- one query, no new column -- and the screen shows where
   * the number came from so a one-off 5 kg sack is visible before it
   * becomes next time's default.
   */
  private async lastPacks(tenantId: string, ids?: string[]): Promise<Map<string, LastPack>> {
    if (ids && ids.length === 0) return new Map();
    const rows = await this.prisma.purchaseRequestLine.findMany({
      where: {
        ...(ids ? { rawMaterialId: { in: ids } } : {}),
        receivedAt: { not: null },
        packSize:  { gt: 0 },
        packCost:  { gt: 0 },
        packsBought: { gt: 0 },
        purchaseRequest: { tenantId },
      },
      orderBy:  { receivedAt: 'desc' },
      distinct: ['rawMaterialId'],
      select:   { rawMaterialId: true, packSize: true, packCost: true, brandNote: true, receivedAt: true },
    });
    return new Map<string, LastPack>(rows.map((r) => [r.rawMaterialId, {
      packSize:   Number(r.packSize),
      packCost:   Number(r.packCost),
      brandNote:  r.brandNote,
      receivedAt: r.receivedAt,
    }]));
  }

  /**
   * The pack memory for every ingredient at once. The picker needs it
   * BEFORE a line exists, so "2 bottles" can be typed as 2 bottles.
   */
  async packMemory(tenantId: string, viewerRole?: string | null) {
    const seeCosts = await this.costsVisibleTo(tenantId, viewerRole);
    return [...(await this.lastPacks(tenantId)).entries()].map(([rawMaterialId, p]) => ({
      rawMaterialId,
      packSize:   p.packSize,
      packCost:   seeCosts ? p.packCost : null,
      brandNote:  p.brandNote,
      receivedAt: p.receivedAt,
    }));
  }

  /** The tag on a cycle count that was started from a buy list, one line at a time. */
  private countTag(requestNumber: string) { return `[REQ:${requestNumber}]`; }

  /**
   * Every line, with what the shop knows around it: what the ingredient held
   * and cost last time, what Clerque says is on the shelf at this branch,
   * and what somebody counted while building the list.
   */
  private async enrich<
    L extends { rawMaterialId: string },
    T extends { branchId: string; requestNumber: string; lines: L[] },
  >(
    tenantId: string,
    reqs: T[],
  ): Promise<Array<Omit<T, 'lines'> & { lines: Array<L & { lastPack: LastPack | null; onHand: number; counted: CountedLine | null }> }>> {
    const ids = [...new Set(reqs.flatMap((r) => r.lines.map((l) => l.rawMaterialId)))];
    const last = await this.lastPacks(tenantId, ids);

    const branches = [...new Set(reqs.map((r) => r.branchId))];
    const stock = ids.length === 0 ? [] : await this.prisma.rawMaterialInventory.findMany({
      where:  { tenantId, branchId: { in: branches }, rawMaterialId: { in: ids } },
      select: { branchId: true, rawMaterialId: true, quantity: true },
    });
    const onHand = new Map(stock.map((x) => [`${x.branchId}:${x.rawMaterialId}`, Number(x.quantity)]));

    // Counts typed while these lists were being built, still waiting to be posted.
    const counts = reqs.length === 0 ? [] : await this.prisma.cycleCount.findMany({
      where:  { tenantId, status: 'OPEN', branchId: { in: branches }, notes: { startsWith: '[REQ:' } },
      select: { id: true, countNumber: true, notes: true },
    });
    const countOf = new Map<string, { id: string; countNumber: string }>();
    for (const r of reqs) {
      const c = counts.find((x) => (x.notes ?? '').startsWith(this.countTag(r.requestNumber)));
      if (c) countOf.set(r.requestNumber, c);
    }
    const countLines = countOf.size === 0 ? [] : await this.prisma.cycleCountLine.findMany({
      where:  { countId: { in: [...countOf.values()].map((c) => c.id) }, rawMaterialId: { in: ids } },
      select: { countId: true, rawMaterialId: true, countedQty: true, expectedQty: true },
    });
    const counted = new Map(countLines.map((x) => [`${x.countId}:${x.rawMaterialId}`, x]));

    return reqs.map((r) => {
      const c = countOf.get(r.requestNumber);
      return {
        ...r,
        lines: r.lines.map((l) => {
          const cl = c ? counted.get(`${c.id}:${l.rawMaterialId}`) : undefined;
          return {
            ...l,
            lastPack: last.get(l.rawMaterialId) ?? null,
            onHand:   onHand.get(`${r.branchId}:${l.rawMaterialId}`) ?? 0,
            counted:  cl && c ? { qty: Number(cl.countedQty), expected: Number(cl.expectedQty), countId: c.id, countNumber: c.countNumber } : null,
          };
        }),
      };
    });
  }

  // ── what is left on the shelf ─────────────────────────────────────────────

  /**
   * "Remaining: 1 bottle" -- the count that has always ridden on the
   * message to the owner, made real.
   *
   * It becomes a line on an ordinary cycle count for the branch, one count
   * per buy list, started the moment the first line is counted. Expected is
   * what Clerque had on the shelf right then; counted is what the person
   * saw. Nothing moves until the owner or manager posts the count from the
   * counts screen, and then the existing rules apply: the variance is
   * measured against that snapshot and applied to the live figure, so a
   * delivery in between is not undone.
   */
  async recordCount(tenantId: string, requestId: string, lineId: string, userId: string, countedQty: number) {
    if (!this.warehouse) throw new BadRequestException('Counting is not available on this deployment.');
    const req = await this.getRaw(tenantId, requestId);
    if (req.status !== 'OPEN' && req.status !== 'SENT') {
      throw new BadRequestException('Counting goes with building the list. This one has already been bought.');
    }
    const line = req.lines.find((l) => l.id === lineId);
    if (!line) throw new BadRequestException('That line is not on this request.');
    if (!(countedQty >= 0)) throw new BadRequestException('How much is left? Zero is an answer; a negative is not.');

    const tag = this.countTag(req.requestNumber);
    let count = await this.prisma.cycleCount.findFirst({
      where:  { tenantId, branchId: req.branchId, status: 'OPEN', notes: { startsWith: tag } },
      select: { id: true, countNumber: true },
    });
    if (!count) {
      count = await this.prisma.cycleCount.create({
        data: {
          tenantId, branchId: req.branchId,
          countNumber: await this.warehouse.nextCountNumber(this.prisma, tenantId),
          status: 'OPEN', startedById: userId,
          notes: `${tag} Counted while building the buy list`,
        },
        select: { id: true, countNumber: true },
      });
    }

    const existing = await this.prisma.cycleCountLine.findFirst({
      where:  { countId: count.id, rawMaterialId: line.rawMaterialId },
      select: { id: true, expectedQty: true },
    });
    let expected: number;
    if (existing) {
      // The snapshot stays; only the count changed.
      expected = Number(existing.expectedQty);
      await this.prisma.cycleCountLine.update({
        where: { id: existing.id },
        data:  { countedQty: new Prisma.Decimal(countedQty), varianceQty: new Prisma.Decimal(countedQty - expected), notes: line.lineNumber },
      });
    } else {
      const live = await this.prisma.rawMaterialInventory.findUnique({
        where:  { branchId_rawMaterialId: { branchId: req.branchId, rawMaterialId: line.rawMaterialId } },
        select: { quantity: true },
      });
      expected = live ? Number(live.quantity) : 0;
      await this.prisma.cycleCountLine.create({
        data: {
          countId: count.id, rawMaterialId: line.rawMaterialId,
          expectedQty: new Prisma.Decimal(expected), countedQty: new Prisma.Decimal(countedQty),
          varianceQty: new Prisma.Decimal(countedQty - expected), notes: line.lineNumber,
        },
      });
    }
    return {
      countId: count.id, countNumber: count.countNumber,
      line: line.lineNumber, name: line.rawMaterial.name, unit: line.rawMaterial.unit,
      expectedQty: expected, countedQty, variance: +(countedQty - expected).toFixed(4),
    };
  }

  /** YYYY-MM-DD, or a refusal. */
  private dayOf(given: string): string {
    const d = given.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(`${d}T00:00:00Z`).getTime())) {
      throw new BadRequestException('The date has to be a real date (YYYY-MM-DD).');
    }
    return d;
  }

  /** Today in the shop's own timezone. */
  private today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  private manilaMidnight(day: string): Date {
    return new Date(`${day}T00:00:00+08:00`);
  }

  private lineInclude() {
    return {
      lines: {
        include: {
          rawMaterial: { select: { id: true, name: true, unit: true, costPrice: true } },
        },
        orderBy: { lineNumber: 'asc' as const },
      },
      branch: { select: { id: true, name: true } },
    };
  }

  /** The next control number, for a request created outside this service. */
  nextRequestNumber(tenantId: string): Promise<string> {
    return this.nextNumber(tenantId);
  }

  /** REQ-YYYYMMDD-NNN, sequential within the day so it reads as a date. */
  private async nextNumber(tenantId: string): Promise<string> {
    /*
      The shop's date, not UTC. Manila is UTC+8, so toISOString() before 08:00
      local stamps YESTERDAY -- and the morning shift is exactly when someone
      opens the day's buy list. A request numbered for the previous day is
      confusing on its own and wrong when it is used to reconcile a delivery.
    */
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()).replace(/-/g, '');
    const prefix = `REQ-${today}-`;
    const last = await this.prisma.purchaseRequest.findFirst({
      where:   { tenantId, requestNumber: { startsWith: prefix } },
      orderBy: { requestNumber: 'desc' },
      select:  { requestNumber: true },
    });
    const n = last ? (parseInt(last.requestNumber.slice(prefix.length), 10) || 0) + 1 : 1;
    return `${prefix}${String(n).padStart(3, '0')}`;
  }
}
