import { Injectable, BadRequestException, NotFoundException, Optional, Logger } from '@nestjs/common';
import { Prisma, PurchaseRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService, MarginAlert } from '../inventory/inventory.service';
import { SimpleEntriesService } from '../simple-entries/simple-entries.service';
import { ExpenseCategory } from '../simple-entries/dto/simple-entry.dto';
import { DocumentsService } from '../documents/documents.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import {
  PH_TIMEZONE, LineServes, ServesDish, servesSummary,
  cleanSourceName, isSourceKind, sourceKey, sourceText, usuallyFrom, usuallyFromText, type SourceKind, type UsuallyFrom,
} from '@repo/shared-types';
import { productCeiling, servingsOf, LimitedBy } from '../products/recipe-ceiling';
import { canSeePurchaseCosts, COST_DECIDER_ROLES } from './cost-visibility';
import { ProcurePocket, ShortOutcome, PhotoLabel } from './dto/receive-request.dto';
import { appendNote, withTag, readTag, withoutTag, plainNotes } from './procure-notes';
import { buildBuyListModel, renderBuyListPdf } from './purchase-request-pdf';
import { BuyListCopy, BUY_LIST_PDF_LABEL } from './buy-list-labels';
import { sanityValueKey } from '@repo/shared-types';
import { CostSanityService } from '../common/sanity/cost-sanity.service';
import { SanityContext } from '../common/sanity/sanity.types';
import { TelegramAlertsService } from '../telegram/telegram-alerts.service';
import { heldUsage, heldAt, availableQty, type HeldMap } from '../orders/held-usage';

/** Where a price somebody confirmed on the buy list is written down, per line. */
const CONFIRMED_LINE = 'PurchaseRequestLine';

/**
 * Stock left to promise once the tickets waiting at a kitchen or bar screen
 * take their share: the book less what they hold, never below zero.
 *
 * A book already at or below zero is left as it is. A ready tap takes nothing
 * from an empty book, so a hold cannot lower it further -- and a count must
 * still see the shortfall, or posting it could never bring the book back up.
 * With nothing waiting every figure is the book, as before.
 */
function afterHeld(book: number, held: number): number {
  return book > 0 ? availableQty(book, held) : book;
}

/** How long an unclosed list is still believed. See onTheWay. */
const SENT_BELIEVED_DAYS   = 3;
const BOUGHT_BELIEVED_DAYS = 7;

/** One ingredient's worth of what is coming, and the list bringing most of it. */
export interface Coming {
  /** In the ingredient's own unit, summed over every list. */
  quantity: number;
  /** The list with the biggest share, so the screen can say "on REQ-...". */
  requestNumber: string;
  sentAt: Date | null;
}

/**
 * What this branch has already asked for or bought and not yet had in:
 * rawMaterialId -> quantity, in the ingredient's own unit, and the list that
 * brings most of it.
 *
 * Check stock looked at the shelf alone. A list sent at noon is not on the
 * shelf until the shopping comes back, so pressing Check stock again that
 * afternoon found the same sugar short and put it on the next list -- and the
 * shop bought it twice. What is coming is part of what the shop will have.
 *
 * Sent: what was asked for. Bought: the packs actually bought, when the
 * shopper recorded them -- three 1 kg bags against a 2,500 g line is 3,000 g
 * coming -- and what was asked for on a line nobody has recorded yet, which
 * is still wanted and goes back on the open list if the request closes
 * without it. A line already posted is on the shelf and counted there, so a
 * half-posted request does not count its posted lines twice. An open list is
 * not coming (nobody has it yet); a cancelled or closed one never will be.
 *
 * Except on an order waiting for its parcel (tagged ONTHEWAY): a line left
 * blank there was not ordered, so it is still needed, not coming. That order
 * does not close -- and put its blanks back on the list -- until the parcel
 * is posted, days later, after the shop has run out. A grocery trip still
 * being filled in (milk this morning, beans this afternoon) is posted the
 * same day and carries its blanks forward then, so its blanks still count.
 *
 * An unclosed list is not believed forever. Nothing closes one on its own:
 * stock posted from Receipts without the list, or received under Inventory,
 * leaves it SENT, and a line that failed to post leaves it BOUGHT. Counted
 * with no end, it kept the item off every later list until somebody found
 * and cancelled it. So a line stops counting when
 *   - stock of that ingredient has come in at the branch since the list was
 *     bought (or sent, if not bought yet): whatever came in is taken to be
 *     what the list was for. The balance of a short delivery is the
 *     exception: it is made straight after its parent's packs are posted, so
 *     those packs are left out by their line numbers rather than trusted to
 *     a clock.
 *   - a sent list is older than 3 days: nobody bought it, and nothing
 *     replaced it.
 *   - a bought list is older than 7 days, unless it is an order still
 *     waiting for its parcel.
 * Asking again for something that was in fact coming is a line somebody can
 * see and remove; a shortage hidden by a forgotten list is seen by nobody.
 */
export async function onTheWay(
  db: Pick<Prisma.TransactionClient, 'purchaseRequestLine' | 'rawMaterialLot'>,
  tenantId: string,
  branchId: string,
  /** A request to leave out, when the caller is deciding about that one itself. */
  excludeRequestId?: string,
): Promise<Map<string, Coming>> {
  const now = Date.now();
  const sentFrom   = new Date(now - SENT_BELIEVED_DAYS * 86_400_000);
  const boughtFrom = new Date(now - BOUGHT_BELIEVED_DAYS * 86_400_000);
  const lines = await db.purchaseRequestLine.findMany({
    where: {
      receivedAt: null,
      purchaseRequest: {
        tenantId,
        branchId,
        // Old lists pile up exactly when nobody closes them, so they are left
        // in the table rather than read and thrown away. The tag is read
        // exactly below; this only narrows the read.
        OR: [
          { status: 'SENT',   sentAt:   { gte: sentFrom } },
          { status: 'BOUGHT', boughtAt: { gte: boughtFrom } },
          { status: 'BOUGHT', notes:    { contains: '[ONTHEWAY:' } },
        ],
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
    },
    select: {
      rawMaterialId: true, qtyRequested: true, packsBought: true, packSize: true,
      purchaseRequest: { select: { status: true, requestNumber: true, notes: true, sentAt: true, boughtAt: true } },
    },
  });

  const believed: Array<{
    rawMaterialId: string; qty: number; since: Date; balanceOf: string | null;
    requestNumber: string; sentAt: Date | null;
  }> = [];
  for (const l of lines) {
    const pr       = l.purchaseRequest;
    const bought   = pr.status === 'BOUGHT';
    const waiting  = bought && readTag(pr.notes, 'ONTHEWAY') != null;
    const recorded = bought && l.packsBought != null && l.packSize != null;
    const dated    = bought ? pr.boughtAt : pr.sentAt;
    if (!waiting && !(dated && dated >= (bought ? boughtFrom : sentFrom))) continue;
    if (waiting && !recorded) continue;
    const since = pr.boughtAt ?? pr.sentAt;
    // Every path that sends or buys a list dates it. One without a date
    // cannot be checked against what came in since, so it is not believed.
    if (!since) continue;
    const qty = recorded ? Number(l.packsBought) * Number(l.packSize) : Number(l.qtyRequested);
    if (!(qty > 0)) continue;
    believed.push({
      rawMaterialId: l.rawMaterialId, qty, since, balanceOf: readTag(pr.notes, 'BALANCEOF'),
      requestNumber: pr.requestNumber, sentAt: pr.sentAt,
    });
  }
  const coming = new Map<string, Coming>();
  if (believed.length === 0) return coming;

  /*
    Stock that came in since: one read for every ingredient involved.
    createdAt, not receivedAt -- receivedAt is the business date somebody
    typed, and can be set back to before the list went out. A write-off is a
    lot too, with a negative quantity; that is stock leaving, not arriving.
  */
  const earliest = new Date(Math.min(...believed.map((b) => b.since.getTime())));
  const lots = await db.rawMaterialLot.findMany({
    where: {
      tenantId,
      branchId,
      rawMaterialId: { in: [...new Set(believed.map((b) => b.rawMaterialId))] },
      qtyReceived:   { gt: 0 },
      createdAt:     { gt: earliest },
    },
    select: { rawMaterialId: true, createdAt: true, referenceNumber: true },
  });

  const biggest = new Map<string, number>();
  for (const b of believed) {
    const cameIn = lots.some((lot) => lot.rawMaterialId === b.rawMaterialId && lot.createdAt > b.since
      // The parent's own packs, posted a moment before this balance was made.
      && !(b.balanceOf && (lot.referenceNumber ?? '').startsWith(`${b.balanceOf}-`)));
    if (cameIn) continue;
    const had = coming.get(b.rawMaterialId);
    const leads = !had || b.qty > (biggest.get(b.rawMaterialId) ?? 0);
    if (leads) biggest.set(b.rawMaterialId, b.qty);
    coming.set(b.rawMaterialId, {
      // Rounded to the column's four places, so sums of decimals compare cleanly.
      quantity:      Math.round(((had?.quantity ?? 0) + b.qty) * 10_000) / 10_000,
      requestNumber: leads ? b.requestNumber : had.requestNumber,
      sentAt:        leads ? b.sentAt : had.sentAt,
    });
  }
  return coming;
}

/** What each pocket is called in a sentence a shop owner reads. */
const POCKET_WORDS: Record<ProcurePocket, string> = {
  CASH:         'the till',
  OWNER_FUNDED: "the owner's own money",
  BANK:         'the shop bank or GCash',
};

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
  /** Where it was bought. Undefined leaves the line's store as it is; null clears it. */
  sourceKind?: SourceKind | null;
  sourceName?: string | null;
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
  sourceKind: string | null;
  sourceName: string | null;
}

