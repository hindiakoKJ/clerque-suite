import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { CycleCountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { StationContext } from '../kds/station-access';
import { heldAt, heldUsage, HOLDING_STATUSES, WAITING_LINE } from '../orders/held-usage';
import { DAY_MS, manilaDayOf } from '../ingredient-reports/daily-usage';
import { StationItems, stationItems, UNROUTED } from '../ingredient-reports/station-items';
import { SECTION_ORDER, SECTION_TITLES, SectionKey, sheetAmount, sheetPackSizes } from '../ingredient-reports/stock-sheet';
import { WarehouseService } from '../warehouse/warehouse.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramAlertsService } from '../telegram/telegram-alerts.service';
import { afterHeld, namesInWords } from './procure.service';
import { appendNote, plainNotes } from './procure-notes';
import {
  ABANDONED_AFTER_DAYS, COUNTED_ELSEWHERE_DAYS, COUNT_QTY_MAX, DifferenceKind, MATCH_BELOW, RECOUNT_MAX, SentLine, WEEKLY_PREFIX,
  cleanCounterName, countLineWords, daysBetween, differenceOf, doneEntries, dueMessage, dueState, lastWeeklySend, lineNotes, monthDay,
  readLineTags, readWeekly, recountAskedBy, recountIds, recountedIds, round3, weeklyCountBellBody, weeklyCountNotes, whenLabel,
  withDone, withRecount, withRecountAskedBy, withRecounted,
} from './weekly-count';

// ── what the station screen is told ─────────────────────────────────────────
//
// Built field by field, never from a database row: no expected figure, no
// variance, no book, cost, price or value ever reaches a kitchen or bar screen.

export type PanelState = 'NEW' | 'COUNTING' | 'SENT';

export interface StationCountRow {
  rawMaterialId: string;
  name: string;
  unit: string;
  packSize: number | null;
  alsoOn: string[];
  /** What this station counted: in the count going on now, or -- once sent today -- in the record it sent. */
  counted: number | null;
  countedWords: string | null;
  countedBy: string | null;
  countedAt: string | null;
  /** The owner asked for this item to be counted again. */
  recount: boolean;
  /** A shared item another station counted in the last 3 days: "Kitchen counted: 2 pk + 100 ml (Sep 21)". */
  countedElsewhere: { station: string; words: string; on: string; at: string; label: string } | null;
  /** Counts towards "12 of 25 counted". */
  done: boolean;
}

export interface StationCountView {
  station: { id: string; name: string };
  branch: { id: string; name: string };
  state: PanelState;
  count: { countNumber: string; startedOn: string } | null;
  due: { isDue: boolean; lastSentOn: string | null; daysSince: number | null; message: string | null };
  sentAt: string | null;
  sentBy: string | null;
  changedSinceSent: boolean;
  /** "Sent. Counting again starts a new count." while the panel shows what was sent. */
  message: string | null;
  stillWaiting: number;
  recount: { askedFor: string[]; message: string } | null;
  /** Items in the count going on now that answered the owner's recount: when that is all it holds, Send is a recount. */
  recounted: string[];
  progress: { counted: number; total: number };
  sections: Array<{ key: SectionKey; title: string; rows: StationCountRow[] }>;
}

export interface StationCountSaved {
  rawMaterialId: string;
  name: string;
  unit: string;
  counted: number;
  countedWords: string;
  countedBy: string;
  countedAt: string;
  countNumber: string;
  progress: { counted: number; total: number };
  message: string;
}

export interface StationCountSent {
  outcome: 'SENT' | 'ALREADY_SENT';
  message: string;
  sentTo: string[];
  countNumber: string | null;
  progress: { counted: number; total: number };
  notCounted: string[];
}

// ── what the owner is told ──────────────────────────────────────────────────

export const STATUS_BADGE: Record<CycleCountStatus, string> = {
  OPEN:      'Counting now',
  RECORDED:  'Recorded - books not changed',
  POSTED:    'Books adjusted',
  CANCELLED: 'Cancelled',
};

export interface Superseded {
  reason: 'COUNTED_AGAIN' | 'ADJUSTED';
  countNumber: string;
  stationName: string | null;
  on: string;
  at: string;
  message: string;
}

export interface WeeklyCountLineView {
  lineId: string;
  rawMaterialId: string;
  name: string;
  unit: string;
  counted: number;
  /** The book at the moment the item was counted. */
  book: number;
  /** counted - book: below zero is short, above is over. */
  difference: number;
  kind: DifferenceKind;
  words: string;
  inPacks: string;
  countedBy: string | null;
  stationName: string | null;
  countedAt: string | null;
  /** "2 pk + 100 ml · Kitchen screen (Joy) · Sep 21 9:05 PM". */
  detail: string;
  superseded: Superseded | null;
  alsoOpenIn: string[];
  recount: boolean;
}

export interface WeeklyCountReview {
  id: string;
  countNumber: string;
  status: CycleCountStatus;
  badge: string;
  statusLine: string;
  branch: { id: string; name: string };
  station: { id: string; name: string } | null;
  startedOn: string;
  recordedAt: string | null;
  recordedBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
  stations: Array<{
    id: string; name: string; sentAt: string | null; countedBy: string | null; counted: number; total: number;
    notCounted: Array<{ rawMaterialId: string; name: string }>;
  }>;
  lines: WeeklyCountLineView[];
  summary: { lines: number; differ: number; short: number; over: number; superseded: number };
  recountAsked: string[];
  recountAskedBy: string | null;
  actions: { canAdjust: boolean; canAskRecount: boolean };
  notes: string;
}

export interface WeeklyCountAdjusted extends WeeklyCountReview {
  adjusted: number;
  skipped: string[];
  warnings: string[];
}

export interface WeeklyCountListRow {
  id: string;
  countNumber: string;
  status: CycleCountStatus;
  badge: string;
  branch: { id: string; name: string };
  station: { id: string; name: string } | null;
  startedOn: string | null;
  sentAt: string | null;
  sentBy: string | null;
  postedAt: string | null;
  lines: number;
  differ: number;
  recountAsked: number;
  notes: string;
}

/** Whose counts an owner-side call may see: the shop's, or one branch's for a manager tied to it. */
export interface ReviewScope { tenantId: string; ownBranchId: string | null }

// ── internals ───────────────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | PrismaService;

/** A number clash with the counts screen or a buy list is retried this many times. */
const CLASH_RETRIES = 3;
const NOTE_MAX = 200;

const COUNT_SELECT = {
  id: true, countNumber: true, status: true, notes: true, createdAt: true,
  lines: { select: { id: true, rawMaterialId: true, countedQty: true, expectedQty: true, notes: true } },
} satisfies Prisma.CycleCountSelect;
type CountRow = Prisma.CycleCountGetPayload<{ select: typeof COUNT_SELECT }>;

const REVIEW_SELECT = {
  id: true, tenantId: true, branchId: true, countNumber: true, status: true, notes: true,
  createdAt: true, updatedAt: true, postedAt: true, postedById: true,
  branch: { select: { id: true, name: true } },
  lines: {
    select: {
      id: true, rawMaterialId: true, countedQty: true, expectedQty: true, varianceQty: true, notes: true,
      rawMaterial: { select: { name: true, unit: true } },
    },
  },
} satisfies Prisma.CycleCountSelect;
type ReviewRow = Prisma.CycleCountGetPayload<{ select: typeof REVIEW_SELECT }>;

/** One item a station's sheet shows, where it shows it. */
interface SheetItem { id: string; name: string; unit: string; section: SectionKey; alsoOn: string[]; packSize: number | null }

const lockKey = (tenantId: string, branchId: string, stationId: string) => `weekly-count:${tenantId}:${branchId}:${stationId}`;

/** An OPEN count this old was left, never sent. */
function abandoned(c: { notes: string | null; createdAt: Date }, now: Date): boolean {
  const day = readWeekly(c.notes)?.day ?? manilaDayOf(c.createdAt);
  return daysBetween(day, manilaDayOf(now)) > ABANDONED_AFTER_DAYS;
}

/**
 * The rows a station's sheet shows, by the same rule the sheet and the waste
 * route use (stock-sheet.ts buildSheet, station-waste.controller.ts): items a
 * product routed here uses, and items only unrouted products use.
 */
export function stationSheetItems(catalogue: StationItems, stationId: string): Array<Omit<SheetItem, 'packSize'>> {
  const stationName = new Map(catalogue.stations.map((s) => [s.id, s.name]));
  const out: Array<Omit<SheetItem, 'packSize'>> = [];
  for (const [id, item] of catalogue.items) {
    const onlyUnrouted = item.on.size === 1 && item.on.has(UNROUTED);
    if (!item.on.has(stationId) && !onlyUnrouted) continue;
    const kindSection: SectionKey = item.isPrep ? 'PREMADE' : item.category === 'INGREDIENT' ? 'INGREDIENTS' : 'SUPPLIES';
    out.push({
      id, name: item.name, unit: item.unit,
      section: onlyUnrouted ? 'UNROUTED' : kindSection,
      alsoOn: [...item.on].filter((s) => s !== stationId && s !== UNROUTED).map((s) => stationName.get(s)).filter((n): n is string => !!n).sort(),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The weekly count on a kitchen or bar screen, and the owner's side of it.
 *
 * Staff count the shelf blind: the screen asks what is there and never says
 * what Clerque thinks should be. Each saved line takes a fresh snapshot of
 * the book (live stock less what waiting tickets hold), so a count finished
 * over an hour, or an item counted again days later, never books the sales
 * in between as missing.
 *
 * Send freezes the count as RECORDED -- nothing moves -- and tells the owner
 * and managers. The owner reviews it as a reconciliation and may adjust the
 * books to match, which posts it through the counts screen's own
 * postCycleCount, leaving out any line a later count has since replaced.
 */
@Injectable()
export class StationCountService {
  private readonly logger = new Logger(StationCountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouse: WarehouseService,
    // Optional like every other alert: the count is saved and sent even where these are not wired in.
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly telegram?: TelegramAlertsService,
  ) {}

  // ── the station screen ────────────────────────────────────────────────────

  /** The panel: every item on this station's sheet, what has been counted, and whether a count is due. */
  async view(ctx: StationContext, now: Date = new Date()): Promise<StationCountView> {
    const { tenantId, branch, station } = ctx;
    const [items, lastSend, stillWaiting] = await Promise.all([
      this.sheetItems(tenantId, station.id),
      lastWeeklySend(this.prisma, tenantId, branch.id, station.id),
      // The sheet's own count of lines still at a screen (stock-sheet.ts).
      this.prisma.orderItem.count({
        where: { ...WAITING_LINE, order: { tenantId, branchId: branch.id, deletedAt: null, status: { in: [...HOLDING_STATUSES] } } },
      }),
    ]);
    const panel = await this.panel(this.prisma, ctx, items, now);
    const due = dueState(lastSend?.at ?? null, now);

    const asked = panel.rows.filter((r) => r.recount);
    const askedBy = panel.askedBy ?? 'The owner';
    const sectionOf = new Map(items.map((i) => [i.id, i.section]));
    const bySection = new Map<SectionKey, StationCountRow[]>();
    for (const r of panel.rows) {
      const section = sectionOf.get(r.rawMaterialId)!;
      bySection.set(section, [...(bySection.get(section) ?? []), r]);
    }
    return {
      station: { id: station.id, name: station.name },
      branch: { id: branch.id, name: branch.name },
      state: panel.state,
      count: panel.shown ? { countNumber: panel.shown.countNumber, startedOn: readWeekly(panel.shown.notes)?.day ?? manilaDayOf(panel.shown.createdAt) } : null,
      due: { ...due, message: dueMessage(due.lastSentOn, due.isDue) },
      sentAt: lastSend?.at.toISOString() ?? null,
      sentBy: lastSend?.by ?? null,
      changedSinceSent: panel.state === 'COUNTING' && lastSend != null,
      message: panel.state === 'SENT' ? 'Sent. Counting again starts a new count.' : null,
      stillWaiting,
      recount: asked.length > 0
        ? { askedFor: asked.map((r) => r.rawMaterialId), message: `${askedBy} asked you to count these again: ${asked.map((r) => r.name).join(', ')}.` }
        : null,
      recounted: panel.state === 'COUNTING' && panel.shown ? recountedIds(panel.shown.notes) : [],
      progress: panel.progress,
      sections: SECTION_ORDER
        .filter((key) => (bySection.get(key)?.length ?? 0) > 0)
        .map((key) => ({ key, title: SECTION_TITLES[key], rows: bySection.get(key)! })),
    };
  }

  /**
   * Save one item's count. An upsert, so a retry after the signal dropped
   * writes the same line again and no tap key is needed.
   */
  async save(
    ctx: StationContext,
    input: { rawMaterialId?: unknown; qty?: unknown; by?: unknown } | undefined,
    now: Date = new Date(),
  ): Promise<StationCountSaved> {
    const rawMaterialId = typeof input?.rawMaterialId === 'string' ? input.rawMaterialId.trim() : '';
    if (!rawMaterialId) throw new BadRequestException('Pick the item you counted.');
    const raw = input?.qty;
    if (!(typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= COUNT_QTY_MAX)) {
      throw new BadRequestException('Enter how much is there. Zero is fine when none is left.');
    }
    // The column keeps 3 places (Decimal(12,3)).
    const qty = round3(raw);
    const by = this.counterName(ctx, input?.by);

    const items = await this.sheetItems(ctx.tenantId, ctx.station.id);
    const item = items.find((i) => i.id === rawMaterialId);
    if (!item) throw new ForbiddenException(`That item is not on the ${ctx.station.name} sheet.`);

    let saved: { countNumber: string };
    for (let attempt = 0; ; attempt++) {
      try {
        saved = await this.prisma.$transaction((tx) => this.saveInTx(tx, ctx, item, qty, by, now), { timeout: 30_000 });
        break;
      } catch (err) {
        // Two counts started in the same instant (this and the counts screen, or a buy list) can ask for one number.
        const clash = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < CLASH_RETRIES;
        if (!clash) throw err;
        this.logger.warn(`Count number taken for station ${ctx.station.id}; trying again (attempt ${attempt + 2})`);
      }
    }

    const panel = await this.panel(this.prisma, ctx, items, now);
    const countedWords = sheetAmount(qty, item.unit, item.packSize, 'balance');
    return {
      rawMaterialId: item.id,
      name: item.name,
      unit: item.unit,
      counted: qty,
      countedWords,
      countedBy: by,
      countedAt: now.toISOString(),
      countNumber: saved.countNumber,
      progress: panel.progress,
      message: qty === 0 ? `Saved: ${item.name}, none left.` : `Saved: ${item.name} ${countedWords}.`,
    };
  }

  private async saveInTx(
    tx: Prisma.TransactionClient, ctx: StationContext, item: SheetItem, qty: number, by: string, now: Date,
  ): Promise<{ countNumber: string }> {
    const { tenantId, branch, station } = ctx;
    /*
      One station's saves and sends queue here. CycleCountLine has no unique
      (count, item), so two taps of Save together would otherwise each find
      no line and write two. The other station has its own count and its own
      lock, so the Kitchen and the Bar never wait on each other.
    */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(tenantId, branch.id, station.id)}))`;

    const today = manilaDayOf(now);
    const found = await tx.cycleCount.findFirst({
      where:   { tenantId, branchId: branch.id, status: 'OPEN', notes: { startsWith: WEEKLY_PREFIX, contains: `[ST:${station.id}]` } },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, countNumber: true, notes: true, createdAt: true, _count: { select: { lines: true } } },
    });
    let count: { id: string; countNumber: string; notes: string | null } | null =
      found && readWeekly(found.notes)?.stationId === station.id ? found : null;

    if (found && count && abandoned(found, now)) {
      if (found._count.lines > 0) {
        // Counted and never sent: kept as it is, as a record, and this save starts a new count.
        await tx.cycleCount.update({
          where: { id: found.id },
          data:  { status: 'RECORDED', notes: appendNote(found.notes, 'Never sent; kept as a record.') },
        });
        count = null;
      } else {
        // Started and left empty: nothing to keep, so it simply starts again today.
        const notes = weeklyCountNotes(today, station);
        await tx.cycleCount.update({ where: { id: found.id }, data: { notes } });
        count = { ...found, notes };
      }
    }
    if (!count) {
      const countNumber = await this.warehouse.nextCountNumber(tx, tenantId);
      count = await tx.cycleCount.create({
        data:   { tenantId, branchId: branch.id, countNumber, status: 'OPEN', startedById: ctx.actorId, notes: weeklyCountNotes(today, station) },
        select: { id: true, countNumber: true, notes: true },
      });
    }

    /*
      The book right now, less what waiting tickets hold -- read on every save,
      an overwrite too. Not recordCount's "the snapshot stays": an item
      counted again days later must be measured against the book as it is
      then, or every sale in between reads as missing.
    */
    const live = await tx.rawMaterialInventory.findUnique({
      where:  { branchId_rawMaterialId: { branchId: branch.id, rawMaterialId: item.id } },
      select: { quantity: true },
    });
    const held = await heldUsage(tx, tenantId, [branch.id], { rawMaterialIds: [item.id] });
    const expected = round3(afterHeld(live ? Number(live.quantity) : 0, heldAt(held, branch.id, item.id)));
    const data = {
      expectedQty: new Prisma.Decimal(expected),
      countedQty:  new Prisma.Decimal(qty),
      varianceQty: new Prisma.Decimal(round3(qty - expected)),
      notes:       lineNotes({ by, at: now, stationId: station.id }),
    };
    const existing = await tx.cycleCountLine.findFirst({ where: { countId: count.id, rawMaterialId: item.id }, select: { id: true } });
    if (existing) await tx.cycleCountLine.update({ where: { id: existing.id }, data });
    else await tx.cycleCountLine.create({ data: { countId: count.id, rawMaterialId: item.id, ...data } });

    // Answering a recount: the item comes off the older record's list (its line stays), and this count remembers it.
    const asked = await tx.cycleCount.findMany({
      where: {
        tenantId, branchId: branch.id, status: 'RECORDED',
        AND: [{ notes: { startsWith: WEEKLY_PREFIX } }, { notes: { contains: `[ST:${station.id}]` } }, { notes: { contains: item.id } }],
      },
      select: { id: true, notes: true },
    });
    let answered = false;
    for (const a of asked) {
      const ids = recountIds(a.notes);
      if (readWeekly(a.notes)?.stationId !== station.id || !ids.includes(item.id)) continue;
      await tx.cycleCount.update({ where: { id: a.id }, data: { notes: withRecount(a.notes, ids.filter((id) => id !== item.id)) } });
      answered = true;
    }
    if (answered) {
      await tx.cycleCount.update({ where: { id: count.id }, data: { notes: withRecounted(count.notes, [...recountedIds(count.notes), item.id]) } });
    }
    return { countNumber: count.countNumber };
  }

  /** Send the count to the owner. It is frozen as a record; nothing in stock or the books moves. */
  async send(ctx: StationContext, input: { by?: unknown } | undefined, now: Date = new Date()): Promise<StationCountSent> {
    const by = this.counterName(ctx, input?.by);
    const { tenantId, branch, station } = ctx;
    const items = await this.sheetItems(tenantId, station.id);

    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(tenantId, branch.id, station.id)}))`;
      const counts = await this.stationCounts(tx, tenantId, branch.id, station.id);
      const current = this.currentOf(counts, now);
      if (!current) {
        if (this.sentToday(counts, station.id, now)) return { outcome: 'ALREADY_SENT' as const, count: null };
        throw new BadRequestException('Count at least one item first.');
      }
      const notes = appendNote(withDone(current.notes, { stationId: station.id, at: now, by }), `${station.name} sent by ${by}, ${whenLabel(now)}`);
      // Guarded on the status, so a second tap in the same instant does not tell the owner twice.
      const flipped = await tx.cycleCount.updateMany({ where: { id: current.id, status: 'OPEN' }, data: { status: 'RECORDED', notes } });
      if (flipped.count === 0) return { outcome: 'ALREADY_SENT' as const, count: null };
      return { outcome: 'SENT' as const, count: { ...current, status: 'RECORDED' as CycleCountStatus, notes } };
    }, { timeout: 30_000 });

    const panel = await this.panel(this.prisma, ctx, items, now);
    const notCounted = panel.rows.filter((r) => !r.done).map((r) => r.name);
    if (done.outcome === 'ALREADY_SENT' || !done.count) {
      return {
        outcome: 'ALREADY_SENT', message: 'Already sent today. Counting again starts a new count.', sentTo: [],
        countNumber: panel.shown?.countNumber ?? null, progress: panel.progress, notCounted,
      };
    }

    const nameOf = new Map(items.map((i) => [i.id, i]));
    const lines = done.count.lines.flatMap((l) => {
      const it = nameOf.get(l.rawMaterialId);
      return it ? [{ rawMaterialId: l.rawMaterialId, name: it.name, unit: it.unit, counted: Number(l.countedQty), book: Number(l.expectedQty) }] : [];
    });
    /*
      A recount is a Send that holds only answers to the owner's "Ask for a
      recount". A full count that also answers one is a weekly count, told in
      full, with what was recounted named. Only what was asked for was meant
      to be counted again, so nothing is missing from a recount.
    */
    const recounted = new Set(recountedIds(done.count.notes));
    const recount = lines.length > 0 && lines.every((l) => recounted.has(l.rawMaterialId));
    const missing = recount ? [] : notCounted;
    const sentTo = await this.tellOwners(ctx, done.count, lines, by, now, panel.progress, missing, recounted, recount);
    return {
      outcome: 'SENT',
      message: sentTo.length > 0
        ? `Sent to ${namesInWords(sentTo)}. Stock does not change until the owner adjusts it.`
        : 'Saved as sent, but no owner or manager account was found to tell.',
      sentTo,
      countNumber: done.count.countNumber,
      progress: panel.progress,
      notCounted: missing,
    };
  }

  // ── the owner's side ──────────────────────────────────────────────────────

  /** The weekly counts, newest first: what the counts list needs to badge and open them. */
  async list(scope: ReviewScope, query: { branchId?: string; status?: string }): Promise<WeeklyCountListRow[]> {
    const status = query.status || undefined;
    // Own keys only: "toString" is in every object, and is not a status.
    if (status && !Object.prototype.hasOwnProperty.call(STATUS_BADGE, status)) throw new BadRequestException('Unknown status.');
    if (scope.ownBranchId && query.branchId && query.branchId !== scope.ownBranchId) {
      throw new ForbiddenException('You can only see the counts of your own branch.');
    }
    const branchId = scope.ownBranchId ?? query.branchId ?? undefined;
    const counts = await this.prisma.cycleCount.findMany({
      where: {
        tenantId: scope.tenantId, notes: { startsWith: WEEKLY_PREFIX },
        ...(branchId ? { branchId } : {}), ...(status ? { status: status as CycleCountStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, countNumber: true, status: true, notes: true, createdAt: true, postedAt: true,
        branch: { select: { id: true, name: true } },
        lines: { select: { countedQty: true, expectedQty: true } },
      },
    });
    const names = await this.stationNames(scope.tenantId, counts.map((c) => readWeekly(c.notes)?.stationId));
    return counts.map((c) => {
      const weekly = readWeekly(c.notes);
      const sent = doneEntries(c.notes)[0] ?? null;
      const stationId = weekly?.stationId ?? null;
      return {
        id: c.id,
        countNumber: c.countNumber,
        status: c.status,
        badge: STATUS_BADGE[c.status] ?? String(c.status),
        branch: c.branch,
        station: stationId ? { id: stationId, name: names.get(stationId) ?? 'A station' } : null,
        startedOn: weekly?.day ?? null,
        sentAt: sent?.at.toISOString() ?? null,
        sentBy: sent?.by ?? null,
        postedAt: c.postedAt?.toISOString() ?? null,
        lines: c.lines.length,
        differ: c.lines.filter((l) => differenceOf(Number(l.countedQty), Number(l.expectedQty)).kind !== 'MATCH').length,
        recountAsked: recountIds(c.notes).length,
        notes: plainNotes(c.notes),
      };
    });
  }

  /** One weekly count as the owner reconciles it: counted, book and difference per line, in words. */
  async review(scope: ReviewScope, id: string, now: Date = new Date()): Promise<WeeklyCountReview> {
    return this.reviewOf(await this.loadWeekly(scope, id), now);
  }

  /**
   * "Ask for a recount": the chosen items go on the record's list and the
   * station's screen shows them the next time it looks. The record's lines
   * are never touched; the recount lands on a new count.
   */
  async recount(
    scope: ReviewScope, id: string, userId: string,
    body: { rawMaterialIds?: unknown; note?: unknown } | undefined, now: Date = new Date(),
  ): Promise<WeeklyCountReview> {
    const asked = body?.rawMaterialIds;
    if (!Array.isArray(asked) || asked.length === 0 || asked.length > RECOUNT_MAX
      || !asked.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 64)) {
      throw new BadRequestException(`Pick 1 to ${RECOUNT_MAX} items to count again.`);
    }
    if (body?.note != null && typeof body.note !== 'string') throw new BadRequestException('The note has to be text.');
    const note = typeof body?.note === 'string' ? body.note.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim() : '';
    if (note.length > NOTE_MAX) throw new BadRequestException(`Keep the note to ${NOTE_MAX} characters.`);

    const count = await this.loadWeekly(scope, id);
    const station = count.weekly.stationId;
    if (count.status !== 'RECORDED' || !station) {
      throw new BadRequestException(count.status === 'OPEN'
        ? 'This count is still open on the station screen. Ask for a recount after it is sent.'
        : count.status === 'POSTED'
          ? 'The books were already adjusted from this count. Count the items again on the station screen instead.'
          : 'Only a recorded weekly count can ask for a recount.');
    }
    const onCount = new Map(count.lines.map((l) => [l.rawMaterialId, l.rawMaterial.name]));
    const wanted = [...new Set(asked as string[])];
    if (wanted.some((x) => !onCount.has(x))) throw new BadRequestException('Pick items that are on this count.');

    const asker = (await this.prisma.user.findFirst({ where: { id: userId, tenantId: scope.tenantId }, select: { name: true } }))?.name ?? 'The owner';
    await this.prisma.$transaction(async (tx) => {
      // The station's lock: a save that answers a recount edits this same list.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(scope.tenantId, count.branchId, station)}))`;
      const fresh = await tx.cycleCount.findFirst({ where: { id, tenantId: scope.tenantId }, select: { status: true, notes: true } });
      if (!fresh || fresh.status !== 'RECORDED') throw new BadRequestException('This count changed a moment ago. Open it again.');
      const notes = appendNote(
        withRecountAskedBy(withRecount(fresh.notes, [...recountIds(fresh.notes), ...wanted]), asker),
        `Recount asked by ${asker}, ${monthDay(now)}: ${wanted.map((x) => onCount.get(x)).join(', ')}${note ? ` (${note})` : ''}`,
      );
      await tx.cycleCount.update({ where: { id }, data: { notes } });
    });
    return this.review(scope, id, now);
  }

  /**
   * "Adjust the books to match": posts the record through the counts
   * screen's own postCycleCount. A line a later count has replaced is left
   * out -- its item was counted again, and posting both would move the stock
   * twice. The variance goes onto the live figure, so adjusting days after
   * the count keeps every sale made since.
   */
  async adjust(
    scope: ReviewScope, id: string, userId: string, body: { isOpeningBalance?: unknown } | undefined, now: Date = new Date(),
  ): Promise<WeeklyCountAdjusted> {
    const count = await this.loadWeekly(scope, id);
    if (count.status !== 'OPEN' && count.status !== 'RECORDED') throw new BadRequestException('Only open or recorded counts can be posted.');
    const superseded = await this.supersededLines(count, now);
    const moves = count.lines.filter((l) => !superseded.has(l.id) && differenceOf(Number(l.countedQty), Number(l.expectedQty)).kind !== 'MATCH');
    if (moves.length === 0) throw new BadRequestException('Nothing to adjust: every item matches or was counted again later.');

    const skippedLines = count.lines.filter((l) => superseded.has(l.id));
    const skip = new Set(skippedLines.map((l) => l.rawMaterialId));
    const posted = await this.warehouse.postCycleCount(scope.tenantId, id, userId, body?.isOpeningBalance === true, [...skip]);
    const view = await this.review(scope, id, now);
    return {
      ...view,
      adjusted: posted.lines.filter((l) => !skip.has(l.rawMaterialId) && Math.abs(Number(l.varianceQty)) >= MATCH_BELOW).length,
      skipped: skippedLines.map((l) => l.rawMaterial.name).sort((a, b) => a.localeCompare(b)),
      warnings: posted.warnings,
    };
  }

  // ── reading ───────────────────────────────────────────────────────────────

  private async loadWeekly(scope: ReviewScope, id: string): Promise<ReviewRow & { weekly: { day: string; stationId: string | null } }> {
    const count = await this.prisma.cycleCount.findFirst({ where: { id, tenantId: scope.tenantId }, select: REVIEW_SELECT });
    if (!count) throw new NotFoundException('Count not found.');
    if (scope.ownBranchId && count.branchId !== scope.ownBranchId) throw new ForbiddenException('You can only see the counts of your own branch.');
    const weekly = readWeekly(count.notes);
    if (!weekly) throw new BadRequestException('This is not a weekly count from a kitchen or bar screen. Open it from the counts list.');
    return { ...count, weekly };
  }

  private async reviewOf(count: ReviewRow & { weekly: { day: string; stationId: string | null } }, now: Date): Promise<WeeklyCountReview> {
    const { tenantId } = count;
    const stationId = count.weekly.stationId;
    const ids = [...new Set(count.lines.map((l) => l.rawMaterialId))];
    const sent = doneEntries(count.notes).find((d) => d.stationId === stationId) ?? doneEntries(count.notes)[0] ?? null;
    const [station, packs, superseded, alsoOpen, catalogue, postedBy] = await Promise.all([
      stationId ? this.prisma.station.findFirst({ where: { id: stationId, tenantId }, select: { id: true, name: true } }) : Promise.resolve(null),
      sheetPackSizes(this.prisma, tenantId, ids),
      this.supersededLines(count, now),
      // Another open count holding the same item would apply its own variance too when it is posted.
      ids.length > 0
        ? this.prisma.cycleCountLine.findMany({
            where:  { rawMaterialId: { in: ids }, count: { tenantId, branchId: count.branchId, status: 'OPEN', id: { not: count.id } } },
            select: { rawMaterialId: true, count: { select: { countNumber: true } } },
          })
        : Promise.resolve([] as Array<{ rawMaterialId: string; count: { countNumber: string } }>),
      stationId ? stationItems(this.prisma, tenantId) : Promise.resolve(null),
      count.postedById ? this.prisma.user.findFirst({ where: { id: count.postedById, tenantId }, select: { name: true } }) : Promise.resolve(null),
    ]);
    const stationName = station?.name ?? null;
    const recountSet = new Set(recountIds(count.notes));

    const lines: WeeklyCountLineView[] = count.lines.map((l) => {
      const counted = Number(l.countedQty);
      const book = Number(l.expectedQty);
      const { name, unit } = l.rawMaterial;
      const tags = readLineTags(l.notes);
      const inPacks = sheetAmount(counted, unit, packs.get(l.rawMaterialId) ?? null, 'balance');
      return {
        lineId: l.id,
        rawMaterialId: l.rawMaterialId,
        name,
        unit,
        counted,
        book,
        difference: round3(counted - book),
        kind: differenceOf(counted, book).kind,
        words: countLineWords(name, unit, counted, book),
        inPacks,
        countedBy: tags.by,
        stationName,
        countedAt: tags.at?.toISOString() ?? null,
        detail: [inPacks, `${stationName ?? 'Station'} screen${tags.by ? ` (${tags.by})` : ''}`, ...(tags.at ? [whenLabel(tags.at)] : [])].join(' · '),
        superseded: superseded.get(l.id) ?? null,
        alsoOpenIn: [...new Set(alsoOpen.filter((o) => o.rawMaterialId === l.rawMaterialId).map((o) => o.count.countNumber))],
        recount: recountSet.has(l.rawMaterialId),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // The station's sheet as it is now: what it could have counted, less what it did or another station did around then.
    let total = lines.length;
    let counted = lines.length;
    let notCounted: Array<{ rawMaterialId: string; name: string }> = [];
    if (catalogue && stationId) {
      const sheet = stationSheetItems(catalogue, stationId);
      const until = sent?.at ?? (count.status === 'OPEN' ? now : count.updatedAt);
      const elsewhere = await this.countedElsewhere(this.prisma, tenantId, count.branchId, stationId, new Date(until.getTime() - COUNTED_ELSEWHERE_DAYS * DAY_MS), until);
      const inCount = new Set(ids);
      total = sheet.length;
      notCounted = sheet.filter((s) => !inCount.has(s.id) && !elsewhere.has(s.id)).map((s) => ({ rawMaterialId: s.id, name: s.name }));
      // As the tablet and the bell counted it: a shared item the other station counted is counted too.
      counted = total - notCounted.length;
    }

    const live = lines.filter((l) => !l.superseded);
    const short = live.filter((l) => l.kind === 'SHORT').length;
    const over = live.filter((l) => l.kind === 'OVER').length;
    const place = stationName ?? 'the station';
    const statusLine = count.status === 'OPEN'
      ? `${stationName ?? 'The station'} is still counting. Nothing has been sent yet.`
      : count.status === 'RECORDED'
        ? sent
          ? `Recorded ${whenLabel(sent.at)} by ${sent.by} (${place}). Stock and the books have not changed.`
          : `Recorded ${whenLabel(count.updatedAt)}: never sent from the ${place} screen. Stock and the books have not changed.`
        : count.status === 'POSTED'
          ? `Books adjusted${count.postedAt ? ` ${whenLabel(count.postedAt)}` : ''}${postedBy ? ` by ${postedBy.name}` : ''}.`
          : 'Cancelled.';

    return {
      id: count.id,
      countNumber: count.countNumber,
      status: count.status,
      badge: STATUS_BADGE[count.status] ?? String(count.status),
      statusLine,
      branch: count.branch,
      station: station ? { id: station.id, name: station.name } : null,
      startedOn: count.weekly.day,
      recordedAt: sent?.at.toISOString() ?? null,
      recordedBy: sent?.by ?? null,
      postedAt: count.postedAt?.toISOString() ?? null,
      postedBy: postedBy?.name ?? null,
      stations: stationId
        ? [{ id: stationId, name: stationName ?? 'A station', sentAt: sent?.at.toISOString() ?? null, countedBy: sent?.by ?? null, counted, total, notCounted }]
        : [],
      lines,
      summary: { lines: lines.length, differ: short + over, short, over, superseded: lines.length - live.length },
      recountAsked: [...recountSet],
      recountAskedBy: recountAskedBy(count.notes),
      actions: {
        canAdjust: (count.status === 'OPEN' || count.status === 'RECORDED') && short + over > 0,
        canAskRecount: count.status === 'RECORDED',
      },
      notes: plainNotes(count.notes),
    };
  }

  /**
   * The lines of a count that a later count has replaced, and so must not be
   * adjusted from it (KJ's amendment, section E):
   *   - a newer weekly-count line for the same item in another count of the
   *     branch, any status but cancelled -- the item was counted again;
   *   - any other count posted after this line was counted that holds the
   *     item -- the books were already corrected for it.
   * A weekly count already posted is read as it stood when it was posted.
   */
  private async supersededLines(
    count: { id: string; tenantId: string; branchId: string; status: CycleCountStatus; postedAt: Date | null; createdAt: Date;
             lines: Array<{ id: string; rawMaterialId: string; notes: string | null }> },
    now: Date,
  ): Promise<Map<string, Superseded>> {
    const out = new Map<string, Superseded>();
    const ids = [...new Set(count.lines.map((l) => l.rawMaterialId))];
    if (ids.length === 0) return out;
    const asOf = count.status === 'POSTED' && count.postedAt ? count.postedAt : now;
    const others = await this.prisma.cycleCountLine.findMany({
      where:  { rawMaterialId: { in: ids }, count: { tenantId: count.tenantId, branchId: count.branchId, id: { not: count.id }, status: { not: 'CANCELLED' } } },
      select: { rawMaterialId: true, notes: true, count: { select: { countNumber: true, status: true, notes: true, postedAt: true, createdAt: true } } },
    });
    const names = await this.stationNames(count.tenantId, others.map((o) => readWeekly(o.count.notes)?.stationId));

    for (const line of count.lines) {
      const at = readLineTags(line.notes).at ?? count.createdAt;
      let best: { when: Date; s: Omit<Superseded, 'message' | 'on' | 'at'> } | null = null;
      for (const o of others) {
        if (o.rawMaterialId !== line.rawMaterialId) continue;
        const weekly = readWeekly(o.count.notes);
        let when: Date | null = null;
        let s: Omit<Superseded, 'message' | 'on' | 'at'> | null = null;
        if (weekly) {
          const oAt = readLineTags(o.notes).at ?? o.count.createdAt;
          if (oAt > at && oAt <= asOf) {
            when = oAt;
            s = { reason: 'COUNTED_AGAIN', countNumber: o.count.countNumber, stationName: weekly.stationId ? names.get(weekly.stationId) ?? null : null };
          }
        } else if (o.count.status === 'POSTED' && o.count.postedAt && o.count.postedAt > at && o.count.postedAt <= asOf) {
          when = o.count.postedAt;
          s = { reason: 'ADJUSTED', countNumber: o.count.countNumber, stationName: null };
        }
        if (when && s && (!best || when > best.when)) best = { when, s };
      }
      if (!best) continue;
      const on = monthDay(best.when);
      out.set(line.id, {
        ...best.s, on, at: best.when.toISOString(),
        message: best.s.reason === 'COUNTED_AGAIN'
          ? `Counted again later (${best.s.stationName ?? best.s.countNumber}, ${on}). Not adjusted from this record.`
          : `Adjusted by count ${best.s.countNumber} on ${on}. Not adjusted from this record.`,
      });
    }
    return out;
  }

  /** This station's weekly counts, newest first, with their lines. */
  private async stationCounts(db: Db, tenantId: string, branchId: string, stationId: string): Promise<CountRow[]> {
    const rows = await db.cycleCount.findMany({
      where:   { tenantId, branchId, status: { not: 'CANCELLED' }, notes: { startsWith: WEEKLY_PREFIX, contains: `[ST:${stationId}]` } },
      orderBy: { createdAt: 'desc' },
      take:    10,
      select:  COUNT_SELECT,
    });
    return rows.filter((r) => readWeekly(r.notes)?.stationId === stationId);
  }

  /** The count this station is filling in now: open, with something counted, and not left days ago. */
  private currentOf(counts: CountRow[], now: Date): CountRow | null {
    const open = counts.find((c) => c.status === 'OPEN') ?? null;
    return open && open.lines.length > 0 && !abandoned(open, now) ? open : null;
  }

  /** The record this station sent today, if it did. */
  private sentToday(counts: CountRow[], stationId: string, now: Date): CountRow | null {
    const today = manilaDayOf(now);
    return counts.find((c) => c.status !== 'OPEN'
      && doneEntries(c.notes).some((d) => d.stationId === stationId && manilaDayOf(d.at) === today)) ?? null;
  }

  /**
   * What the panel shows, shared by the panel, a save and a send: the count
   * being filled in (or the one sent today), the owner's recount list, and
   * what other stations counted of the shared items.
   */
  private async panel(db: Db, ctx: StationContext, items: SheetItem[], now: Date) {
    const { tenantId, branch, station } = ctx;
    const [counts, askedCounts, elsewhere] = await Promise.all([
      this.stationCounts(db, tenantId, branch.id, station.id),
      db.cycleCount.findMany({
        where: {
          tenantId, branchId: branch.id, status: 'RECORDED',
          AND: [{ notes: { startsWith: WEEKLY_PREFIX } }, { notes: { contains: `[ST:${station.id}]` } }, { notes: { contains: '[RECOUNT:' } }],
        },
        orderBy: { createdAt: 'desc' },
        select:  { notes: true },
      }),
      this.countedElsewhere(db, tenantId, branch.id, station.id, new Date(now.getTime() - COUNTED_ELSEWHERE_DAYS * DAY_MS), null),
    ]);
    const current = this.currentOf(counts, now);
    const sent = current ? null : this.sentToday(counts, station.id, now);
    const shown = current ?? sent;
    const state: PanelState = current ? 'COUNTING' : sent ? 'SENT' : 'NEW';

    const mine = askedCounts.filter((c) => readWeekly(c.notes)?.stationId === station.id);
    const askedFor = new Set(mine.flatMap((c) => recountIds(c.notes)));
    const askedBy = mine.map((c) => recountAskedBy(c.notes)).find((n) => !!n) ?? null;
    const names = await this.stationNames(tenantId, [...elsewhere.values()].map((e) => e.stationId));
    const lineOf = new Map((shown?.lines ?? []).map((l) => [l.rawMaterialId, l]));

    const rows: StationCountRow[] = items.map((it) => {
      const line = lineOf.get(it.id);
      const tags = line ? readLineTags(line.notes) : null;
      const counted = line ? Number(line.countedQty) : null;
      const other = elsewhere.get(it.id);
      const otherName = other ? names.get(other.stationId) ?? 'Another station' : null;
      const otherWords = other ? sheetAmount(other.counted, it.unit, it.packSize, 'balance') : null;
      const recount = askedFor.has(it.id);
      return {
        rawMaterialId: it.id,
        name: it.name,
        unit: it.unit,
        packSize: it.packSize,
        alsoOn: it.alsoOn,
        counted,
        countedWords: counted != null ? sheetAmount(counted, it.unit, it.packSize, 'balance') : null,
        countedBy: tags?.by ?? null,
        countedAt: tags?.at?.toISOString() ?? null,
        recount,
        countedElsewhere: other && otherName && otherWords
          ? { station: otherName, words: otherWords, on: monthDay(other.at), at: other.at.toISOString(), label: `${otherName} counted: ${otherWords} (${monthDay(other.at)})` }
          : null,
        // An item the owner wants counted again is not done until it is.
        done: !recount && (counted != null || !!other),
      };
    });
    return {
      state, shown, rows, askedBy,
      progress: { counted: rows.filter((r) => r.done).length, total: rows.length },
    };
  }

  /**
   * Shared items: whoever counts one counts all of it in the shop, so another
   * station's recent count of it stands for this one too. The newest of each.
   */
  private async countedElsewhere(
    db: Db, tenantId: string, branchId: string, stationId: string, since: Date, until: Date | null,
  ): Promise<Map<string, { stationId: string; counted: number; at: Date }>> {
    const counts = await db.cycleCount.findMany({
      where: {
        tenantId, branchId, status: { not: 'CANCELLED' },
        notes: { startsWith: WEEKLY_PREFIX },
        NOT: { notes: { contains: `[ST:${stationId}]` } },
        // Lines are saved after a count starts, and a count is sent (or left) within a few days of starting.
        OR: [{ status: 'OPEN' }, { createdAt: { gte: new Date(since.getTime() - (ABANDONED_AFTER_DAYS + 1) * DAY_MS) } }],
      },
      select: { notes: true, lines: { select: { rawMaterialId: true, countedQty: true, notes: true } } },
    });
    const out = new Map<string, { stationId: string; counted: number; at: Date }>();
    for (const c of counts) {
      const other = readWeekly(c.notes)?.stationId;
      if (!other || other === stationId) continue;
      for (const l of c.lines) {
        const at = readLineTags(l.notes).at;
        if (!at || at < since || (until && at > until)) continue;
        const was = out.get(l.rawMaterialId);
        if (!was || at > was.at) out.set(l.rawMaterialId, { stationId: other, counted: Number(l.countedQty), at });
      }
    }
    return out;
  }

  /** The items on this station's sheet, with the pack size the sheet shows. */
  private async sheetItems(tenantId: string, stationId: string): Promise<SheetItem[]> {
    const items = stationSheetItems(await stationItems(this.prisma, tenantId), stationId);
    const packs = await sheetPackSizes(this.prisma, tenantId, items.map((i) => i.id));
    return items.map((i) => ({ ...i, packSize: packs.get(i.id) ?? null }));
  }

  private async stationNames(tenantId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const rows = await this.prisma.station.findMany({ where: { id: { in: wanted }, tenantId }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /**
   * Who counted. A paired tablet has no login, so the name is typed once on
   * it and sent with every save -- text, unverified. A person logged in on
   * the screen is named from their account.
   */
  private counterName(ctx: StationContext, by: unknown): string {
    if (!ctx.isDevice) return ctx.actorLabel;
    const name = cleanCounterName(by);
    if (!name) throw new BadRequestException('Type your name so the owner knows who counted.');
    return name;
  }

  /**
   * The owner, and managers of this branch or of every branch -- the people
   * tellTheOwners reaches (procure.service.ts). A bell each, and Telegram on
   * the buying switch. Never throws: the count is sent either way.
   */
  private async tellOwners(
    ctx: StationContext,
    count: { id: string; countNumber: string },
    lines: Array<SentLine & { rawMaterialId: string }>,
    by: string,
    now: Date,
    progress: { counted: number; total: number },
    notCounted: string[],
    recounted: Set<string>,
    /** Every line answered a recount. */
    recount: boolean,
  ): Promise<string[]> {
    const { tenantId, branch, station } = ctx;
    try {
      const people = await this.prisma.user.findMany({
        where: {
          tenantId, isActive: true,
          OR: [
            { role: 'BUSINESS_OWNER' },
            { role: 'BRANCH_MANAGER', OR: [{ branchId: branch.id }, { branchId: null }] },
          ],
        },
        select: { id: true, name: true },
      });
      if (people.length === 0) return [];

      // A full count that also answered a recount names those items; a recount's title says it all.
      const recountedNames = recount ? [] : lines.filter((l) => recounted.has(l.rawMaterialId)).map((l) => l.name);
      const title = `${recount ? 'Recount sent' : 'Weekly count sent'} — ${station.name} (${branch.name})`;
      const body = weeklyCountBellBody({ counted: progress.counted, total: progress.total, lines, notCounted, recount, recounted: recountedNames });
      const link = `/procure/cycle-counts?review=${count.id}`;

      // Telegram too, in the same words. Not awaited: it never rejects, and never holds up the screen.
      void this.telegram?.weeklyCountSent(tenantId, branch.id, {
        stationName: station.name, countNumber: count.countNumber, countedBy: by, sentAt: now, recount, recounted: recountedNames,
        counted: progress.counted, total: progress.total, lines, notCounted,
      });
      for (const p of people) {
        if (!this.notifications) break;
        try {
          await this.notifications.create({
            tenantId, userId: p.id, kind: 'INFO', title, body, link,
            dedupeKey: `weekly-count-${count.countNumber}-${p.id}`,
          });
        } catch (err) {
          this.logger.warn(`Could not ring ${p.id} about weekly count ${count.countNumber}: ${err instanceof Error ? err.message : err}`);
        }
      }
      return people.map((p) => p.name);
    } catch (err) {
      this.logger.warn(`Could not tell the owners about weekly count ${count.countNumber}: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}
