import type { PrismaService } from '../prisma/prisma.service';

/** Failed sign-ins within this window lock the account. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/**
 * LoginLog.reason values that mark "the failures before this no longer count".
 *
 * login_logs is INSERT-only at the database (an audit trigger refuses every
 * DELETE), so an admin who resets a password or unlocks an account cannot
 * clear the failures by deleting them -- the Console reset used to try, and
 * failed with a 500. Instead it writes one of these marker rows, and the
 * lockout only counts failures after the newest marker.
 */
export const LOCKOUT_CLEARED_REASONS = ['ADMIN_PASSWORD_RESET', 'ADMIN_UNLOCK'] as const;
export type LockoutClearedReason = (typeof LOCKOUT_CLEARED_REASONS)[number];

type LoginLogDb = Pick<PrismaService, 'loginLog'>;

/** How many failed sign-ins count against this user right now. */
export async function recentFailedLogins(db: LoginLogDb, userId: string, now = new Date()): Promise<number> {
  const windowStart = new Date(now.getTime() - LOCKOUT_MINUTES * 60 * 1000);
  const cleared = await db.loginLog.findFirst({
    where:   { userId, reason: { in: [...LOCKOUT_CLEARED_REASONS] }, createdAt: { gte: windowStart } },
    orderBy: { createdAt: 'desc' },
    select:  { createdAt: true },
  });
  return db.loginLog.count({
    where: {
      userId,
      success:   false,
      createdAt: cleared ? { gt: cleared.createdAt } : { gte: windowStart },
    },
  });
}

/**
 * The marker row an admin reset or unlock writes instead of deleting failures.
 * success is true only so no "failed attempts" count ever includes it; the
 * reason says it was an admin action, not a sign-in.
 */
export function lockoutClearedRow(
  user: { id: string; email: string; tenantId: string | null },
  reason: LockoutClearedReason,
) {
  return { userId: user.id, tenantId: user.tenantId, email: user.email, success: true, reason };
}