/** How far back "usually from" looks, and how many purchases of one item it weighs at most. */
const USUALLY_DAYS = 90;
const USUALLY_BUYS = 10;
/** The where-bought report reads at most this many purchase lines; past that it says so. */
const WHERE_BOUGHT_MAX_LINES = 20_000;
/** A request that holds the balance of another's short delivery. */
const isBalance = (notes: string | null | undefined) => !!readTag(notes, 'BALANCEOF');

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
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly sanity?: CostSanityService,
    @Optional() private readonly telegramAlerts?: TelegramAlertsService,
  ) {}

  private readonly logger = new Logger(ProcureService.name);

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
  private stripCosts<T extends { lines?: Array<Record<string, unknown>>; notes?: string | null }>(req: T): T {
    return {
      ...req,
      costsHidden: true,
      /*
        [ADV:] is the peso total of the order, sitting in a field the screen
        prints as a person's note. The banner already hides the figure from
        staff; the JSON did not -- the same one-network-tab-away leak the
        line costs below are stripped for.
      */
      ...(typeof req.notes === 'string' ? { notes: withoutTag(req.notes, 'ADV') } : {}),
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

    return this.withNumber(
      (requestNumber) => this.prisma.purchaseRequest.create({
        data:    { tenantId, branchId, requestNumber, createdById: userId },
        include: this.lineInclude(),
      }),
      () => this.nextNumber(tenantId),
    );
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
      where:  { id: dto.rawMaterialId, tenantId },
      select: { id: true, name: true, subRecipeItems: { select: { id: true }, take: 1 } },
    });
    if (!rm) throw new BadRequestException('Ingredient not found in your list.');

    const existing = req.lines.find((l) => l.rawMaterialId === dto.rawMaterialId);
    if (existing) {
      // A line already there -- even a prep added before preps were refused -- can still be corrected or removed.
      return this.prisma.purchaseRequestLine.update({
        where: { id: existing.id },
        data:  { qtyRequested: new Prisma.Decimal(dto.qtyRequested) },
      });
    }
    // Check stock already keeps preps off the list; a hand-added one would send someone to buy a sauce.
    if ((rm.subRecipeItems ?? []).length > 0) {
      throw new BadRequestException(`${rm.name} is made in the kitchen, not bought. Record it on the prep board.`);
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

    /*
      What this branch already has coming: lists sent to the owners and
      shopping bought but not yet posted. Without it, Check stock pressed
      again before the delivery arrived asked for the same things a second
      time. Read once, and only when something is low.
    */
    const coming = ingredients.length > 0 ? await onTheWay(this.prisma, tenantId, branchId) : new Map<string, Coming>();
    const alreadyComing: Array<{
      id: string; name: string; unit: string; quantity: number; shortBy: number; coming: number;
      requestNumber: string; sentAt: Date | null;
    }> = [];

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
      const wanted = shortBy > 0 ? shortBy * 2 : (level > 0 ? level : 1);
      /*
        What is on the way counts as stock the shop will have.

        Covered means what is coming is at least what the rule above wants:
        nothing is added, and it is reported so the screen can say why. Short
        of that, the list asks for what the rule wants less what is already
        coming. One target for both, so the shelf ends up where the rule meant
        it to either way. The cut-off used to be "just above the reorder
        level": one gram more coming then meant thousands fewer asked for, and
        a delivery that left the shelf a gram over the line, back on the list
        after the first sale.

        Exactly on the line the rule wants the reorder level itself, so that
        much coming covers it. The request is rounded to the column's four
        places, so a shortfall and a delivery equal on paper compare equal.
      */
      const onWay = coming.get(rawMaterialId);
      const onWayQty = onWay?.quantity ?? 0;
      const qtyRequested = onWayQty > 0 ? Math.round((wanted - onWayQty) * 10_000) / 10_000 : wanted;
      if (onWay && onWayQty > 0 && !(qtyRequested > 0)) {
        alreadyComing.push({
          id:       rawMaterialId,
          name:     String(row['name'] ?? ''),
          unit:     String(row['unit'] ?? ''),
          quantity: Number(row['quantity'] ?? 0),
          shortBy,
          coming:   onWayQty,
          // The list bringing most of it, so the screen can say "on REQ-..."
          // and somebody can cancel it if it was forgotten.
          requestNumber: onWay.requestNumber,
          sentAt:        onWay.sentAt,
        });
        continue;
      }
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
      /*
        Low on the shelf but already coming -- on a list the owners have, or
        bought and not yet posted -- so nothing was added for them. Reported
        so "nothing added" can be told apart from "nothing is low", with the
        list that brings most of each so the screen can name it.
      */
      onTheWay: alreadyComing,
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
    // The copy for the group chat, filed now: on-hand is live and cannot be
    // drawn again later as it was at the moment the list went out.
    const pdf = await this.fileRequestPdf(tenantId, requestId, 'sent', userId);
    await this.tellTheOwners(tenantId, updated, pdf, userId);
    return { ...updated, empty: updated.lines.length === 0 };
  }

  /**
   * "Send to the owners" used to send nothing: the list sat in the app until
   * somebody opened it. Now the owners and this branch's manager get a
   * notification and, where mail is configured, the list itself -- in packs
   * where Clerque knows the pack, which is how the shop has always written
   * it by hand. Best effort: a mail outage never blocks the send.
   */
  private async tellTheOwners(
    tenantId: string,
    req: { id: string; requestNumber: string; branchId: string; branch?: { name: string } | null;
           lines: Array<{ rawMaterialId: string; qtyRequested: Prisma.Decimal; rawMaterial: { name: string; unit: string } }> },
    pdf: Buffer | null = null,
    sentById: string | null = null,
  ) {
    try {
      const people = await this.prisma.user.findMany({
        where: {
          tenantId, isActive: true,
          OR: [
            { role: 'BUSINESS_OWNER' },
            { role: 'BRANCH_MANAGER', OR: [{ branchId: req.branchId }, { branchId: null }] },
          ],
        },
        select: { id: true, email: true, name: true },
      });
      if (people.length === 0) return;

      const packs = await this.lastPacks(tenantId, req.lines.map((l) => l.rawMaterialId));
      // What each item still serves, in the same words as the list and the PDF.
      const servesOf = await this.servesByItem(tenantId, [req.branchId], req.lines.map((l) => l.rawMaterialId));
      const lines = req.lines.map((l) => {
        const qty  = Number(l.qtyRequested);
        const pack = packs.get(l.rawMaterialId);
        const n    = pack ? Math.round((qty / pack.packSize) * 100) / 100 : null;
        const whole = n != null && Math.abs(n * pack!.packSize - qty) < 1e-6 && n > 0;
        return {
          name:   l.rawMaterial.name,
          amount: whole
            ? `${n} pack${n === 1 ? '' : 's'} (${qty.toLocaleString()} ${l.rawMaterial.unit})`
            : `${qty.toLocaleString()} ${l.rawMaterial.unit}`,
          serves: servesOf ? servesSummary(servesOf(req.branchId, l.rawMaterialId, null)) : null,
        };
      });
      // Telegram too, in the same words as the email. Not awaited.
      void this.telegramAlerts?.buyListSent(tenantId, req.id, lines, sentById);
      const branch = req.branch?.name ?? null;
      const link   = `/procure/requests?view=${req.requestNumber}`;
      const body   = lines.length === 0
        ? 'Nothing hit its reorder level — an all-clear.'
        : lines.slice(0, 6).map((l) => `${l.name} ${l.amount}`).join(' · ') + (lines.length > 6 ? ` · and ${lines.length - 6} more` : '');

      for (const p of people) {
        if (this.notifications) {
          await this.notifications.create({
            tenantId, userId: p.id, kind: 'INFO',
            title: `Buy list ${req.requestNumber} sent${branch ? ` — ${branch}` : ''}`,
            body, link,
            dedupeKey: `req-sent-${req.requestNumber}-${p.id}`,
          });
        }
        if (this.mail && p.email) {
          await this.mail.sendBuyListSent({ to: p.email, name: p.name, requestNumber: req.requestNumber, branchName: branch, lines, link, pdf });
        }
      }
    } catch (err) {
      // The list IS sent; telling people about it is the part that may fail.
      this.logger.warn(`[procure] could not notify the owners of ${req.requestNumber}: ${err instanceof Error ? err.message : err}`);
    }
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
    extra: {
      note?: string; boughtAt?: string; onTheWay?: boolean;
      paidFrom?: ProcurePocket;
      charges?: Array<{ description: string; amount: number; category?: ExpenseCategory }>;
      sanity?: SanityContext;
      /** A purchase typed into the buy-lists sheet and uploaded in bulk: no alert per request. */
      quiet?: boolean;
    } = {},
  ) {
    const req = await this.getRaw(tenantId, requestId);
    if (req.status !== 'SENT' && req.status !== 'BOUGHT') {
      throw new BadRequestException(
        `A request has to be sent before it can be bought against (this one is ${req.status.toLowerCase()}).`,
      );
    }
    const prepaid = readTag(req.notes, 'PREPAID') as ProcurePocket | null;
    if (extra.paidFrom && prepaid && extra.paidFrom !== prepaid) {
      throw new BadRequestException(
        `This order was already paid from ${POCKET_WORDS[prepaid]}. `
        + 'Post it, or correct that entry under Ledger, before paying it from somewhere else.',
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
      /*
        Recording is not spending. Whoever is holding the bag writes down
        packs and prices; saying the money already left, and from which
        pocket, posts to the ledger -- so it stays with the people who are
        allowed to post. The screen has always hidden these boxes from
        staff; the server never checked.
      */
      if (extra.paidFrom || (extra.charges?.length ?? 0) > 0) {
        throw new BadRequestException(
          'Only the owner or manager can say the order was paid, or add a delivery fee.',
        );
      }
      if (readTag(req.notes, 'PREPAID')) {
        throw new BadRequestException(
          'This order was already paid for, so only the owner or manager can change it.',
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

    /*
      "Are you sure this is the correct cost?" -- here, where the price per pack
      is typed, and before anything is written. This is the moment it can
      still be fixed: by the time the goods are posted the number has been
      sitting on the request for days and blends into the ingredient's average
      cost the instant it lands. What the person confirms is written down
      against the line, so posting it later does not ask the same question
      again.
    */
    let confirmedCosts: Awaited<ReturnType<CostSanityService['checkIngredientCosts']>> = [];
    if (this.sanity && extra.sanity?.optedIn) {
      // Only prices that are new or changed. Saving the list again, or posting
      // a correction to one line, must not ask again about a line nobody touched.
      const changed = lines.filter((l) => {
        const owned = req.lines.find((x) => x.id === l.lineId)!;
        return !(owned.packCost != null && owned.packSize != null
          && Math.abs(Number(owned.packCost) - l.packCost) < 1e-9 && Math.abs(Number(owned.packSize) - l.packSize) < 1e-9);
      });
      const warnings = await this.sanity.checkIngredientCosts(tenantId, changed.map((l) => {
        const owned = req.lines.find((x) => x.id === l.lineId)!;
        return {
          key: `line:${l.lineId}`,
          rawMaterialId: owned.rawMaterialId,
          grossPerUnit: l.packCost / l.packSize,
          packSize: l.packSize,
          packCost: l.packCost,
          branchId: req.branchId,
        };
      }), extra.sanity);
      confirmedCosts = this.sanity.enforce(warnings, extra.sanity);
    }

    /*
      For the Telegram alert, read before anything is written. News is the
      first recording, or a later trip that fills lines nobody had filled
      (milk from the market this morning, beans from the grocery this
      afternoon). A correction to a line already recorded is not news.
    */
    const filledBlank = lines.filter((l) => req.lines.find((x) => x.id === l.lineId)?.packsBought == null);

    await this.prisma.$transaction(
      lines.map((l) =>
        this.prisma.purchaseRequestLine.update({
          where: { id: l.lineId },
          data: {
            packsBought: new Prisma.Decimal(l.packsBought),
            packSize:    new Prisma.Decimal(l.packSize),
            packCost:    new Prisma.Decimal(l.packCost),
            brandNote:   l.brandNote?.trim() || null,
            // Only when said: a price fixed later, by a screen or a sheet that
            // does not mention the store, must not wipe where it was bought.
            ...(l.sourceKind !== undefined ? { sourceKind: isSourceKind(l.sourceKind) ? l.sourceKind : null } : {}),
            ...(l.sourceName !== undefined ? { sourceName: cleanSourceName(l.sourceName) } : {}),
          },
        }),
      ),
    );

    /*
      Remembered against the line only when an owner or manager said yes. That
      memory lifts the ten-times guard when the goods are posted, and that
      guard is the owner's -- a cashier's yes on the buy list must not switch
      it off. A cashier's answer still lets their own save through; the owner
      is simply asked again when posting.
    */
    if (this.sanity && confirmedCosts.length > 0 && decider) {
      await this.sanity.recordConfirmed(tenantId, actor?.userId, confirmedCosts, (w) => ({
        type: CONFIRMED_LINE, id: w.key.slice('line:'.length),
      }));
    }

    let notes = req.notes;
    if (extra.note) notes = appendNote(notes, extra.note);
    const boughtDay = extra.boughtAt ? this.dayOf(extra.boughtAt) : null;
    if (extra.onTheWay || extra.paidFrom) notes = withTag(notes, 'ONTHEWAY', boughtDay ?? this.today());
    const updated = await this.prisma.purchaseRequest.update({
      where:   { id: requestId },
      data:    {
        status:   'BOUGHT',
        // The first recording sets the day; a correction later does not move it.
        boughtAt: boughtDay ? this.manilaMidnight(boughtDay) : (req.boughtAt ?? new Date()),
        ...(notes !== req.notes ? { notes } : {}),
      },
      include: this.lineInclude(),
    });
    if (!extra.quiet && (req.status === 'SENT' || filledBlank.length > 0)) {
      void this.telegramAlerts?.bought(tenantId, requestId, actor?.userId ?? null, req.status === 'SENT' ? null : {
        items: filledBlank.length,
        value: filledBlank.reduce((t, l) => t + l.packsBought * l.packCost, 0),
      });
    }
    /*
      Already paid ahead? Then a corrected price is a correction to the
      money too, and the pocket is the one the request remembers -- the
      screen stops offering the pocket tiles once an order is prepaid, so
      nothing is sent, and the difference used to go unposted: 1063 was
      credited on arrival for a price the pocket was never charged.
    */
    const pocket = extra.paidFrom ?? (readTag(req.notes, 'PREPAID') as ProcurePocket | null);
    if (!pocket) return updated;
    const paid = await this.payAhead(tenantId, updated, actor?.userId ?? '', pocket, boughtDay ?? this.today(), extra.charges ?? []);
    return { ...paid.request, paidAhead: paid.summary };
  }

  /**
   * A purchase made away from the app, recorded from the buy-lists sheet.
   *
   * Becomes a request like any other -- numbered, one line per ingredient,
   * each with its own control number -- created already sent and then
   * recorded as bought through recordBought, so every rule that guards a
   * typed-in purchase guards this one. The note says it came from the sheet,
   * which is also how a second upload of the same file finds it again.
   * Nothing is posted: stock goes in when someone taps Post to stock.
   *
   * If recording fails, the half-made request is removed rather than left on
   * the list with no packs on it.
   */
  async recordFromSheet(
    tenantId: string,
    branchId: string,
    boughtOn: string,
    lines: Array<{
      rawMaterialId: string; packsBought: number; packSize: number; packCost: number; brandNote: string | null; rowKey?: string | null;
      sourceKind?: SourceKind | null; sourceName?: string | null;
    }>,
    actor: { userId: string; role?: string | null },
    note: string,
  ) {
    if (lines.length === 0) throw new BadRequestException('Nothing to record.');
    // Which spare row each line came from, so a later upload of the same row finds this purchase whatever it now says.
    const keys = lines.map((l, i) => (l.rowKey ? `${l.rowKey}=${String(i + 1).padStart(2, '0')}` : null)).filter(Boolean);
    const notes = keys.length ? appendNote(appendNote(null, note), `Sheet rows: ${keys.join(', ')}`) : appendNote(null, note);
    const day = this.dayOf(boughtOn);
    const branch = await this.resolveBranch(tenantId, branchId);
    const now = new Date();
    const created = await this.withNumber((requestNumber) => {
      const numbered: Array<{ lineNumber: string }> = [];
      return this.prisma.purchaseRequest.create({
        data: {
          tenantId, branchId: branch, requestNumber, status: 'SENT', sentAt: now,
          sentById: actor.userId, createdById: actor.userId, notes,
          lines: {
            create: lines.map((l) => {
              const lineNumber = this.nextLineNumber(requestNumber, numbered);
              numbered.push({ lineNumber });
              return { lineNumber, rawMaterialId: l.rawMaterialId, qtyRequested: new Prisma.Decimal(+(l.packsBought * l.packSize).toFixed(4)) };
            }),
          },
        },
        include: this.lineInclude(),
      });
    }, () => this.nextNumber(tenantId));
    try {
      return await this.recordBought(
        tenantId, created.id,
        created.lines.map((cl) => {
          const l = lines.find((x) => x.rawMaterialId === cl.rawMaterialId)!;
          return {
            lineId: cl.id, packsBought: l.packsBought, packSize: l.packSize, packCost: l.packCost, brandNote: l.brandNote ?? undefined,
            sourceKind: l.sourceKind ?? undefined, sourceName: l.sourceName ?? undefined,
          };
        }),
        actor, { boughtAt: day, quiet: true },
      );
    } catch (err) {
      await this.prisma.purchaseRequest.delete({ where: { id: created.id } }).catch((e) => {
        this.logger.warn(`[procure] could not remove the half-made sheet request ${created.requestNumber}: ${e instanceof Error ? e.message : e}`);
      });
      throw err;
    }
  }

  /**
   * The money left on order day; the goods have not.
   *
   * A Shopee order or a deposit to a supplier is paid days before the
   * parcel. Booking it on arrival made the GCash balance in the books wrong
   * for the whole wait. Booking it as an expense on order day made COGS
   * wrong instead. So it waits in 1063 Advance Deposits -- a clearing
   * account, the shop's own GR/IR -- and the arrival takes it onto the
   * shelf from there. Refunds come back to the pocket; a parcel that never
   * comes is written off. The request remembers the pocket and the amount,
   * so a correction to the prices posts only the difference.
   */
  async payAhead(
    tenantId: string,
    req: { id: string; requestNumber: string; notes: string | null;
           lines: Array<{ packsBought: Prisma.Decimal | null; packCost: Prisma.Decimal | null; receivedAt: Date | null }> },
    userId: string,
    pocket: ProcurePocket,
    day: string,
    charges: Array<{ description: string; amount: number; category?: ExpenseCategory }>,
  ) {
    if (!this.simple) throw new BadRequestException('Paying ahead cannot be posted on this deployment.');
    /*
      One order, one pocket. The receipts screen carries its own "who paid"
      picker and defaults it, so re-reading an order page onto a request
      already paid from the bank rewrote the tag to whatever that picker
      said -- and a refund weeks later went back to the wrong place. The
      request's own memory wins; a caller cannot move it.
    */
    const locked = readTag(req.notes, 'PREPAID') as ProcurePocket | null;
    if (locked) pocket = locked;
    const total = +req.lines
      .filter((l) => !l.receivedAt && l.packsBought != null && l.packCost != null)
      .reduce((sum, l) => sum + Number(l.packsBought) * Number(l.packCost), 0)
      .toFixed(2);
    const already = Number(readTag(req.notes, 'ADV') ?? 0) || 0;
    const delta = +(total - already).toFixed(2);
    const entries: PostedExpense[] = [];
    const label = `Paid ahead: ${req.requestNumber}`;
    /*
      What actually reached the ledger. The tags below say the shop's money
      is already out and waiting in 1063, and the arrival believes them: it
      takes the goods from 1063 instead of charging a pocket. So they are
      written from what posted, never from what was asked for. A locked
      month, a missing 1063, a failed owner half -- the request stays
      un-prepaid, the person is told, and a retry posts the whole amount.
    */
    let posted = 0;

    if (Math.abs(delta) >= 0.01) {
      const type = delta > 0 ? 'PAID_AHEAD' : 'PAID_AHEAD_REFUND';
      const amount = Math.abs(delta);
      try {
        const je = await this.simple.create(tenantId, userId, {
          type, amount, date: day, source: pocket === 'BANK' ? 'BANK' : 'CASH', note: label,
        });
        // Owner-funded: the owner put the money in, then the business paid it out.
        if (pocket === 'OWNER_FUNDED') {
          await this.simple.create(tenantId, userId, {
            type: delta > 0 ? 'OWNER_CONTRIBUTION' : 'OWNER_DRAWING', amount, date: day, source: 'CASH',
            note: `${delta > 0 ? 'Owner paid' : 'Owner took back'}: ${label}`,
          });
        }
        posted = delta;
        entries.push({ description: delta > 0 ? 'Paid ahead' : 'Paid-ahead correction', amount, entryNumber: je.entryNumber, status: je.status });
      } catch (err) {
        entries.push({ description: 'Paid ahead', amount, error: err instanceof Error ? err.message : 'Could not post.' });
      }
    }
    const fees = charges.length > 0 ? await this.postExpenses(tenantId, userId, day, req.requestNumber, pocket, charges) : [];

    // Paid ahead means not here yet: the request is on the way from this day.
    const advance = +(already + posted).toFixed(2);
    let notes = readTag(req.notes, 'ONTHEWAY') ? req.notes : withTag(req.notes, 'ONTHEWAY', day);
    if (advance >= 0.01) {
      notes = withTag(notes, 'PREPAID', pocket);
      notes = withTag(notes, 'ADV', advance.toFixed(2));
    }
    const request = await this.prisma.purchaseRequest.update({
      where: { id: req.id }, data: { notes }, include: this.lineInclude(),
    });
    return { request, summary: { pocket, total, posted, advance, entries: [...entries, ...fees] } };
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

    /*
      A price already asked about when it was typed -- on the buy list, or on a
      receipt saved to this request -- and confirmed by an owner or manager.
      Refusing it now with the old "check the unit" guard would ask the same
      question again as a dead end, days later. Only for the exact value
      confirmed: a price changed since then is judged afresh.
    */
    const confirmedAtPurchase = await this.prisma.auditLog.findMany({
      where: { tenantId, action: 'PRICE_ADJUSTED', entityType: CONFIRMED_LINE, entityId: { in: req.lines.map((l) => l.id) } },
      select: { entityId: true, after: true },
    });
    if (confirmedAtPurchase.length > 0) {
      const accept = new Set(opts.acceptCostChangeFor ?? []);
      for (const row of confirmedAtPurchase) {
        const answer = row.after as { severity?: string; value?: string } | null;
        const line = req.lines.find((l) => l.id === row.entityId);
        if (!line || !answer?.value || line.packCost == null || line.packSize == null) continue;
        if (answer.value === sanityValueKey(Number(line.packCost) / Number(line.packSize))) accept.add(line.rawMaterialId);
      }
      opts = { ...opts, acceptCostChangeFor: accept };
    }
    const receivedDay = opts.receivedAt ? this.dayOf(opts.receivedAt) : this.today();
    /*
      Paid on order day: the pocket was charged then, into 1063. The shelf
      takes the goods from 1063 now, and anything short settles against it
      -- a refund back to the same pocket, a loss written off -- never a
      second charge to the pocket.
    */
    const prepaidPocket = readTag(req.notes, 'PREPAID') as ProcurePocket | null;
    const pocket: ProcurePocket = prepaidPocket ?? paymentMethod;
    const inventoryPocket: ProcurePocket | 'PREPAID' = prepaidPocket ? 'PREPAID' : paymentMethod;

    /*
      "The rest isn't coming" puts whatever was not ticked back on the open
      shopping list. On an order that was PAID for, those packs are money
      already sitting in 1063: closing would leave it there with nothing to
      clear it, and buy the same goods a second time. Each one has to be
      ticked with what arrived and told what became of it.
    */
    if (opts.closeRest && prepaidPocket && opts.lines) {
      const unsettled = req.lines.filter((l) => !l.receivedAt && l.packsBought != null && !chosen.has(l.id));
      if (unsettled.length > 0) {
        throw new BadRequestException(
          `${unsettled.map((l) => l.rawMaterial.name).join(', ')} `
          + `${unsettled.length === 1 ? 'was' : 'were'} paid for with this order. `
          + 'Tick each one with the packs that arrived (0 if none) and say whether it was refunded, '
          + 'lost, still coming or not coming, so the money paid ahead is settled.',
        );
      }
    }

    const posted:  Array<{ line: string; name: string; quantity: number; unitCost: number; warning: string | null }> = [];
    const skipped: Array<{ line: string; name: string; reason: string }> = [];
    const failed:  Array<{ line: string; name: string; reason: string }> = [];
    const short:   Array<{
      line: string; name: string; rawMaterialId: string;
      packsBought: number; packsArrived: number; packSize: number; packCost: number; brandNote: string | null;
      sourceKind: string | null; sourceName: string | null;
      outcome: ShortOutcome;
    }> = [];
    const done = new Set<string>();
    const marginAlerts: MarginAlert[] = [];

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
          const res: { duplicate?: boolean; warning?: string | null; marginAlerts?: MarginAlert[] } = await this.inventory.receiveRawMaterial(tenantId, line.rawMaterialId, {
            branchId:        req.branchId,
            quantity,
            costPrice:       unitCost,
            paymentMethod:   inventoryPocket,
            referenceNumber: line.lineNumber,
            note:            [opts.note, line.brandNote].filter(Boolean).join(' · ') || undefined,
            receivedAt:      receivedDay,
            ...(opts.acceptCostChangeAll || opts.acceptCostChangeFor?.has(line.rawMaterialId) ? { acceptCostChange: true } : {}),
          } as never);
          if (res.duplicate) {
            skipped.push({ line: line.lineNumber, name, reason: 'This line was already received.' });
          } else {
            posted.push({ line: line.lineNumber, name, quantity, unitCost, warning: res.warning ?? null });
            // Drinks this delivery just pushed into a loss -- told, not asked.
            for (const alert of res.marginAlerts ?? []) {
              if (!marginAlerts.some((a) => a.productId === alert.productId)) marginAlerts.push(alert);
            }
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
          sourceKind: line.sourceKind, sourceName: line.sourceName,
          outcome: outcomeOf.get(line.id) ?? 'STILL_COMING',
        });
      }
      await this.prisma.purchaseRequestLine.update({ where: { id: line.id }, data });
      done.add(line.id);
    }

    // ── what was short ─────────────────────────────────────────────────────
    const stillComing = short.filter((x) => x.outcome === 'STILL_COMING');
    const followUp = stillComing.length > 0 ? await this.createFollowUp(tenantId, req, userId, stillComing, prepaidPocket) : null;
    let notes = req.notes;
    const lost: Array<{ description: string; amount: number; category: ExpenseCategory }> = [];
    const settled: PostedExpense[] = [];
    for (const x of short) {
      const missing = +(x.packsBought - x.packsArrived).toFixed(4);
      const word: Record<ShortOutcome, string> = {
        STILL_COMING: followUp ? `still coming (${followUp.requestNumber})` : 'still coming',
        REFUNDED:     'refunded',
        LOST:         'lost, expensed',
        NOT_COMING:   prepaidPocket ? 'not coming, written off' : 'not coming',
      };
      notes = appendNote(notes, `${x.name}: bought ${x.packsBought}, ${x.packsArrived} arrived, ${missing} ${word[x.outcome]}`);
      const value = +(missing * x.packCost).toFixed(2);
      const what  = `${x.name} — ${missing} pack${missing === 1 ? '' : 's'}`;
      if (prepaidPocket && value >= 0.01 && (x.outcome === 'REFUNDED' || x.outcome === 'LOST' || x.outcome === 'NOT_COMING')) {
        // Against the advance, never the pocket a second time.
        settled.push(...await this.settleAdvance(tenantId, userId, receivedDay, req.requestNumber, prepaidPocket, x.outcome, what, value));
      } else if (x.outcome === 'LOST') {
        lost.push({ description: `${what} paid for and lost`, amount: value, category: 'OTHER' });
      }
    }
    if (opts.note) notes = appendNote(notes, opts.note);

    /*
      What is left of the advance. Packs that reached the shelf took their
      share out of 1063, packs that were refunded or written off settled
      theirs, and packs still coming carried theirs to the follow-up. What
      remains is the lines nobody has posted yet -- and that is the number a
      later price correction measures its difference against. Left at the
      whole order, a correction after a partial post read as a refund that
      never happened.
    */
    if (prepaidPocket) {
      const left = req.lines
        .filter((l) => !l.receivedAt && !done.has(l.id) && l.packsBought != null && l.packCost != null)
        .reduce((sum, l) => sum + Number(l.packsBought) * Number(l.packCost), 0);
      notes = withTag(notes, 'ADV', (+left.toFixed(2)).toFixed(2));
    }

    // ── charges: with the goods, once ──────────────────────────────────────
    let charges: PostedExpense[] = [...settled];
    const side = [...(opts.charges ?? []), ...lost];
    if (side.length > 0) {
      if (posted.length > 0 || lost.length > 0) {
        charges = [...charges, ...await this.postExpenses(tenantId, userId, receivedDay, req.requestNumber, pocket, side)];
      } else {
        // Nothing reached the shelf in this call, so nothing rides along
        // with it: a charge posted twice is worse than one posted late.
        charges = [...charges, ...side.map((c) => ({ description: c.description, amount: c.amount, error: 'Not recorded: nothing was posted in this call. Add it with the lines you post.' }))];
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
    /*
      The copy as booked, for the owner: what was bought, at what price, what
      became of each line. Filed when the request closes, and again as a new
      version whenever a later call changes a line of a request already in
      stock -- posted, or closed with nothing arriving.
    */
    if (updated.status === 'RECEIVED' && (closing || done.size > 0)) {
      await this.fileRequestPdf(tenantId, requestId, 'booked', userId);
    }
    if (closing) void this.telegramAlerts?.postedToStock(tenantId, requestId, userId);
    return {
      request: updated, posted, skipped, failed, carried, charges, marginAlerts,
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
    lines: Array<{ lineNumber: string; rawMaterialId: string; qtyRequested: Prisma.Decimal; shortBy: Prisma.Decimal | null; rawMaterial: { name: string; subRecipeItems?: Array<{ id: string }> } }>,
    userId: string,
  ) {
    const carried: Array<{ line: string; name: string; qtyRequested: number; to: string; alreadyThere: boolean }> = [];
    // A prep left on an old list is made in the kitchen, not bought: it is not carried onto the next one.
    lines = lines.filter((l) => (l.rawMaterial.subRecipeItems ?? []).length === 0);
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
    short: Array<{
      rawMaterialId: string; packsBought: number; packsArrived: number; packSize: number; packCost: number; brandNote: string | null;
      sourceKind?: string | null; sourceName?: string | null;
    }>,
    prepaidPocket: ProcurePocket | null = null,
  ) {
    const numbered: Array<{ lineNumber: string }> = [];
    const now = new Date();
    let notes = withTag(withTag(null, 'BALANCEOF', req.requestNumber), 'ONTHEWAY', this.today());
    // Already paid for, on the original: the balance takes its goods from
    // the same advance, and carries that much of it onto itself.
    if (prepaidPocket) {
      const carried = short.reduce((sum, x) => sum + +(x.packsBought - x.packsArrived).toFixed(4) * x.packCost, 0);
      notes = withTag(notes, 'PREPAID', prepaidPocket);
      notes = withTag(notes, 'ADV', (+carried.toFixed(2)).toFixed(2));
    }
    notes = appendNote(notes, `Balance of ${req.requestNumber}: still coming`);
    return this.withNumber((requestNumber) => this.prisma.purchaseRequest.create({
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
              // The balance comes from the store the rest came from.
              sourceKind:    x.sourceKind ?? null,
              sourceName:    x.sourceName ?? null,
            };
          }),
        },
      },
      include: this.lineInclude(),
    }), () => this.nextNumber(tenantId));
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

  /**
   * What happens to money paid ahead for packs that did not come. A refund
   * returns to the pocket that paid (an owner's own money goes back out to
   * the owner); a loss, or a parcel that will never come, is written off.
   */
  private async settleAdvance(
    tenantId: string, userId: string, day: string, label: string,
    pocket: ProcurePocket, outcome: ShortOutcome, what: string, amount: number,
  ): Promise<PostedExpense[]> {
    if (!this.simple) throw new BadRequestException('Paid-ahead settlement cannot be posted on this deployment.');
    const refund = outcome === 'REFUNDED';
    const description = refund ? `${what} refunded` : `${what} paid ahead, never received`;
    try {
      const je = await this.simple.create(tenantId, userId, {
        type: refund ? 'PAID_AHEAD_REFUND' : 'PAID_AHEAD_WRITE_OFF',
        amount, date: day, source: pocket === 'BANK' ? 'BANK' : 'CASH', note: `${label}: ${description}`.slice(0, 200),
      });
      if (refund && pocket === 'OWNER_FUNDED') {
        await this.simple.create(tenantId, userId, {
          type: 'OWNER_DRAWING', amount, date: day, source: 'CASH', note: `Refund to the owner: ${label}`.slice(0, 200),
        });
      }
      return [{ description, amount, entryNumber: je.entryNumber, status: je.status }];
    } catch (err) {
      return [{ description, amount, error: err instanceof Error ? err.message : 'Could not post.' }];
    }
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
    // Among photos only: a filed buy-list PDF does not shift the numbering.
    const n = await this.prisma.document.count({ where: { tenantId, entityType: 'PurchaseRequest', entityId: req.id, mimeType: { startsWith: 'image/' } } }) + 1;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const doc = await this.documents.uploadBuffer(
      tenantId, 'PurchaseRequest', req.id, buffer, mime,
      `${slug}-${req.requestNumber}-${n}.${ext}`, label, userId,
    );
    void this.telegramAlerts?.purchasePhoto(tenantId, req.id, buffer, mime, label, userId);
    return { id: doc.id, filename: doc.filename, label };
  }

  /**
   * One copy of the buy list as a PDF, drawn from what the database holds now.
   * `reprint` says the page stands in for a copy that was never filed, so the
   * page can say its on-hand figures are today's.
   */
  private async drawRequestPdf(
    tenantId: string,
    requestId: string,
    copy: BuyListCopy,
    opts: { showMoney: boolean; reprint: boolean },
  ): Promise<{ buffer: Buffer; requestNumber: string; lines: number }> {
    const raw = await this.getRaw(tenantId, requestId);
    const [req] = await this.enrich<(typeof raw.lines)[number], typeof raw>(tenantId, [raw]);
    const [tenant, sender] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, businessName: true } }),
      req.sentById ? this.prisma.user.findFirst({ where: { id: req.sentById, tenantId }, select: { name: true } }) : null,
    ]);
    const model = buildBuyListModel({
      shopName:      tenant?.businessName || tenant?.name || 'Clerque',
      requestNumber: req.requestNumber,
      status:        req.status,
      branchName:    req.branch?.name ?? null,
      sentAt:        req.sentAt,
      sentBy:        sender?.name ?? null,
      receivedAt:    req.receivedAt,
      notes:         plainNotes(req.notes),
      lines: req.lines.map((l) => ({
        lineNumber:   l.lineNumber,
        name:         l.rawMaterial.name,
        unit:         l.rawMaterial.unit,
        qtyRequested: Number(l.qtyRequested),
        onHand:       l.onHand,
        counted:      l.counted?.qty ?? null,
        // On the copy filed at send, frozen as they were when the list went out;
        // on a copy drawn later, today's, and the page says which.
        serves:       copy === 'sent' ? servesSummary(l.serves) : null,
        usuallyFrom:  copy === 'sent' ? usuallyFromText(l.usuallyFrom) : null,
        source:       sourceText(l.sourceKind, l.sourceName),
        lastPackSize: l.lastPack?.packSize ?? null,
        packsBought:  l.packsBought != null ? Number(l.packsBought) : null,
        packSize:     l.packSize != null ? Number(l.packSize) : null,
        packCost:     l.packCost != null ? Number(l.packCost) : null,
        brandNote:    l.brandNote,
        receivedAt:   l.receivedAt,
      })),
    }, { copy, showMoney: opts.showMoney, printedAt: new Date(), reprint: opts.reprint });
    return { buffer: await renderBuyListPdf(model), requestNumber: req.requestNumber, lines: req.lines.length };
  }

  /**
   * File a copy of the buy list against the request, where the photos go.
   *
   * The copy as sent is filed once. The copy as booked is filed again, as a
   * numbered version, whenever a post changes a request already in stock --
   * the newest is the true one. An empty list is sent on purpose every day
   * and files nothing.
   *
   * Best effort: filing never blocks a send or a post. Returns the bytes
   * filed, so the owner email can carry the same file, or null.
   */
  async fileRequestPdf(tenantId: string, requestId: string, copy: BuyListCopy, userId: string): Promise<Buffer | null> {
    if (!this.documents) return null;
    try {
      const label = BUY_LIST_PDF_LABEL[copy];
      const filed = await this.prisma.document.findMany({
        where:  { tenantId, entityType: 'PurchaseRequest', entityId: requestId, label },
        select: { filename: true },
      });
      if (copy === 'sent' && filed.length > 0) return null;
      const out = await this.drawRequestPdf(tenantId, requestId, copy, { showMoney: copy === 'booked', reprint: false });
      if (out.lines === 0) return null;
      /*
        The next version after the highest one filed, not after how many are
        left: a copy somebody deleted must not hand its number to the next.
      */
      const highest = filed.reduce((max, d) => {
        const m = /-booked(?:-(\d+))?\.pdf$/.exec(d.filename);
        return m ? Math.max(max, m[1] ? parseInt(m[1], 10) : 1) : max;
      }, filed.length > 0 ? 1 : 0);
      const version = copy === 'booked' && highest > 0 ? `-${highest + 1}` : '';
      await this.documents.uploadBuffer(
        tenantId, 'PurchaseRequest', requestId, out.buffer, 'application/pdf',
        `buy-list-${out.requestNumber}-${copy}${version}.pdf`, label, userId,
      );
      return out.buffer;
    } catch (err) {
      this.logger.warn(`[procure] could not file the ${copy} buy list for request ${requestId}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * The buy list as a PDF, for this viewer.
   *
   * As sent: the filed copy, byte for byte, so the file in the group chat and
   * the file in Clerque are the same file. It carries no prices, which is why
   * the kitchen may have it even on a shop that hides purchase costs from
   * them -- a change that puts money on that copy must change this too. A
   * request sent before copies were filed is drawn now and says so.
   *
   * As booked: the filed copy (the newest version) for someone who may see
   * purchase costs; drawn now without the money for everyone else.
   */
  async requestPdf(tenantId: string, requestId: string, copy: BuyListCopy, viewerRole?: string | null): Promise<{ buffer: Buffer; filename: string }> {
    const req = await this.getRaw(tenantId, requestId);
    const seeCosts = copy === 'booked' && await this.costsVisibleTo(tenantId, viewerRole);
    const filename = `${req.requestNumber}-${copy === 'sent' ? 'buy-list' : 'in-stock'}.pdf`;

    if (this.documents && (copy === 'sent' || seeCosts)) {
      const filed = await this.prisma.document.findFirst({
        where:   { tenantId, entityType: 'PurchaseRequest', entityId: req.id, label: BUY_LIST_PDF_LABEL[copy], mimeType: 'application/pdf' },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, createdAt: true },
      });
      /*
        A booked copy older than the request's last change missed a re-filing
        (storage was down when the post landed). Draw it now rather than serve
        a copy that no longer says what happened. The as-sent copy is meant to
        be old: it is the list as it went out.
      */
      const stale = copy === 'booked' && !!filed && filed.createdAt < req.updatedAt;
      if (filed && !stale) {
        try {
          return { buffer: await this.documents.readFiled(tenantId, filed.id), filename };
        } catch (err) {
          // The row is there and the file is not. Draw it now rather than fail the share.
          this.logger.warn(`[procure] filed buy list ${filed.id} for ${req.requestNumber} could not be read: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    const out = await this.drawRequestPdf(tenantId, requestId, copy, {
      showMoney: seeCosts,
      reprint:   copy === 'sent' && req.status !== 'OPEN',
    });
    return { buffer: out.buffer, filename };
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
    /*
      Money already out and waiting in 1063 cannot be cancelled away: the
      shop either got it back or lost it, and the books have to say which.
      Posting the request with 0 packs arrived does exactly that, and closes
      the request on the way through.
    */
    const advance = Number(readTag(req.notes, 'ADV') ?? 0) || 0;
    if (readTag(req.notes, 'PREPAID') && advance >= 0.01) {
      throw new BadRequestException(
        `This order was paid for ahead, and ${advance.toFixed(2)} of it is still waiting to be accounted for. `
        + 'Post it instead, with 0 packs arrived, and say whether it was refunded or is not coming — '
        + 'that settles the money and closes the request.',
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
    /*
      Tickets waiting at a kitchen or bar screen have not taken their
      ingredients off the book yet, but the next customer cannot have them.
      Read on the book alone, this page would promise lattes the till is
      already refusing.
    */
    const held = await heldUsage(this.prisma, tenantId, [branchId], { rawMaterialIds });
    const heldOf = (id: string) => heldAt(held, branchId, id);
    const stockOf = new Map(stockRows.map((r) => [r.rawMaterialId, afterHeld(Number(r.quantity), heldOf(r.rawMaterialId))]));

    // ingredientId -> what it is holding back
    const capping = new Map<string, {
      rawMaterialId: string; name: string; unit: string;
      stock: number; heldQty: number; servingsLeft: number;
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
        // So the page can say why stock reads below what is on the shelf.
        heldQty: heldOf(key),
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
      select:   { rawMaterialId: true, packSize: true, packCost: true, brandNote: true, receivedAt: true, sourceKind: true, sourceName: true },
    });
    return new Map<string, LastPack>(rows.map((r) => [r.rawMaterialId, {
      packSize:   Number(r.packSize),
      packCost:   Number(r.packCost),
      brandNote:  r.brandNote,
      receivedAt: r.receivedAt,
      sourceKind: r.sourceKind,
      sourceName: r.sourceName,
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
      sourceKind: p.sourceKind,
      sourceName: p.sourceName,
    }));
  }

  /**
   * Where each item is usually bought at each branch: the most frequent store
   * over its last few purchases in the last three months. A short delivery's
   * balance is the same purchase, so it is not counted twice.
   *
   * Information, not the list: if it cannot be worked out the list still
   * loads without it, and the failure is logged.
   */
  private async usualSources(tenantId: string, branchIds: string[], itemIds: string[]): Promise<Map<string, UsuallyFrom | null> | null> {
    if (itemIds.length === 0) return new Map();
    try {
      const found = await this.prisma.purchaseRequestLine.findMany({
        where: {
          rawMaterialId: { in: itemIds },
          ...this.reallyBought(),
          purchaseRequest: {
            tenantId,
            branchId: { in: branchIds },
            status:   { in: ['BOUGHT', 'RECEIVED'] },
            boughtAt: { gte: new Date(Date.now() - USUALLY_DAYS * 86_400_000) },
          },
        },
        orderBy: [{ purchaseRequest: { boughtAt: 'desc' } }, { purchaseRequest: { requestNumber: 'desc' } }],
        select:  { rawMaterialId: true, sourceKind: true, sourceName: true, purchaseRequest: { select: { id: true, branchId: true, boughtAt: true, notes: true } } },
      });
      const balanceIsTheBuy = await this.balancesThatAreTheBuy(tenantId, found);
      const rows = found.filter((r) => !isBalance(r.purchaseRequest.notes) || balanceIsTheBuy.has(`${r.purchaseRequest.id}:${r.rawMaterialId}`));
      const byKey = new Map<string, Array<{ sourceKind: string | null; sourceName: string | null; on: Date }>>();
      for (const r of rows) {
        const key = `${r.purchaseRequest.branchId}:${r.rawMaterialId}`;
        const list = byKey.get(key) ?? [];
        if (list.length < USUALLY_BUYS) list.push({ sourceKind: r.sourceKind, sourceName: r.sourceName, on: r.purchaseRequest.boughtAt! });
        byKey.set(key, list);
      }
      return new Map([...byKey.entries()].map(([k, list]) => [k, usuallyFrom(list)]));
    } catch (err) {
      this.logger.warn(`[procure] could not work out where items are usually bought: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * A line that was really bought: packs recorded, and either already in stock
   * or on a request still waiting to be posted. A request closed with a line
   * never posted put that line back on the shopping list -- its packs and
   * price are still on it, but nothing was bought or paid, and counting it
   * would count the same purchase again when it is bought for real.
   */
  private reallyBought() {
    return {
      packsBought: { gt: 0 },
      OR: [{ receivedAt: { not: null } }, { purchaseRequest: { status: 'BOUGHT' as const } }],
    };
  }

  /**
   * The balance requests, of those given, that ARE the purchase rather than
   * part of one.
   *
   * A short delivery splits one purchase: what came stays on the original
   * line, what is still coming goes onto a balance request. Normally the
   * original is the buy and the balance only adds money. But when nothing at
   * all came, the original line is rewritten to zero packs and drops out, and
   * the balance is all that is left of the purchase -- so it counts as the buy.
   * Keyed `balanceRequestId:rawMaterialId`.
   */
  private async balancesThatAreTheBuy(
    tenantId: string,
    rows: Array<{ rawMaterialId: string; purchaseRequest: { id: string; notes: string | null } }>,
  ): Promise<Set<string>> {
    const balances = rows.filter((r) => isBalance(r.purchaseRequest.notes));
    if (balances.length === 0) return new Set();
    const numbers = [...new Set(balances.map((r) => readTag(r.purchaseRequest.notes, 'BALANCEOF')).filter((n): n is string => !!n))];
    const originals = numbers.length === 0 ? [] : await this.prisma.purchaseRequestLine.findMany({
      where:  { rawMaterialId: { in: [...new Set(balances.map((r) => r.rawMaterialId))] }, purchaseRequest: { tenantId, requestNumber: { in: numbers } } },
      select: { rawMaterialId: true, packsBought: true, purchaseRequest: { select: { requestNumber: true } } },
    });
    const counted = new Set(originals
      .filter((o) => o.packsBought != null && Number(o.packsBought) > 0)
      .map((o) => `${o.purchaseRequest.requestNumber}:${o.rawMaterialId}`));
    return new Set(balances
      .filter((r) => !counted.has(`${readTag(r.purchaseRequest.notes, 'BALANCEOF')}:${r.rawMaterialId}`))
      .map((r) => `${r.purchaseRequest.id}:${r.rawMaterialId}`));
  }

  /**
   * Where each item was bought, and what it cost there.
   *
   * The owner's question is "where do we usually get this, and is that the
   * cheap place?". Per item: how many times it was bought, the store it is
   * usually bought from, and for each store the times, the last purchase and
   * the cheapest price per unit. Per store: how many trips, how many items and
   * how much was spent.
   *
   * A trip is a request; a buy is one line. The balance of a short delivery is
   * part of the same buy -- its money counts, its line is not a second buy --
   * unless nothing came the first time, when the balance is the buy. A line
   * put back on the list when its request closed was never bought at all.
   * Prices and spend only for people who may see purchase costs; store names
   * are not a cost and are shown to everyone who can open Procure.
   */
  async whereBought(
    tenantId: string,
    opts: { from?: string; to?: string; branchId?: string },
    viewerRole?: string | null,
  ) {
    const to = opts.to ? this.dayOf(opts.to) : this.today();
    const from = opts.from
      ? this.dayOf(opts.from)
      : new Date(this.manilaMidnight(to).getTime() - (USUALLY_DAYS - 1) * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10);
    if (from > to) throw new BadRequestException('The From date is after the To date.');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new BadRequestException('A year at most. Narrow the dates.');
    const branchId = opts.branchId ? await this.resolveBranch(tenantId, opts.branchId) : null;
    const seeCosts = await this.costsVisibleTo(tenantId, viewerRole);

    const rows = await this.prisma.purchaseRequestLine.findMany({
      where: {
        ...this.reallyBought(),
        purchaseRequest: {
          tenantId,
          status:   { in: ['BOUGHT', 'RECEIVED'] },
          boughtAt: { gte: this.manilaMidnight(from), lt: new Date(this.manilaMidnight(to).getTime() + 86_400_000) },
          ...(branchId ? { branchId } : {}),
        },
      },
      // Two lists bought the same day: the later one is the newer purchase.
      orderBy: [{ purchaseRequest: { boughtAt: 'desc' } }, { purchaseRequest: { requestNumber: 'desc' } }, { lineNumber: 'asc' }],
      take:    WHERE_BOUGHT_MAX_LINES + 1,
      select: {
        rawMaterialId: true, packsBought: true, packSize: true, packCost: true, sourceKind: true, sourceName: true,
        rawMaterial:     { select: { name: true, unit: true } },
        purchaseRequest: { select: { id: true, boughtAt: true, notes: true } },
      },
    });
    const truncated = rows.length > WHERE_BOUGHT_MAX_LINES;
    if (truncated) rows.length = WHERE_BOUGHT_MAX_LINES;
    const balanceIsTheBuy = await this.balancesThatAreTheBuy(tenantId, rows);

    const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
    /*
      "Last" is the newest real purchase. A balance request is dated the day the
      short delivery was booked, not the day the goods were bought, so it adds
      money and nothing else.
    */
    type StoreOfItem = {
      key: string; kind: SourceKind | null; name: string | null; times: number; lastOn: Date | null;
      lastPackSize: number | null; lastPackCost: number | null; bestPerUnit: number | null; spend: number;
    };
    const items = new Map<string, {
      rawMaterialId: string; name: string; unit: string; buys: number; withoutStore: number; spend: number;
      lastOn: Date | null; forUsual: Array<{ sourceKind: string | null; sourceName: string | null; on: Date }>;
      stores: Map<string, StoreOfItem>;
    }>();
    const stores = new Map<string, {
      key: string; kind: SourceKind | null; name: string | null; trips: Set<string>; items: Set<string>;
      buys: number; spend: number; lastOn: Date | null;
    }>();
    const newest = (d: Date | null) => d?.getTime() ?? 0;
    let buys = 0, withStore = 0, spend = 0;
    const trips = new Set<string>();

    // Newest first, so the first time a store is met is its latest purchase and spelling.
    for (const r of rows) {
      const on = r.purchaseRequest.boughtAt!;
      const balance = isBalance(r.purchaseRequest.notes) && !balanceIsTheBuy.has(`${r.purchaseRequest.id}:${r.rawMaterialId}`);
      const packs = Number(r.packsBought), size = r.packSize != null ? Number(r.packSize) : null;
      const cost = r.packCost != null ? Number(r.packCost) : null;
      const amount = cost != null ? round(packs * cost, 2) : 0;
      const perUnit = cost != null && size != null && size > 0 ? cost / size : null;
      const key = sourceKey(r.sourceKind, r.sourceName);
      const kind = isSourceKind(r.sourceKind) ? r.sourceKind : null;
      const name = cleanSourceName(r.sourceName);

      let item = items.get(r.rawMaterialId);
      if (!item) {
        item = { rawMaterialId: r.rawMaterialId, name: r.rawMaterial.name, unit: r.rawMaterial.unit, buys: 0, withoutStore: 0, spend: 0, lastOn: null, forUsual: [], stores: new Map() };
        items.set(r.rawMaterialId, item);
      }
      item.spend += amount;
      spend += amount;
      if (!balance) {
        item.buys += 1;
        buys += 1;
        trips.add(r.purchaseRequest.id);
        item.lastOn ??= on;
        item.forUsual.push({ sourceKind: r.sourceKind, sourceName: r.sourceName, on });
        if (key) withStore += 1; else item.withoutStore += 1;
      }
      if (!key) continue;

      let st = item.stores.get(key);
      if (!st) {
        st = { key, kind, name, times: 0, lastOn: null, lastPackSize: null, lastPackCost: null, bestPerUnit: null, spend: 0 };
        item.stores.set(key, st);
      }
      if (!balance) {
        st.times += 1;
        if (!st.lastOn) Object.assign(st, { lastOn: on, lastPackSize: size, lastPackCost: cost, kind, name });
      }
      st.spend += amount;
      if (perUnit != null && (st.bestPerUnit == null || perUnit < st.bestPerUnit)) st.bestPerUnit = perUnit;

      let store = stores.get(key);
      if (!store) {
        store = { key, kind, name, trips: new Set(), items: new Set(), buys: 0, spend: 0, lastOn: null };
        stores.set(key, store);
      }
      store.spend += amount;
      store.items.add(r.rawMaterialId);
      if (!balance) {
        store.buys += 1;
        store.trips.add(r.purchaseRequest.id);
        if (!store.lastOn) Object.assign(store, { lastOn: on, kind, name });
      }
    }

    const money = (n: number | null) => (seeCosts && n != null ? round(n, 2) : null);
    return {
      from, to, branchId, showMoney: seeCosts, truncated,
      totals: { buys, withStore, trips: trips.size, stores: stores.size, spend: money(spend) },
      items: [...items.values()]
        .map((it) => {
          const storesOf = [...it.stores.values()].sort((a, b) => b.times - a.times || newest(b.lastOn) - newest(a.lastOn));
          const cheapest = seeCosts
            ? storesOf.filter((x) => x.bestPerUnit != null).sort((a, b) => a.bestPerUnit! - b.bestPerUnit!)[0] ?? null
            : null;
          return {
            rawMaterialId: it.rawMaterialId,
            name:          it.name,
            unit:          it.unit,
            buys:          it.buys,
            withoutStore:  it.withoutStore,
            lastOn:        it.lastOn,
            spend:         money(it.spend),
            usuallyFrom:   usuallyFrom(it.forUsual),
            cheapestKey:   cheapest && storesOf.length > 1 ? cheapest.key : null,
            stores: storesOf.map((x) => ({
              key: x.key, kind: x.kind, name: x.name, times: x.times, lastOn: x.lastOn,
              lastPackSize: x.lastPackSize,
              lastPackCost: money(x.lastPackCost),
              bestPerUnit:  seeCosts && x.bestPerUnit != null ? round(x.bestPerUnit, 4) : null,
              spend:        money(x.spend),
            })),
          };
        })
        .sort((a, b) => b.buys - a.buys || a.name.localeCompare(b.name)),
      stores: [...stores.values()]
        .map((x) => ({ key: x.key, kind: x.kind, name: x.name, trips: x.trips.size, buys: x.buys, items: x.items.size, lastOn: x.lastOn, spend: money(x.spend) }))
        .sort((a, b) => b.trips - a.trips || b.buys - a.buys || newest(b.lastOn) - newest(a.lastOn)),
    };
  }

  /** The tag on a cycle count that was started from a buy list, one line at a time. */
  private countTag(requestNumber: string) { return `[REQ:${requestNumber}]`; }

  /**
   * Every line, with what the shop knows around it: what the ingredient held
   * and cost last time, what Clerque says is on the shelf at this branch
   * (less what tickets waiting at a screen hold), what somebody counted while
   * building the list, and -- while the list is being built or has just gone
   * out -- what that stock still serves.
   */
  private async enrich<
    L extends { rawMaterialId: string },
    T extends { branchId: string; requestNumber: string; status?: string; lines: L[] },
  >(
    tenantId: string,
    reqs: T[],
  ): Promise<Array<Omit<T, 'lines'> & { lines: Array<L & {
    lastPack: LastPack | null; onHand: number; heldQty: number; counted: CountedLine | null; serves: LineServes | null; usuallyFrom: UsuallyFrom | null;
  }> }>> {
    const ids = [...new Set(reqs.flatMap((r) => r.lines.map((l) => l.rawMaterialId)))];
    const last = await this.lastPacks(tenantId, ids);

    const branches = [...new Set(reqs.map((r) => r.branchId))];
    const stock = ids.length === 0 ? [] : await this.prisma.rawMaterialInventory.findMany({
      where:  { tenantId, branchId: { in: branches }, rawMaterialId: { in: ids } },
      select: { branchId: true, rawMaterialId: true, quantity: true },
    });
    const onHand = new Map(stock.map((x) => [`${x.branchId}:${x.rawMaterialId}`, Number(x.quantity)]));
    /*
      Tickets waiting at a kitchen or bar screen still sit on the book, but
      their ingredients are spoken for. What to buy is decided on what is left
      once they are made, so "on hand" here -- the screen's figure and the
      PDF's -- is the book less what they hold, the same figure a count started
      from this list expects. Read once for every branch these lists are at,
      every ingredient the tickets use, and handed to the servings below so the
      two never disagree.
    */
    const held: HeldMap = ids.length === 0 ? new Map() : await heldUsage(this.prisma, tenantId, branches);

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

    /*
      What each line still serves, only while the list is being built or has
      just gone out. On-hand is live: on a request already bought or in stock
      the figure would describe today rather than the list. It also keeps the
      work off the hundred requests list() may read.
    */
    const building = (r: T) => r.status === 'OPEN' || r.status === 'SENT';
    const liveReqs = reqs.filter(building);
    const servesOf = liveReqs.length === 0 ? null : await this.servesByItem(
      tenantId,
      [...new Set(liveReqs.map((r) => r.branchId))],
      [...new Set(liveReqs.flatMap((r) => r.lines.map((l) => l.rawMaterialId)))],
      held,
    );
    // Where each item is usually bought, for the shopper -- the same lists only.
    const usualOf = liveReqs.length === 0 ? null : await this.usualSources(
      tenantId,
      [...new Set(liveReqs.map((r) => r.branchId))],
      [...new Set(liveReqs.flatMap((r) => r.lines.map((l) => l.rawMaterialId)))],
    );

    return reqs.map((r) => {
      const c = countOf.get(r.requestNumber);
      return {
        ...r,
        lines: r.lines.map((l) => {
          const cl = c ? counted.get(`${c.id}:${l.rawMaterialId}`) : undefined;
          const heldQty = heldAt(held, r.branchId, l.rawMaterialId);
          return {
            ...l,
            lastPack: last.get(l.rawMaterialId) ?? null,
            onHand:   afterHeld(onHand.get(`${r.branchId}:${l.rawMaterialId}`) ?? 0, heldQty),
            // So a person holding the bottle can see why the figure is lower than the shelf.
            heldQty,
            counted:  cl && c ? { qty: Number(cl.countedQty), expected: Number(cl.expectedQty), countId: c.id, countNumber: c.countNumber } : null,
            serves:   servesOf && building(r) ? servesOf(r.branchId, l.rawMaterialId, cl ? Number(cl.countedQty) : null) : null,
            usuallyFrom: usualOf && building(r) ? (usualOf.get(`${r.branchId}:${l.rawMaterialId}`) ?? null) : null,
          };
        }),
      };
    });
  }

  /**
   * What the stock of each item still serves, at each branch.
   *
   * "Remaining: 1 bottle" tells the owner how much is left, not whether it
   * matters. What decides whether to buy today is how many plates or cups
   * that bottle still makes, and whether the menu can sell them.
   *
   * Every active product whose recipe uses the item -- its own recipe, or a
   * size's recipe -- is counted. A recipe product is judged by the POS tile's
   * rule (recipe-ceiling.ts) on the same stock, so "the till shows 3 Spaghetti
   * left" on the buy list is the "3 left" on the till. A product the till
   * counts as finished stock still uses up its recipe on every sale, so it is
   * counted by the item too, with no till number to compare. An item that only
   * goes into a kitchen prep says which prep, and what that prep's own stock
   * serves. Add-ons are named and not counted, like on the tile.
   *
   * Stock is the book less what tickets waiting at a screen hold, as on the
   * till. A count is what somebody saw, so it is used as counted.
   *
   * Servings are information, not the list: if they cannot be worked out the
   * list still loads, without them, and the failure is logged.
   */
  private async servesByItem(
    tenantId: string,
    branchIds: string[],
    itemIds: string[],
    /** What waiting tickets hold, when the caller already read it for these branches. */
    held?: HeldMap,
  ): Promise<((branchId: string, itemId: string, counted: number | null) => LineServes) | null> {
    if (itemIds.length === 0) return () => ({ dishes: [], addOns: [], goesInto: [] });
    try {
      const prepLinks = await this.prisma.subRecipeItem.findMany({
        where:  { rawMaterialId: { in: itemIds }, parent: { tenantId, isActive: true } },
        select: { rawMaterialId: true, parent: { select: { id: true, name: true } } },
      });
      const targets = [...new Set([...itemIds, ...prepLinks.map((p) => p.parent.id)])];
      const recipeLine = {
        select: { rawMaterialId: true, quantity: true, rawMaterial: { select: { name: true, unit: true } } },
      } as const;
      const [products, addOnRows] = await Promise.all([
        this.prisma.product.findMany({
          where: {
            // Any inventory mode: a sale deducts the recipe whenever one exists.
            tenantId, isActive: true,
            OR: [
              { bomItems: { some: { rawMaterialId: { in: targets } } } },
              { variants: { some: { isActive: true, variantBomItems: { some: { rawMaterialId: { in: targets } } } } } },
            ],
          },
          select: {
            id: true, name: true, inventoryMode: true,
            bomItems: recipeLine,
            // The same sizes the till reads: active ones only.
            variants: { where: { isActive: true }, select: { id: true, name: true, variantBomItems: recipeLine } },
          },
          orderBy: { name: 'asc' },
        }),
        this.prisma.modifierOptionIngredient.findMany({
          where:  { rawMaterialId: { in: itemIds }, option: { isActive: true, group: { tenantId, isActive: true } } },
          select: { rawMaterialId: true, option: { select: { name: true } } },
        }),
      ]);

      // Every ingredient those recipes touch, so each dish's own ceiling is the tile's.
      const everyIngredient = [...new Set([
        ...targets,
        ...products.flatMap((p) => [...p.bomItems, ...p.variants.flatMap((v) => v.variantBomItems)].map((b) => b.rawMaterialId)),
      ])];
      const stockRows = await this.prisma.rawMaterialInventory.findMany({
        where:  { tenantId, branchId: { in: branchIds }, rawMaterialId: { in: everyIngredient } },
        select: { branchId: true, rawMaterialId: true, quantity: true },
      });
      const stock = new Map(stockRows.map((x) => [`${x.branchId}:${x.rawMaterialId}`, Number(x.quantity)]));
      // The owner email comes here without a hold in hand; the list passes the one its "on hand" took off.
      const heldNow = held ?? await heldUsage(this.prisma, tenantId, branchIds, { rawMaterialIds: everyIngredient });

      /** One dish. `till` is null for a product the till counts as finished stock, not by recipe. */
      const dish = (productId: string, name: string, perServing: number, onHand: number, counted: number | null,
                    till: { max: number; limitedBy: LimitedBy } | null): ServesDish => {
        const byThisItem = Math.max(0, servingsOf(onHand, perServing));
        return {
          productId, name, perServing, byThisItem,
          byCounted:   counted != null ? Math.max(0, servingsOf(counted, perServing)) : null,
          sellableNow: till ? till.max : byThisItem,
          limitedBy:   till?.limitedBy?.name ?? null,
        };
      };
      const tiles = new Map<string, ReturnType<typeof productCeiling>>();
      const dishesOf = (branchId: string, itemId: string, counted: number | null): ServesDish[] => {
        // Every ingredient of the dish, not just this one: the till's number is set by whichever runs out first.
        const stockOf = (id: string) => afterHeld(stock.get(`${branchId}:${id}`) ?? 0, heldAt(heldNow, branchId, id));
        const onHand = stockOf(itemId);
        const out: ServesDish[] = [];
        for (const p of products) {
          const byRecipe = p.inventoryMode === 'RECIPE_BASED';
          let tile = tiles.get(`${branchId}:${p.id}`);
          if (!tile) { tile = productCeiling(p, stockOf); tiles.set(`${branchId}:${p.id}`, tile); }
          const own = p.bomItems.find((b) => b.rawMaterialId === itemId && Number(b.quantity) > 0);
          if (own) {
            out.push(dish(p.id, p.name, Number(own.quantity), onHand, counted,
              byRecipe ? { max: tile.maxProducible, limitedBy: tile.limitedBy } : null));
          }
          // A size that carries its own recipe is sold, and counted, on its own.
          for (const v of p.variants) {
            const line = v.variantBomItems.find((b) => b.rawMaterialId === itemId && Number(b.quantity) > 0);
            if (!line) continue;
            const size = tile.variantCeilings.find((c) => c.variantId === v.id);
            out.push(dish(p.id, `${p.name} (${v.name})`, Number(line.quantity), onHand, counted,
              byRecipe ? { max: size?.maxProducible ?? 0, limitedBy: size?.limitedBy ?? null } : null));
          }
        }
        return out.sort((a, b) => a.byThisItem - b.byThisItem || a.name.localeCompare(b.name));
      };

      return (branchId, itemId, counted) => ({
        dishes:   dishesOf(branchId, itemId, counted),
        addOns:   [...new Set(addOnRows.filter((a) => a.rawMaterialId === itemId).map((a) => a.option.name))].sort(),
        goesInto: prepLinks
          .filter((l) => l.rawMaterialId === itemId)
          .map((l) => ({
            prepName: l.parent.name,
            dishes:   dishesOf(branchId, l.parent.id, null).map((d) => ({ name: d.name, byThisItem: d.byThisItem })),
          })),
      });
    } catch (err) {
      this.logger.warn(`[procure] could not work out what the buy list still serves: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // ── what is left on the shelf ─────────────────────────────────────────────

  /**
   * "Remaining: 1 bottle" -- the count that has always ridden on the
   * message to the owner, made real.
   *
   * It becomes a line on an ordinary cycle count for the branch, one count
   * per buy list, started the moment the first line is counted. Expected is
   * what Clerque had on the shelf right then, less what waiting tickets hold;
   * counted is what the person saw. Nothing moves until the owner or manager
   * posts the count from the counts screen, and then the existing rules
   * apply: the variance is measured against that snapshot and applied to the
   * live figure, so a delivery in between is not undone.
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
      try {
        count = await this.withNumber(
          (countNumber) => this.prisma.cycleCount.create({
            data: {
              tenantId, branchId: req.branchId, countNumber,
              status: 'OPEN', startedById: userId,
              notes: `${tag} Counted while building the buy list`,
            },
            select: { id: true, countNumber: true },
          }),
          () => this.warehouse!.nextCountNumber(this.prisma, tenantId),
        );
      } catch (err) {
        // Somebody else started this list's count a moment ago. Theirs is
        // the one to write into -- that is the whole point of one count
        // per list.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        count = await this.prisma.cycleCount.findFirst({
          where:  { tenantId, branchId: req.branchId, status: 'OPEN', notes: { startsWith: tag } },
          select: { id: true, countNumber: true },
        });
        if (!count) throw err;
      }
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
      /*
        A ticket waiting at a screen is being made or about to be: its share is
        the kitchen's, not the shelf's, though the book keeps it until the
        ready tap. Posting applies counted-minus-expected to the live figure
        and the tap then takes the ticket's share -- so expecting the whole
        book would take those ingredients off twice. The same expectation a
        cycle count started from the counts screen takes, and posting corrects
        it the same way: a ticket voided or refunded before the post gives its
        share back (releasedHolds, measured from when this list's count opened).
      */
      const held = await heldUsage(this.prisma, tenantId, [req.branchId], { rawMaterialIds: [line.rawMaterialId] });
      expected = afterHeld(live ? Number(live.quantity) : 0, heldAt(held, req.branchId, line.rawMaterialId));
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
          // Whether it is made in the kitchen: a prep is never carried onto the next list.
          rawMaterial: { select: { id: true, name: true, unit: true, costPrice: true, subRecipeItems: { select: { id: true }, take: 1 } } },
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
  /**
   * Read-then-create, so two people starting a list in the same instant can
   * ask for the same number. The loser used to get a 500 -- and on the
   * receive path that 500 landed AFTER the packs had been posted and the
   * lines rewritten, losing the record of what was still coming. Retrying
   * the number is enough: the second read sees the first one's row.
   */
  private async withNumber<T>(make: (requestNumber: string) => Promise<T>, next: () => Promise<string>): Promise<T> {
    for (let tries = 0; ; tries++) {
      try {
        return await make(await next());
      } catch (err) {
        const clash = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && tries < 4;
        if (!clash) throw err;
        this.logger.warn(`[procure] control number taken; trying the next one (attempt ${tries + 2})`);
      }
    }
  }

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
