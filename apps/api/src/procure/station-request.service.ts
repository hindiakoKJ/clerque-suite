import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, RawMaterialCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { manilaDayStart, usedByDay } from '../ingredient-reports/daily-usage';
import { heldAt, heldUsage } from '../orders/held-usage';
import { manilaDayLabel } from '../telegram/messages';
import type { StationContext } from '../kds/station-access';
import { ProcureService, afterHeld, amountWords, namesInWords, onTheWay } from './procure.service';
import { readTag, withTag } from './procure-notes';
import {
  HistoryDay, PlanItem, PlanResult, SENT_LIST_HOURS, STARTING_AMOUNT_WHY, addDays, closingSentSince, historyFromUsage, planRequest,
  plannedDayFor,
} from './station-request-plan';

/** What the closing job did for one branch. */
export type ClosingListResult = 'SENT' | 'ALREADY_SENT' | 'NO_OWNER' | 'SKIPPED';

/** A new item a station may create: always a supply, never an ingredient (that is the owner's, with its cost). */
export const SUPPLY_CATEGORIES = ['KITCHEN_SUPPLY', 'BAR_SUPPLY', 'OFFICE_SUPPLY'] as const;
export const EXTRA_UNITS = ['pc', 'pack', 'box', 'roll', 'g', 'kg', 'ml', 'L'] as const;
export const MAX_EXTRAS = 20;
export const MAX_EXTRA_QTY = 1_000_000;

/** Something added by hand with "+": an item already in the list, or a new one. */
export interface StationExtra {
  rawMaterialId?: string;
  newItem?: { name: string; category: string; unit: string };
  qty: number;
}

/** Who is asking, for which branch, and how they are named in messages. */
export interface RequestContext {
  tenantId: string;
  branchId: string;
  branchName: string;
  /** KITCHEN, BAR ... ; null for the closing job. */
  stationKind: string | null;
  stationName: string | null;
  /** The person, or the person who paired the screen; null for the closing job. */
  actorId: string | null;
  /** Who a list created by this tap is recorded as created by. */
  createdById: string;
  /** "Kitchen screen", a person's name, or "Clerque at closing time". */
  byLabel: string;
  source: 'STATION' | 'CLOSING';
}

export type RequestOutcome = 'SENT' | 'UPDATED' | 'NOTHING_NEW' | 'ALREADY_SENT';

/**
 * What the screen shows. Built here field by field and never from a database
 * row, so no cost can ride along: the kitchen does not see what the shop pays.
 */
export interface StationRequestView {
  plannedFor: string;
  plannedForLabel: string;
  request: { id: string; requestNumber: string; status: string } | null;
  added: Array<{ rawMaterialId: string; name: string; amount: string; why: string[] }>;
  raised: Array<{ rawMaterialId: string; name: string; amount: string; was: string; why: string[] }>;
  /** Lines on the list this tap left as they were. */
  unchanged: number;
  onTheWay: Array<{ name: string; amount: string }>;
  toMake: Array<{ name: string; batches: number }>;
  check: Array<{ name: string; reason: string }>;
  /**
   * Too little sales history to forecast from (the first days): only reorder
   * levels and "+" put anything on the list, so the screen says so instead of
   * letting an empty list read as an all-clear.
   */
  learning: boolean;
}

export interface StationRequestResult extends StationRequestView {
  outcome: RequestOutcome;
  message: string;
  sentTo: string[];
}

export interface StationRequestPreview extends StationRequestView {
  stationKind: string | null;
  /** What "+" can pick: every active item that is bought, not made. */
  pickable: Array<{ rawMaterialId: string; name: string; unit: string; category: string; packSize: number | null }>;
}

/** The station's context in the words this service uses. */
export function requestContextOf(ctx: StationContext): RequestContext {
  return {
    tenantId:    ctx.tenantId,
    branchId:    ctx.branch.id,
    branchName:  ctx.branch.name,
    stationKind: ctx.station.kind,
    stationName: ctx.station.name,
    actorId:     ctx.actorId,
    createdById: ctx.actorId,
    byLabel:     ctx.actorLabel,
    source:      'STATION',
  };
}

