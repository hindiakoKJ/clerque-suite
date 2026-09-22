import { CycleCountStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { readTag, withTag } from '../procure/procure-notes';
import { MATCH_BELOW, WEEKLY_PREFIX, monthDay, readLineTags, readWeekly } from '../procure/weekly-count';

/**
 * Newest count wins: the lines of a count that a newer count has already
 * settled, so posting them would move the item a second time.
 *
 * A line's difference is measured against the book at the moment it was
 * counted, and posting applies it to the live figure. When another count has
 * adjusted the same item since that moment, the live figure already holds
 * that correction, and applying this line on top books the same loss twice:
 * a buy list's "how much is left?" posted after the owner adjusted the item
 * from a newer weekly count. Such a line is left alone -- no stock change, no
 * entry, the line as it was -- and the owner is told why.
 *
 * When a line was counted: its [AT:] tag (a weekly count's line, a buy list's
 * line), else when its count was started (the counts screen snapshots every
 * line then).
 *
 * A line is replaced by another count of the same item at the same branch:
 *   - a weekly count's line that counted it later, whatever that count's
 *     status but cancelled -- the item was counted again. Between two weekly
 *     counts this is the whole rule (the weekly review's own, as it always
 *     was); any other count obeys it too, so an older buy list posted before
 *     the newer weekly count is adjusted leaves the item for it;
 *   - otherwise: a count POSTED after this line was counted, where it moved
 *     the item, or matched it on a line somebody counted with a time ([AT:],
 *     a buy list's). A counts-screen line that matched is the book figure the
 *     screen filled in, which nobody may have looked at: it replaces nothing.
 *     Nor does a line that post left alone ([LEFT:] on the line).
 * A line counted after the other was posted is not replaced: it was measured
 * against the corrected book.
 *
 * Read as of `asOf`: now for a post, the moment it was posted for a count
 * already posted.
 */

/** On a line of a posted count: its post left it alone, because another count had settled the item. [LEFT:<when posted>] */
export const LEFT_TAG = 'LEFT';

export function wasLeftAlone(lineNotes: string | null | undefined): boolean {
  return readTag(lineNotes, LEFT_TAG) != null;
}

/** A line's notes marked as left alone by the post at `at`, the rest of them as they were. One tag per line, so a count of any size keeps every mark. */
export function leftAloneNotes(lineNotes: string | null | undefined, at: Date): string {
  return withTag(lineNotes, LEFT_TAG, at.toISOString());
}

export interface NewerCount {
  reason: 'COUNTED_AGAIN' | 'ADJUSTED';
  countNumber: string;
  /** The weekly count's station, when the item was counted again there. */
  stationId: string | null;
  /** When it was counted again, or when the other count was posted. */
  when: Date;
}

export interface CountLines {
  id: string;
  tenantId: string;
  branchId: string;
  notes: string | null;
  createdAt: Date;
  lines: Array<{ id: string; rawMaterialId: string; notes: string | null }>;
}

type Db = Pick<Prisma.TransactionClient, 'cycleCountLine'> | Pick<PrismaService, 'cycleCountLine'>;

const countedAt = (notes: string | null, startedAt: Date): Date => readLineTags(notes).at ?? startedAt;

/** Line id -> the newer count that replaced it. Lines that still stand are absent. */
export async function newerCounts(db: Db, count: CountLines, asOf: Date): Promise<Map<string, NewerCount>> {
  const out = new Map<string, NewerCount>();
  const ids = [...new Set(count.lines.map((l) => l.rawMaterialId))];
  if (ids.length === 0) return out;
  const weekly = readWeekly(count.notes) != null;
  const earliest = new Date(Math.min(...count.lines.map((l) => countedAt(l.notes, count.createdAt).getTime())));
  // A weekly count looks at every other count; any other count at what was posted since, and at the weekly counts, sent or not.
  const which: Prisma.CycleCountWhereInput = weekly
    ? { status: { not: CycleCountStatus.CANCELLED } }
    : { OR: [
        { status: CycleCountStatus.POSTED, postedAt: { gt: earliest, lte: asOf } },
        { status: { not: CycleCountStatus.CANCELLED }, notes: { startsWith: WEEKLY_PREFIX } },
      ] };
  const others = await db.cycleCountLine.findMany({
    where:  { rawMaterialId: { in: ids }, count: { tenantId: count.tenantId, branchId: count.branchId, id: { not: count.id }, ...which } },
    select: {
      rawMaterialId: true, notes: true, varianceQty: true,
      count: { select: { countNumber: true, status: true, notes: true, postedAt: true, createdAt: true } },
    },
  });

  for (const line of count.lines) {
    const at = countedAt(line.notes, count.createdAt);
    let best: NewerCount | null = null;
    for (const o of others) {
      if (o.rawMaterialId !== line.rawMaterialId) continue;
      const otherWeekly = readWeekly(o.count.notes);
      const oAt = countedAt(o.notes, o.count.createdAt);
      const later = oAt > at && oAt <= asOf;
      const postedAt = o.count.postedAt;
      let found: NewerCount | null = null;
      if (otherWeekly && (weekly || later)) {
        if (later) found = { reason: 'COUNTED_AGAIN', countNumber: o.count.countNumber, stationId: otherWeekly.stationId, when: oAt };
      } else if (
        o.count.status === CycleCountStatus.POSTED && postedAt && postedAt > at && postedAt <= asOf && !wasLeftAlone(o.notes)
      ) {
        if (Math.abs(Number(o.varianceQty)) >= MATCH_BELOW) {
          found = { reason: 'ADJUSTED', countNumber: o.count.countNumber, stationId: null, when: postedAt };
        } else if (later && readLineTags(o.notes).at != null) {
          found = { reason: 'COUNTED_AGAIN', countNumber: o.count.countNumber, stationId: null, when: oAt };
        }
      }
      if (found && (!best || found.when > best.when)) best = found;
    }
    if (best) out.set(line.id, best);
  }
  return out;
}

/** "Left alone: Salt was already adjusted by count CC-2026-000009 (posted Sep 22)." */
export function leftAloneMessage(name: string, newer: NewerCount | null | undefined): string {
  if (!newer) return `Left alone: ${name} was counted again later.`;
  return newer.reason === 'ADJUSTED'
    ? `Left alone: ${name} was already adjusted by count ${newer.countNumber} (posted ${monthDay(newer.when)}).`
    : `Left alone: ${name} was counted again later (${newer.countNumber}, ${monthDay(newer.when)}).`;
}
