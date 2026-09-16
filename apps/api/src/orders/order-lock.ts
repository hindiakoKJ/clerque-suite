import { Prisma } from '@prisma/client';

/**
 * Take the order's row lock for the rest of the transaction.
 *
 * Interactive transactions run at READ COMMITTED: two bumps on one order (the
 * bar's latte and the kitchen's sandwich at the same moment), or a bump and a
 * refund, each saw the other line still waiting and neither completed the
 * order. Everything that changes an order's lines or status -- bump, un-bump,
 * serve, refund, void -- takes this lock first, in that order, so they queue.
 */
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "orders" WHERE id = ${orderId} FOR UPDATE`;
}

/**
 * Wait for any till sale of the shop that is still being written.
 *
 * A ready tap (or its un-bump) writes ingredient stock rows and lot layers --
 * the same rows a sale writes, but in its own recipe order, stock row before
 * lot. Two transactions taking the same rows in opposite orders deadlock, and
 * Postgres aborts one: the cashier's sale or the barista's tap. Every sale
 * first takes its shop's POS order counter row (numbering.next), so taking that
 * row here too makes taps and sales queue instead of cross. A shop with no
 * counter row has never sold, so it has nothing waiting to confirm.
 */
export async function queueBehindSales(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "document_number_sequences" WHERE "tenantId" = ${tenantId} AND type = 'POS_ORDER' AND "branchId" IS NULL FOR UPDATE`;
}