/** How long the usage history is reused: it only changes when a day ends. */
const HISTORY_TTL_MS = 30 * 60 * 1000;
/** A request-number clash with the Procure screen is retried this many times. */
const CLASH_RETRIES = 3;

type Db = Prisma.TransactionClient | PrismaService;

const LIST_SELECT = {
  id: true, requestNumber: true, status: true, notes: true,
  lines: { select: { id: true, rawMaterialId: true, lineNumber: true, qtyRequested: true } },
} satisfies Prisma.PurchaseRequestSelect;
type ChosenList = Prisma.PurchaseRequestGetPayload<{ select: typeof LIST_SELECT }>;

const ITEM_SELECT = {
  id: true, name: true, unit: true, category: true, batchYield: true, lowStockAlert: true, isActive: true,
  subRecipeItems: { select: { id: true }, take: 1 },
} satisfies Prisma.RawMaterialSelect;
type ItemRow = Prisma.RawMaterialGetPayload<{ select: typeof ITEM_SELECT }>;

/** What the plan needs that does not move within a tap: read once, outside the transaction. */
interface Catalogue {
  items: ItemRow[];
  recipes: Array<{ parentId: string; componentId: string; qty: number }>;
  inRecipe: Set<string>;
  packs: Map<string, number>;
}

interface TxOutcome {
  outcome: RequestOutcome;
  list: ChosenList | null;
  plan: PlanResult | null;
  changes: Array<{ rawMaterialId: string; was: number | null }>;
  newIds: string[];
  /** Lines on the list after this tap. */
  lineCount: number;
}

/**
 * "Request what's running low" from the kitchen or bar screen, and the
 * closing-time fail-safe that sends the list when nobody tapped.
 *
 * One list per branch. The kitchen's tap and the bar's tap land on the same
 * list, which is sent to the owners -- the list Procure already keeps, not a
 * second one. A tap that finds nothing new sends nothing, so tapping twice
 * never tells the owner twice.
 */
