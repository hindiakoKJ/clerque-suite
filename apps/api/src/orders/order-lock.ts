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
