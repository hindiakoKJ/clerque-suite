import { Prisma } from '@prisma/client';
import { HOLDING_STATUSES, WAITING_LINE } from '../orders/held-usage';

/**
 * What a period close must wait for under the owner's rule that a kitchen or
 * bar ticket books its cost when it is marked ready.
 *
 * That cost is dated to the SALE. A ticket sold on the 31st and marked ready
 * -- or confirmed by the 02:30 nightly job -- on the 1st posts into the 31st.
 * Close the month in between and the entry can never post: the books are
 * short by it, and nothing says which one. So a close waits for:
 *
 *   - lines sold up to the period's end that are still waiting at a screen;
 *   - cost-of-goods entries (a confirm, or usage given back on an un-bump)
 *     dated into the period by their sale, however late they were created --
 *     the existing check counts only events CREATED by the end date;
 *   - waste entries (a made item voided or refunded) created by the end of
 *     the period's last day. They are dated to the void or refund, but the
 *     existing check stops at 8 AM of that day: a latte refunded at 8:55 PM on
 *     the 30th, still posting when the owner closes at 9 PM, would be locked out.
 *
 * The period's endDate is stored as midnight UTC of its last day, which is
 * 08:00 in Manila; the shop's day ends sixteen hours later.
 */

type Db = Pick<Prisma.TransactionClient, 'orderItem' | 'accountingEvent'>;

/** 23:59:59.999 Manila on the calendar day a period's endDate names. */
export function manilaEndOfDay(endDate: Date): Date {
  return new Date(`${endDate.toISOString().slice(0, 10)}T23:59:59.999+08:00`);
}

export async function ticketsHoldingPeriod(db: Db, tenantId: string, through: Date): Promise<{ waiting: number; unposted: number }> {
  const lines = await db.orderItem.findMany({
    where: {
      ...WAITING_LINE,
      order: { tenantId, deletedAt: null, status: { in: [...HOLDING_STATUSES] }, paidAt: { lte: through } },
    },
    select: { quantity: true, refundedQty: true },
  });
  const waiting = lines.filter((l) => Number(l.quantity) - Number(l.refundedQty) > 1e-9).length;
  const unposted = await db.accountingEvent.count({
    where: {
      tenantId,
      status: { in: ['PENDING', 'FAILED'] },
      OR: [
        // Dated to the sale, however late they were created.
        { type: 'COGS', order: { paidAt: { lte: through } } },
        { type: 'COGS_ADJUSTMENT', payload: { path: ['kind'], equals: 'USAGE_RETURNED' }, order: { paidAt: { lte: through } } },
        // Dated to the void or refund, the day it was created. Matched on the kind
        // itself: a JSON-path "not equals" would also drop rows without the key.
        { type: 'COGS_ADJUSTMENT', payload: { path: ['kind'], equals: 'WASTE' }, createdAt: { lte: through } },
      ],
    },
  });
  return { waiting, unposted };
}

export function ticketsHoldingMessage(what: string, t: { waiting: number; unposted: number }): string | null {
  if (t.waiting > 0) {
    return `${t.waiting} kitchen/bar item${t.waiting === 1 ? '' : 's'} sold in ${what} ${t.waiting === 1 ? 'is' : 'are'} still waiting ` +
      'to be marked ready, and their cost belongs to it. Mark them ready on the station screen (or void them if they were never made), ' +
      'or wait for the 2:30 AM confirm, then close.';
  }
  if (t.unposted > 0) {
    return `${t.unposted} cost-of-goods or waste entr${t.unposted === 1 ? 'y' : 'ies'} from ${what} ` +
      '(kitchen/bar items marked ready, or made items voided or refunded) ' +
      `${t.unposted === 1 ? 'has' : 'have'} not reached the books yet. They usually post within a minute — try again shortly, ` +
      'or review them under Ledger → Accounting Events.';
  }
  return null;
}