@Injectable()
export class StationRequestService {
  private readonly logger = new Logger(StationRequestService.name);
  private readonly historyCache = new Map<string, { at: number; history: HistoryDay[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly procure: ProcureService,
  ) {}

  // ── the fail-safe at closing ──────────────────────────────────────────────

  /**
   * At closing, a branch whose list for the next shopping did not go out gets
   * it sent anyway -- the all-clear too, when nothing is low, because silence
   * cannot be told apart from a screen nobody tapped. "Went out" is a buy list
   * sent since planning for that shopping began (closingSentSince; see
   * buyListSentSince for what counts as a buy list). Never throws: the
   * end-of-day job runs every branch in one loop.
   */
  async sendAtClosingIfNothingSent(
    branch: { id: string; tenantId: string; name: string },
    /*
      The end-of-day job's due sheet. `closedAt` (the closing) or `to` (the
      moment the day's sheet fell due, as reportDue returns it) only matters
      for a closing before 10:00; either will do, and neither is required.
    */
    due: { day: string; closedAt?: Date; to?: Date },
    now: Date,
  ): Promise<ClosingListResult> {
    try {
      const since = closingSentSince(now, due.day, due.closedAt ?? due.to ?? null);
      // A cheap look first: this runs every five minutes for hours after closing.
      if (await this.buyListSentSince(this.prisma, branch.tenantId, branch.id, since)) return 'ALREADY_SENT';
      const owner = await this.prisma.user.findFirst({
        where:   { tenantId: branch.tenantId, role: 'BUSINESS_OWNER', isActive: true },
        orderBy: { createdAt: 'asc' },
        select:  { id: true },
      });
      if (!owner) return 'NO_OWNER';
      const r = await this.apply({
        tenantId: branch.tenantId, branchId: branch.id, branchName: branch.name,
        stationKind: null, stationName: null, actorId: null, createdById: owner.id,
        byLabel: 'Clerque at closing time', source: 'CLOSING',
      }, [], now, { onlyIfNothingSentSince: since });
      return r.outcome === 'SENT' || r.outcome === 'UPDATED' ? 'SENT' : 'ALREADY_SENT';
    } catch (err) {
      this.logger.error(`Closing buy list failed for branch ${branch.id} (shop ${branch.tenantId}), day ${due.day}: ${err instanceof Error ? err.message : err}`);
      return 'SKIPPED';
    }
  }

  // ── the dry run behind the screen's "+" ───────────────────────────────────

  /** What a tap would do now, and what "+" can pick. Writes nothing. */
  async preview(ctx: RequestContext, now: Date = new Date()): Promise<StationRequestPreview> {
    const { today, plannedDay } = plannedDayFor(now);
    const [history, cat] = await Promise.all([
      this.history(ctx.tenantId, ctx.branchId, plannedDay, today),
      this.catalogue(ctx.tenantId),
    ]);
    const list = await this.pickList(this.prisma, ctx, now);
    const plan = await this.plan(this.prisma, ctx, now, today, plannedDay, history, cat, list, new Map(), []);
    const raised = plan.lines.filter((l) => l.action === 'RAISE');
    return {
      ...this.view(plan, list, plan.lines.filter((l) => l.action === 'ADD').map((l) => ({ rawMaterialId: l.rawMaterialId, was: null })),
        raised.map((l) => ({ rawMaterialId: l.rawMaterialId, was: l.existing })), (list?.lines.length ?? 0) - raised.length),
      stationKind: ctx.stationKind,
      pickable: cat.items
        .filter((i) => i.isActive && i.subRecipeItems.length === 0)
        .map((i) => ({ rawMaterialId: i.id, name: i.name, unit: i.unit, category: String(i.category), packSize: cat.packs.get(i.id) ?? null }))
        // By name as a person reads it, whatever the database's collation does with case.
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  // ── a tap ─────────────────────────────────────────────────────────────────

  async apply(
    ctx: RequestContext,
    extras: StationExtra[],
    now: Date = new Date(),
    opts: { onlyIfNothingSentSince?: Date } = {},
  ): Promise<StationRequestResult> {
    const asked = this.checkExtras(extras ?? []);
    const { today, plannedDay } = plannedDayFor(now);
    // The slow reads, outside the transaction, so the lock is held for the writes and not for a month of sales.
    const [history, cat] = await Promise.all([
      this.history(ctx.tenantId, ctx.branchId, plannedDay, today),
      this.catalogue(ctx.tenantId),
    ]);

    let done: TxOutcome;
    for (let attempt = 0; ; attempt++) {
      try {
        done = await this.prisma.$transaction(
          (tx) => this.applyInTx(tx, ctx, asked, now, today, plannedDay, history, cat, opts),
          { timeout: 30_000 },
        );
        break;
      } catch (err) {
        // Two lists started in the same instant (this and the Procure screen) can ask for one number.
        const clash = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < CLASH_RETRIES;
        if (!clash) throw err;
        this.logger.warn(`Buy list number taken for branch ${ctx.branchId}; trying again (attempt ${attempt + 2})`);
      }
    }

    const { outcome, list, plan, changes, newIds } = done;
    let names: string[] = [];
    if (list && (outcome === 'SENT' || outcome === 'UPDATED')) {
      try {
        const full = await this.prisma.purchaseRequest.findFirst({
          where: { id: list.id, tenantId: ctx.tenantId }, include: this.procure.lineInclude(),
        });
        if (full) {
          const newItems = newIds.length > 0 && ctx.stationName ? { ids: newIds, screen: `${ctx.stationName} screen` } : null;
          // Lines this tap added at a starting amount: the owner is told it is a guess, not a forecast.
          const addedIds = new Set(changes.filter((c) => c.was == null).map((c) => c.rawMaterialId));
          const startingIds = (plan?.lines ?? [])
            .filter((l) => addedIds.has(l.rawMaterialId) && l.why.includes(STARTING_AMOUNT_WHY))
            .map((l) => l.rawMaterialId);
          const starting = startingIds.length > 0 ? { startingIds } : {};
          if (outcome === 'SENT') {
            // The copy for the group chat, filed as it was when the list went out.
            const pdf = await this.procure.fileRequestPdf(ctx.tenantId, list.id, 'sent', ctx.actorId ?? ctx.createdById);
            names = await this.procure.tellTheOwners(ctx.tenantId, full, pdf, ctx.actorId, { byLabel: ctx.byLabel, newItems, ...starting });
          } else {
            names = await this.procure.tellTheOwners(ctx.tenantId, full, null, ctx.actorId, {
              mode: 'updated', changed: changes, byLabel: ctx.byLabel, newItems, ...starting,
            });
          }
        }
      } catch (err) {
        // The list is saved and sent; only telling people about it failed.
        this.logger.warn(`Could not tell the owners about buy list ${list.requestNumber}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const added = changes.filter((c) => c.was == null);
    const raised = changes.filter((c) => c.was != null);
    const view = plan
      ? this.view(plan, list, added, raised, done.lineCount - added.length - raised.length)
      : this.emptyView(plannedDay, list);
    const learning = plan?.learning ?? false;
    return { outcome, message: this.messageFor(outcome, list, names, done.lineCount, changes.length, learning), sentTo: names, ...view };
  }

  private async applyInTx(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    extras: StationExtra[],
    now: Date,
    today: string,
    plannedDay: string,
    history: HistoryDay[],
    cat: Catalogue,
    opts: { onlyIfNothingSentSince?: Date },
  ): Promise<TxOutcome> {
    const { tenantId, branchId } = ctx;
    /*
      Kitchen taps, bar taps and the closing job queue here, one at a time per
      branch. Without it two screens tapping together each find no list, each
      start one, and the owner gets two lists and two bells.
    */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`procure-list:${tenantId}:${branchId}`}))`;

    // The same rule as the closing job's quick look, asked again under the lock.
    if (opts.onlyIfNothingSentSince && await this.buyListSentSince(tx, tenantId, branchId, opts.onlyIfNothingSentSince)) {
      return { outcome: 'ALREADY_SENT', list: null, plan: null, changes: [], newIds: [], lineCount: 0 };
    }

    let list = await this.pickList(tx, ctx, now);
    const hand = await this.resolveExtras(tx, tenantId, extras);
    const plan = await this.plan(tx, ctx, now, today, plannedDay, history, cat, list, hand.byHand, hand.rows);
    const toWrite = plan.lines.filter((l) => l.action !== 'KEEP');

    if (!list) {
      // A tap with nothing to ask starts no list. The closing job does: its all-clear is the point.
      if (toWrite.length === 0 && extras.length === 0 && ctx.source === 'STATION') {
        return { outcome: 'NOTHING_NEW', list: null, plan, changes: [], newIds: hand.newIds, lineCount: 0 };
      }
      const requestNumber = await this.procure.nextRequestNumber(tenantId);
      list = await tx.purchaseRequest.create({
        data:   { tenantId, branchId, requestNumber, createdById: ctx.createdById },
        select: LIST_SELECT,
      });
    }

    const changes: TxOutcome['changes'] = [];
    const linesSoFar = list.lines.map((l) => ({ lineNumber: l.lineNumber }));
    for (const line of toWrite) {
      const row = list.lines.find((l) => l.rawMaterialId === line.rawMaterialId);
      if (line.action === 'RAISE' && row) {
        await tx.purchaseRequestLine.update({
          where: { id: row.id },
          data:  {
            qtyRequested: new Prisma.Decimal(line.qty),
            ...(line.shortBy != null ? { shortBy: new Prisma.Decimal(line.shortBy) } : {}),
          },
        });
        changes.push({ rawMaterialId: line.rawMaterialId, was: Number(row.qtyRequested) });
      } else if (!row) {
        const lineNumber = this.procure.nextLineNumber(list.requestNumber, linesSoFar);
        linesSoFar.push({ lineNumber });
        await tx.purchaseRequestLine.create({
          data: {
            purchaseRequestId: list.id,
            lineNumber,
            rawMaterialId: line.rawMaterialId,
            qtyRequested:  new Prisma.Decimal(line.qty),
            shortBy:       line.shortBy != null ? new Prisma.Decimal(line.shortBy) : null,
          },
        });
        changes.push({ rawMaterialId: line.rawMaterialId, was: null });
      }
    }
    const lineCount = list.lines.length + changes.filter((c) => c.was == null).length;

    // Which day the list is for, and which screens (or the closing job) asked.
    const askedBy = new Set((readTag(list.notes, 'ASKED') ?? '').split(' ').filter(Boolean));
    askedBy.add(ctx.stationKind ?? 'CLOSING');
    const notes = withTag(withTag(list.notes, 'PLAN', plan.plannedDay), 'ASKED', [...askedBy].join(' '));

    let outcome: RequestOutcome;
    if (list.status === 'OPEN') {
      if (lineCount === 0 && ctx.source === 'STATION') {
        return { outcome: 'NOTHING_NEW', list, plan, changes, newIds: hand.newIds, lineCount };
      }
      // Guarded on the status, so a list the Procure screen sent a moment ago is not sent a second time.
      const flipped = await tx.purchaseRequest.updateMany({
        where: { id: list.id, status: 'OPEN' },
        data:  { status: 'SENT', sentAt: now, sentById: ctx.actorId, notes },
      });
      if (flipped.count === 1) {
        outcome = 'SENT';
        list = { ...list, status: 'SENT', notes };
      } else {
        if (notes !== list.notes) await tx.purchaseRequest.update({ where: { id: list.id }, data: { notes } });
        outcome = changes.length > 0 ? 'UPDATED' : 'NOTHING_NEW';
      }
    } else {
      if (notes !== list.notes) await tx.purchaseRequest.update({ where: { id: list.id }, data: { notes } });
      outcome = changes.length > 0 ? 'UPDATED' : 'NOTHING_NEW';
    }
    return { outcome, list, plan, changes, newIds: hand.newIds, lineCount };
  }

  // ── reading ───────────────────────────────────────────────────────────────

  /**
   * Whether a buy list for the next shopping already went out at this branch
   * since `since`.
   *
   * Only a list that asked for shopping counts: one sent by a kitchen or bar
   * tap, by the closing job or by Procure's own Send, each of which stamps
   * [PLAN:<day>]. Other paths create a request already sent or bought, stamped
   * with the moment it was made, without asking anyone to buy anything: a
   * receipt posted in Procure > Receipts, a purchase uploaded from the
   * buy-lists sheet, the balance of a short delivery. Counted, any of them
   * posted after 10:00 made the closing job think tomorrow's list had gone,
   * and the owner got neither the list nor the all-clear.
   *
   * The database narrows the read; the tag is then read exactly, from the run
   * of tags at the front of the notes, so a bracket somewhere in a vendor's
   * name cannot pass for it.
   */
  private async buyListSentSince(db: Db, tenantId: string, branchId: string, since: Date): Promise<boolean> {
    const rows = await db.purchaseRequest.findMany({
      where:  { tenantId, branchId, status: { not: 'CANCELLED' }, sentAt: { gte: since }, notes: { contains: '[PLAN:' } },
      select: { notes: true },
    });
    return rows.some((r) => readTag(r.notes, 'PLAN') != null);
  }

  /**
   * The list a tap adds to: one sent in the last 18 hours that nobody has
   * started buying (the shopper has not left yet), else the open one.
   */
  private async pickList(db: Db, ctx: RequestContext, now: Date): Promise<ChosenList | null> {
    const sent = await db.purchaseRequest.findFirst({
      where: {
        tenantId: ctx.tenantId, branchId: ctx.branchId, status: 'SENT',
        sentAt: { gte: new Date(now.getTime() - SENT_LIST_HOURS * 3_600_000) },
        lines: { none: { OR: [{ packsBought: { not: null } }, { receivedAt: { not: null } }] } },
      },
      orderBy: { sentAt: 'desc' },
      select:  LIST_SELECT,
    });
    if (sent) return sent;
    return db.purchaseRequest.findFirst({
      where:   { tenantId: ctx.tenantId, branchId: ctx.branchId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      select:  LIST_SELECT,
    });
  }

  /** Stock, holds and what is coming -- the numbers that move with every sale -- then the plan. */
  private async plan(
    db: Db,
    ctx: RequestContext,
    now: Date,
    today: string,
    plannedDay: string,
    history: HistoryDay[],
    cat: Catalogue,
    list: ChosenList | null,
    byHand: Map<string, number>,
    handRows: ItemRow[],
  ): Promise<PlanResult> {
    const { tenantId, branchId } = ctx;
    // One after another: inside a transaction every query shares one connection anyway.
    const stock = await db.rawMaterialInventory.findMany({ where: { tenantId, branchId }, select: { rawMaterialId: true, quantity: true } });
    const held = await heldUsage(db, tenantId, [branchId]);
    // The chosen list is compared line by line below, so it is not also "on the way".
    const coming = await onTheWay(db, tenantId, branchId, list?.id);
    const book = new Map(stock.map((s) => [s.rawMaterialId, Number(s.quantity)]));

    // A hand-added item created or found just now is planned like the rest.
    const known = new Set(cat.items.map((i) => i.id));
    const rows = [...cat.items, ...handRows.filter((h) => !known.has(h.id))];
    const items: PlanItem[] = rows.map((r) => ({
      id:             r.id,
      name:           r.name,
      unit:           r.unit,
      category:       String(r.category),
      isPrep:         r.subRecipeItems.length > 0,
      batchYield:     r.batchYield != null ? Number(r.batchYield) : null,
      lowStockAlert:  r.lowStockAlert != null ? Number(r.lowStockAlert) : null,
      available:      afterHeld(book.get(r.id) ?? 0, heldAt(held, branchId, r.id)),
      packSize:       cat.packs.get(r.id) ?? null,
      inActiveRecipe: cat.inRecipe.has(r.id),
    }));

    const plan = planRequest({
      now, plannedDay, today, history, items, recipes: cat.recipes,
      onTheWay: new Map([...coming].map(([id, c]) => [id, c.quantity])),
      existing: new Map((list?.lines ?? []).map((l) => [l.rawMaterialId, Number(l.qtyRequested)])),
      extras:   byHand,
      extraReason: ctx.stationName ? `Added by hand on the ${ctx.stationName} screen` : 'Added by hand',
      // Only a tap guesses a starting amount; the closing job leaves those items under "check".
      startingAmounts: ctx.source === 'STATION',
    });
    if (plan.cycle.length > 0) {
      this.logger.warn(`Preps whose recipes loop into each other were left out of the buy list plan (shop ${tenantId}): ${plan.cycle.join(', ')}`);
    }
    return plan;
  }

  /**
   * What each open day used over the last four weeks, sold plus wasted.
   * Kept for half an hour: a month of sales is the slow read, and only the
   * day that is still going changes it -- and today is not in it.
   */
  private async history(tenantId: string, branchId: string, plannedDay: string, today: string): Promise<HistoryDay[]> {
    const key = `${tenantId}:${branchId}:${plannedDay}:${today}`;
    const at = Date.now();
    const kept = this.historyCache.get(key);
    if (kept && at - kept.at < HISTORY_TTL_MS) return kept.history;
    const usage = await usedByDay(this.prisma, tenantId, branchId, manilaDayStart(addDays(plannedDay, -28)), manilaDayStart(today));
    const history = historyFromUsage(usage.days);
    for (const [k, v] of this.historyCache) if (at - v.at >= HISTORY_TTL_MS) this.historyCache.delete(k);
    this.historyCache.set(key, { at, history });
    return history;
  }

  /** Every active item, the prep recipes, what the menu uses, and the last pack size of each. */
  private async catalogue(tenantId: string): Promise<Catalogue> {
    const [items, links, bom, sizes, addOns] = await Promise.all([
      this.prisma.rawMaterial.findMany({ where: { tenantId, isActive: true }, select: ITEM_SELECT, orderBy: { name: 'asc' } }),
      this.prisma.subRecipeItem.findMany({
        where:  { parent: { tenantId, isActive: true } },
        select: { parentRawMaterialId: true, rawMaterialId: true, quantity: true },
      }),
      this.prisma.bomItem.findMany({
        where: { product: { tenantId, isActive: true } }, select: { rawMaterialId: true }, distinct: ['rawMaterialId'],
      }),
      this.prisma.variantBomItem.findMany({
        where: { variant: { isActive: true, product: { tenantId, isActive: true } } }, select: { rawMaterialId: true }, distinct: ['rawMaterialId'],
      }),
      this.prisma.modifierOptionIngredient.findMany({
        where:  { quantity: { gt: 0 }, option: { isActive: true, group: { tenantId, isActive: true } } },
        select: { rawMaterialId: true }, distinct: ['rawMaterialId'],
      }),
    ]);
    const recipes = links.map((l) => ({ parentId: l.parentRawMaterialId, componentId: l.rawMaterialId, qty: Number(l.quantity) }));

    // On the menu: in a dish, a size or an add-on -- or in a prep that is, however deep.
    const partsOf = new Map<string, string[]>();
    for (const r of recipes) partsOf.set(r.parentId, [...(partsOf.get(r.parentId) ?? []), r.componentId]);
    const inRecipe = new Set([...bom, ...sizes, ...addOns].map((r) => r.rawMaterialId));
    const walk = [...inRecipe];
    while (walk.length > 0) {
      for (const part of partsOf.get(walk.pop()!) ?? []) {
        if (!inRecipe.has(part)) { inRecipe.add(part); walk.push(part); }
      }
    }

    const bought = items.filter((i) => i.subRecipeItems.length === 0).map((i) => i.id);
    const packs = new Map([...(await this.procure.lastPacks(tenantId, bought))].map(([id, p]) => [id, p.packSize]));
    return { items, recipes, inRecipe, packs };
  }

  // ── "+" ───────────────────────────────────────────────────────────────────

  /** The same limits the screen's form keeps, for callers that are not the screen. */
  private checkExtras(extras: StationExtra[]): StationExtra[] {
    if (!Array.isArray(extras)) return [];
    if (extras.length > MAX_EXTRAS) throw new BadRequestException(`Add at most ${MAX_EXTRAS} items at a time.`);
    return extras.map((e) => {
      if (!(typeof e?.qty === 'number' && Number.isFinite(e.qty) && e.qty > 0 && e.qty <= MAX_EXTRA_QTY)) {
        throw new BadRequestException('Each added item needs an amount above 0.');
      }
      if (!!e.rawMaterialId === !!e.newItem) {
        throw new BadRequestException('Each added item needs either an item from the list or a new item, not both.');
      }
      if (e.newItem) {
        const name = String(e.newItem.name ?? '').trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > 80) throw new BadRequestException('A new item name has to be 2 to 80 characters.');
        if (!(SUPPLY_CATEGORIES as readonly string[]).includes(e.newItem.category)) {
          throw new BadRequestException('A new item is a kitchen, bar or office supply. Ingredients are added by the owner.');
        }
        if (!(EXTRA_UNITS as readonly string[]).includes(e.newItem.unit)) {
          throw new BadRequestException(`The unit has to be one of ${EXTRA_UNITS.join(', ')}.`);
        }
        return { newItem: { name, category: e.newItem.category, unit: e.newItem.unit }, qty: e.qty };
      }
      return { rawMaterialId: e.rawMaterialId, qty: e.qty };
    });
  }

  /**
   * Each hand-added item as an item row, creating a new supply when no item
   * of that name exists. Inside the transaction, so two screens adding
   * "Tissue roll" together make one item, not two.
   */
  private async resolveExtras(tx: Prisma.TransactionClient, tenantId: string, extras: StationExtra[]) {
    const byHand = new Map<string, number>();
    const rows: ItemRow[] = [];
    const newIds: string[] = [];
    for (const e of extras) {
      let rm: ItemRow | null;
      if (e.rawMaterialId) {
        rm = await tx.rawMaterial.findFirst({ where: { id: e.rawMaterialId, tenantId }, select: ITEM_SELECT });
        if (!rm) throw new BadRequestException('That item is not in your item list.');
      } else {
        const item = e.newItem!;
        // A twin by name, whatever its case, is the same thing: two records would split its stock.
        rm = await tx.rawMaterial.findFirst({
          where:   { tenantId, name: { equals: item.name, mode: 'insensitive' } },
          orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
          select:  ITEM_SELECT,
        });
        if (!rm) {
          rm = await tx.rawMaterial.create({
            // No cost and no reorder level: the owner sets those. A station never creates an ingredient.
            data:   { tenantId, name: item.name, unit: item.unit, category: item.category as RawMaterialCategory, costPrice: null, lowStockAlert: null },
            select: ITEM_SELECT,
          });
          newIds.push(rm.id);
        }
      }
      if (rm.subRecipeItems.length > 0) {
        throw new BadRequestException(`${rm.name} is made in the kitchen, not bought. Use the prep column.`);
      }
      if (!rm.isActive) {
        throw new BadRequestException(`${rm.name} is switched off in your item list. Ask the owner to turn it back on.`);
      }
      byHand.set(rm.id, Math.max(byHand.get(rm.id) ?? 0, e.qty));
      if (!rows.some((r) => r.id === rm!.id)) rows.push(rm);
    }
    return { byHand, rows, newIds };
  }

  // ── what the screen is told ───────────────────────────────────────────────

  private view(
    plan: PlanResult,
    list: ChosenList | null,
    added: Array<{ rawMaterialId: string; was: number | null }>,
    raised: Array<{ rawMaterialId: string; was: number | null }>,
    unchanged: number,
  ): StationRequestView {
    const lineOf = new Map(plan.lines.map((l) => [l.rawMaterialId, l]));
    const words = (id: string) => {
      const l = lineOf.get(id);
      return l ? { rawMaterialId: id, name: l.name, amount: amountWords(l.qty, l.unit, l.packSize), why: l.why } : null;
    };
    return {
      ...this.emptyView(plan.plannedDay, list),
      learning: plan.learning,
      added:  added.map((c) => words(c.rawMaterialId)).filter((w): w is NonNullable<typeof w> => w != null),
      raised: raised.flatMap((c) => {
        const w = words(c.rawMaterialId);
        const l = lineOf.get(c.rawMaterialId);
        return w && l && c.was != null ? [{ ...w, was: amountWords(c.was, l.unit, l.packSize) }] : [];
      }),
      unchanged: Math.max(0, unchanged),
      onTheWay:  plan.onTheWay.map((o) => ({ name: o.name, amount: amountWords(o.qty, o.unit, o.packSize) })),
      toMake:    plan.toMake.map((t) => ({ name: t.name, batches: t.batches })),
      check:     plan.check.map((c) => ({ name: c.name, reason: c.reason })),
    };
  }

  private emptyView(plannedDay: string, list: ChosenList | null): StationRequestView {
    return {
      plannedFor: plannedDay,
      plannedForLabel: manilaDayLabel(plannedDay),
      request: list ? { id: list.id, requestNumber: list.requestNumber, status: String(list.status) } : null,
      added: [], raised: [], unchanged: 0, onTheWay: [], toMake: [], check: [], learning: false,
    };
  }

  /**
   * What the screen says. While Clerque is still learning the shop's usage an
   * empty list is never called an all-clear: the forecast cannot see what is
   * low yet, and the screen's own note says to add it with "+".
   */
  private messageFor(outcome: RequestOutcome, list: ChosenList | null, names: string[], lineCount: number, changed: number, learning = false): string {
    const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
    const told = names.length > 0 ? namesInWords(names) : null;
    switch (outcome) {
      case 'SENT':
        if (!told) return 'Saved as sent, but no owner or manager account was found to tell.';
        if (lineCount > 0) return `Sent to ${told}. ${items(lineCount)} on the list.`;
        return learning ? `Sent to ${told} with nothing on the list yet.` : `Sent the all-clear to ${told}. Nothing is running low.`;
      case 'UPDATED':
        return told
          ? `Added ${items(changed)}. ${told} ${names.length === 1 ? 'was' : 'were'} told.`
          : `Added ${items(changed)}. No owner or manager account was found to tell.`;
      case 'ALREADY_SENT':
        return 'A list already went out today.';
      default:
        if (list && list.status !== 'OPEN') return 'Already sent. Nothing new.';
        return learning ? 'Nothing was sent.' : 'Nothing is running low. Nothing was sent.';
    }
  }
}
