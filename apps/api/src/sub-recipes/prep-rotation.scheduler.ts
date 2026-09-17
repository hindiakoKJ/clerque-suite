import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  PH_TIMEZONE, canPrepAtStation, prepStationKindsFor, useByOf, useByAlertTitle, useByWhen, type PrepLot,
} from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubRecipesService } from './sub-recipes.service';
import { chainsFromBoard, makerOf } from './prep-chain';

/**
 * The sauce rotation, said during service, to the people who act on it.
 *
 * The nightly ingredient alert lands at 3am and covers a whole day; a sauce
 * runs low at the lunch rush. Every half hour while the shop is open this
 * looks at each branch's ready-to-use preps and tells the owner, the branch's
 * managers and the branch's kitchen when one needs moving across from its
 * backup or cooking.
 *
 * One alert per PERSON, not one for the shop: a tenant-wide alert has a single
 * "read" flag, so the cook tapping "mark all read" would clear the owner's.
 *
 * One alert per sauce chain (Level 1 and the stages behind it, prep-chain.ts),
 * once per what-to-do per day -- and again after a batch on any stage of it.
 * Every move and every batch writes a stock lot on what it made, so "since the
 * newest lot" makes the second rotation of the day new news rather than a
 * repeat. The words carry no live quantity, so a sale does not make an old
 * alert look new.
 *
 * Silent for any chain with no par level on any stage: a warning nobody
 * configured is one everyone learns to ignore.
 *
 * Also a batch past its use-by, or due within 12 hours, of any pre-made item
 * -- once per batch per day. A batch only has a use-by when whoever made it
 * gave it a shelf life, so this too says nothing the shop did not set up.
 * A use-by more than three days gone is left to the station screen: a daily
 * alert about last week's tub is how alerts stop being read.
 */
