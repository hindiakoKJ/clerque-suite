import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  PH_TIMEZONE, canPrepAtStation, prepStationKindsFor, rotationFromBoard, rotationNeedsAction, rotationAlertTitle, rotationInstruction,
} from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubRecipesService } from './sub-recipes.service';

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
 * Once per sauce, per what-to-do, per day -- and again after the sauce was
 * moved or cooked. Every move and every batch writes a stock lot on the
 * ready-to-use item, so "since the newest lot" makes the second rotation of the
 * day new news rather than a repeat. The words carry no live quantity, so a
 * sale does not make an old alert look new.
 *
 * Silent for any sauce with no par level: a warning nobody configured is one
 * everyone learns to ignore.
 */
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
    // A shop with no prep that has a par level has nothing to watch: skip the board entirely.
    const watched = await this.prisma.rawMaterial.count({
      where: { tenantId, isActive: true, lowStockAlert: { not: null }, subRecipeItems: { some: {} } },
    });
    if (watched === 0) return 0;

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
      const due = rotationFromBoard(board).filter(rotationNeedsAction);
      if (due.length === 0) continue;

      // The newest stock lot of each sauce here: a move or a batch since then makes it news again.
      const lots = await this.prisma.rawMaterialLot.groupBy({
        by:    ['rawMaterialId'],
        where: { tenantId, branchId: branch.id, rawMaterialId: { in: due.map((r) => r.prepId) } },
        _max:  { createdAt: true },
      });
      // The shop's stations as the board reads them (every prep), so a barista's scope is judged the same way.
      const shopKinds: string[] = [...new Set(board.map((r) => r.station?.kind).filter(Boolean).map(String))];
      const where = branches.length > 1 ? ` (${branch.name})` : '';

      for (const r of due) {
        const lastLot = lots.find((l) => l.rawMaterialId === r.prepId)?._max.createdAt ?? null;
        const since = lastLot && lastLot > dayStart ? lastLot : dayStart;
        const kind = r.station?.kind ?? null;
        const recipients = people.filter((p) =>
          p.role === 'BUSINESS_OWNER'
          || (p.role === 'BRANCH_MANAGER' && (p.branchId === branch.id || p.branchId == null))
          || (p.branchId === branch.id && (
            // The kitchen account at this branch -- the bar's people are not told about the kitchen's sauce.
            (p.role === 'GENERAL_EMPLOYEE' && canPrepAtStation(p.personaKey, kind, shopKinds))
            // A till account only when its persona makes it prep staff (a barista, a line cook); a plain cashier is not.
            || ((p.role === 'CASHIER' || p.role === 'SALES_LEAD') && prepStationKindsFor(p.personaKey) != null && canPrepAtStation(p.personaKey, kind, shopKinds)))));

        for (const p of recipients) {
          const res = await this.notifications.create({
            tenantId,
            userId:      p.id,
            kind:        r.state === 'REFILL_BACKUP' ? 'INFO' : r.out ? 'ERROR' : 'WARNING',
            title:       rotationAlertTitle(r, where),
            body:        rotationInstruction(r) ?? undefined,
            // The board opened on this branch: an owner has none of their own to fall back on.
            link:        `/procure/batches?branch=${branch.id}`,
            dedupeKey:   `prep-rotation-${r.prepId}`,
            dedupeSince: since,
          });
          // A repeat hands back only the earlier row's id; a new alert is the whole row.
          if (res && 'title' in res) created += 1;
        }
      }
    }
    return created;
  }
}

/** 00:00 of `now`'s day in Manila (UTC+8, no daylight saving). */
function manilaDayStart(now: Date): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${day}T00:00:00+08:00`);
}