const USE_BY_SOON_HOURS = 12;
const USE_BY_STALE_DAYS = 3;
@Injectable()
export class PrepRotationScheduler {
  private readonly logger = new Logger(PrepRotationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subRecipes: SubRecipesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Every half hour, 06:00 to 22:30, Manila time. */
  @Cron('*/30 6-22 * * *', { timeZone: PH_TIMEZONE })
  async run(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const t of tenants) {
      try {
        await this.alertTenant(t.id);
      } catch (err) {
        this.logger.error(`prep rotation alerts failed for ${t.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** Returns how many alerts were created (a repeat within its window is not created). */
  async alertTenant(tenantId: string, now: Date = new Date()): Promise<number> {
    // A shop with no prep that has a par level, and no batch with a use-by coming or just gone, has nothing to watch.
    const [watched, dated] = await Promise.all([
      this.prisma.rawMaterial.count({
        where: { tenantId, isActive: true, lowStockAlert: { not: null }, subRecipeItems: { some: {} } },
      }),
      this.prisma.rawMaterialLot.count({
        where: {
          tenantId, qtyRemaining: { gt: 0 },
          expirationDate: { gte: new Date(now.getTime() - USE_BY_STALE_DAYS * 86_400_000), lte: new Date(now.getTime() + USE_BY_SOON_HOURS * 3_600_000) },
          rawMaterial: { isActive: true, subRecipeItems: { some: {} } },
        },
      }),
    ]);
    if (watched === 0 && dated === 0) return 0;

    const [branches, people] = await Promise.all([
      this.prisma.branch.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.findMany({
        // A barista IS the cashier at most cafes (the BARISTA persona is built on CASHIER), so till accounts are read too.
        where:  { tenantId, isActive: true, role: { in: ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'GENERAL_EMPLOYEE', 'CASHIER', 'SALES_LEAD'] } },
        select: { id: true, role: true, branchId: true, personaKey: true },
      }),
    ]);
    const dayStart = manilaDayStart(now);
    let created = 0;

    for (const branch of branches) {
      const board = await this.subRecipes.list(tenantId, branch.id, null);
      if (dated > 0) created += await this.alertUseBy(tenantId, branch, branches.length > 1, board, people, now, dayStart);
      /*
        One alert per sauce CHAIN, saying the one thing to do -- the same words
        the station screen's card says (prep-chain.ts). Before, the ready tub
        and its backup each had their own alert, so a cook was told "move one
        across" and "cook the next batch" about one sauce in two messages and
        had to work out the order. Only chains with a par somewhere: a warning
        nobody configured is one everyone learns to ignore.
      */
      const chains = chainsFromBoard(board).filter((c) => c.alertTitle && c.alertable);
      if (chains.length === 0) continue;

      /*
        The newest batch of each stage here: a batch made on ANY stage since
        makes the chain news again. Positive lots only -- a write-off is written
        as a negative marker lot, and throwing out a spoiled tub is not a batch,
        so it must not make the same instruction look new.
      */
      const stageIds = [...new Set(chains.flatMap((c) => c.stages.map((s) => s.id)))];
      const lots = await this.prisma.rawMaterialLot.groupBy({
        by:    ['rawMaterialId'],
        where: { tenantId, branchId: branch.id, rawMaterialId: { in: stageIds }, qtyReceived: { gt: 0 } },
        _max:  { createdAt: true },
      });
      const newestLot = new Map(lots.map((l) => [l.rawMaterialId, l._max.createdAt]));
      // The shop's stations as the board reads them (every prep), so a barista's scope is judged the same way.
      const shopKinds: string[] = [...new Set(board.map((r) => r.station?.kind).filter(Boolean).map(String))];
      const where = branches.length > 1 ? ` (${branch.name})` : '';

      for (const c of chains) {
        let since = dayStart;
        for (const s of c.stages) {
          const at = newestLot.get(s.id);
          if (at && at > since) since = at;
        }
        /*
          Told to whoever makes the stage the alert is about. A kitchen glaze
          short of the bar's simple syrup says "make Level 2 now", and the
          kitchen cannot record the bar's syrup: told to the kitchen, nobody
          who can act hears it. When that stage has no station of its own, the
          chain's station as before.
        */
        const maker = makerOf(c, board);
        const recipients = recipientsFor(people, branch.id, (maker ?? c.station)?.kind ?? null, shopKinds);

        for (const p of recipients) {
          const res = await this.notifications.create({
            tenantId,
            userId:      p.id,
            kind:        c.severity === 'NOW' ? 'WARNING' : 'INFO',
            title:       c.alertTitle + where,
            body:        c.alertBody ?? undefined,
            // The board opened on this branch: an owner has none of their own to fall back on.
            link:        `/procure/batches?branch=${branch.id}`,
            dedupeKey:   `prep-chain-${c.id}`,
            dedupeSince: since,
          });
          // A repeat hands back only the earlier row's id; a new alert is the whole row.
          if (res && 'title' in res) created += 1;
        }
      }
    }
    return created;
  }

  /** Batches of this branch's pre-made items past their use-by (in the last few days) or due soon. */
  private async alertUseBy(
    tenantId: string,
    branch: { id: string; name: string },
    multiBranch: boolean,
    board: Awaited<ReturnType<SubRecipesService['list']>>,
    people: Person[],
    now: Date,
    dayStart: Date,
  ): Promise<number> {
    if (board.length === 0) return 0;
    // Only items that have a dated batch at all, then the same per-item read the station screen uses.
    const dated = await this.prisma.rawMaterialLot.findMany({
      where:    { tenantId, branchId: branch.id, rawMaterialId: { in: board.map((r) => r.id) }, qtyRemaining: { gt: 0 }, expirationDate: { not: null } },
      select:   { rawMaterialId: true },
      distinct: ['rawMaterialId'],
    });
    if (dated.length === 0) return 0;
    const lotsOf = await this.subRecipes.batchesOnHand(tenantId, branch.id, board.filter((r) => dated.some((d) => d.rawMaterialId === r.id)));
    const shopKinds: string[] = [...new Set(board.map((r) => r.station?.kind).filter(Boolean).map(String))];
    const where = multiBranch ? ` (${branch.name})` : '';
    const staleBefore = now.getTime() - USE_BY_STALE_DAYS * 86_400_000;
    let created = 0;

    for (const r of board) {
      const mine: PrepLot[] = lotsOf.get(r.id) ?? [];
      if (!mine.some((l) => l.expirationDate)) continue;
      const useBy = useByOf(r.onHand, mine, now, USE_BY_SOON_HOURS);
      // Only a use-by gone in the last few days is still news; of those, the newest is what the words carry.
      const freshExpired = useBy.expired
        ? mine.filter((l) => useBy.expired!.lotIds.includes(l.id) && new Date(l.expirationDate!).getTime() >= staleBefore)
        : [];
      const newestPast = freshExpired.length
        ? new Date(Math.max(...freshExpired.map((l) => new Date(l.expirationDate!).getTime()))).toISOString()
        : null;
      const news = { expired: newestPast ? useBy.expired : null, soon: useBy.soon };
      const title = useByAlertTitle(r.name, news, where);
      if (!title) continue;
      /*
        No quantity in the words: a sale must not make the same batch a new
        alert. The dates change only when a batch does -- another one passes
        its use-by, or a new one comes due -- and that IS news.
      */
      const body = newestPast
        ? `Past its use-by (${useByWhen(newestPast, now)}). Check it; if it is thrown out, take it off under Stock on hand.`
          + (news.soon ? ` Another batch is due by ${useByWhen(news.soon.at, now)}.` : '')
        : `Use by ${useByWhen(news.soon!.at, now)}. Use this batch first.`;
      for (const p of recipientsFor(people, branch.id, r.station?.kind ?? null, shopKinds)) {
        const res = await this.notifications.create({
          tenantId,
          userId:      p.id,
          kind:        news.expired ? 'ERROR' : 'WARNING',
          title,
          body,
          link:        `/procure/batches?branch=${branch.id}`,
          dedupeKey:   `prep-use-by-${r.id}`,
          dedupeSince: dayStart,
        });
        if (res && 'title' in res) created += 1;
      }
    }
    return created;
  }
}

type Person = { id: string; role: string; branchId: string | null; personaKey: string | null };

/**
 * Who is told about a pre-made item at a branch: the owner, the branch's
 * managers, and the prep staff of the station it belongs to there.
 */
function recipientsFor(people: Person[], branchId: string, kind: string | null, shopKinds: string[]): Person[] {
  return people.filter((p) =>
    p.role === 'BUSINESS_OWNER'
    || (p.role === 'BRANCH_MANAGER' && (p.branchId === branchId || p.branchId == null))
    || (p.branchId === branchId && (
      // The kitchen account at this branch -- the bar's people are not told about the kitchen's sauce.
      (p.role === 'GENERAL_EMPLOYEE' && canPrepAtStation(p.personaKey, kind, shopKinds))
      // A till account only when its persona makes it prep staff (a barista, a line cook); a plain cashier is not.
      || ((p.role === 'CASHIER' || p.role === 'SALES_LEAD') && prepStationKindsFor(p.personaKey) != null && canPrepAtStation(p.personaKey, kind, shopKinds)))));
}

/** 00:00 of `now`'s day in Manila (UTC+8, no daylight saving). */
function manilaDayStart(now: Date): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${day}T00:00:00+08:00`);
}
