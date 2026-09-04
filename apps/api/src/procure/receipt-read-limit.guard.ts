import {
  CallHandler, CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import type { JwtPayload } from '@repo/shared-types';
import { PH_TIMEZONE } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A daily cap on receipt reads, per tenant.
 *
 * The monthly AI quota and the monthly dollar budget both exist, and both are
 * the wrong shape for this: a photo read is the one AI action a shop can fire
 * from the kitchen floor, dozens of times a day, with a phone. Somebody
 * re-photographing a crumpled receipt fifteen times should hit a wall
 * TODAY, not on the 28th when the month's quota is gone and the drafter stops
 * working too.
 *
 * What the AI may do with a receipt is not decided here -- it was decided by
 * construction: the model reads a photo into lines and nothing else. It never
 * picks an ingredient, never posts stock, never creates anything. This guard
 * only decides how many times a day it may be asked to read.
 *
 * The number is an environment setting, not code, because the owner said it
 * will be adjusted from time to time. 50 is the default. A tenant-specific
 * override follows the same pattern as the monthly budget.
 *
 * Counted from AiUsage, which every call writes. Rows that spent nothing --
 * a provider outage, a bad model id, a network error -- do not count, or an
 * outage at 09:00 would lock the shop out until midnight for reads that never
 * happened.
 *
 * In-flight reads count too. The AiUsage row lands only after the provider
 * answers, five to fifteen seconds after the request began, and in that
 * window a stuck retry loop could fire a hundred reads that all see "49 of
 * 50". The ledger below holds a reservation from the moment the guard passes
 * until the response is sent, so the wall is the wall for a runaway client
 * as well as for a patient one.
 */

export const RECEIPT_READ_ACTION = 'procure_receipt_lines';
export const DEFAULT_RECEIPT_READS_PER_DAY = 50;

/**
 * The cap for this tenant: per-tenant override, then the deployment default,
 * then 50.
 *
 * Blank means "not set", never zero. Clearing the variable in Railway leaves
 * it as an empty string, and writing null into the tenant map is how an
 * override is removed; neither may switch a shop off. Zero has to be typed.
 */
export function resolveDailyReadLimit(tenantId: string): number {
  const byTenant = process.env.AI_RECEIPT_READS_PER_DAY_BY_TENANT?.trim();
  if (byTenant) {
    try {
      const map = JSON.parse(byTenant) as Record<string, unknown>;
      const v = map?.[tenantId];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
    } catch {
      // Malformed JSON falls through to the deployment default rather than
      // switching the feature off for everyone.
    }
  }
  const raw = process.env.AI_RECEIPT_READS_PER_DAY?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return DEFAULT_RECEIPT_READS_PER_DAY;
}

/**
 * Midnight at the start of today, in the shop's own day.
 *
 * "Today" is Manila's today. Counting from UTC midnight would reset the cap
 * at 08:00 local -- in the middle of the morning market run, which is when
 * receipts arrive. Manila has no daylight saving, so the offset is fixed.
 */
export function startOfShopDay(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00+08:00`);
}

export interface ReceiptReads { usedToday: number; limit: number; resetsAt: string }

/** How many reads this tenant has spent today, and how many it gets. */
export async function receiptReadsToday(
  prisma: Pick<PrismaService, 'aiUsage'>,
  tenantId: string,
  now: Date = new Date(),
): Promise<ReceiptReads> {
  const start = startOfShopDay(now);
  const usedToday = await prisma.aiUsage.count({
    where: {
      tenantId,
      action:    RECEIPT_READ_ACTION,
      createdAt: { gte: start },
      // Only reads that cost something. A rejected call writes a row with no
      // tokens; fifteen of those in an outage are not fifteen reads.
      OR: [{ success: true }, { inputTokens: { gt: 0 } }],
    },
  });
  return {
    usedToday,
    limit:    resolveDailyReadLimit(tenantId),
    resetsAt: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

/**
 * Reads that have passed the guard and not yet finished.
 *
 * Process-local on purpose: the API runs as one instance, and a reservation
 * that outlived a crash would be worse than one that did not survive it.
 */
@Injectable()
export class ReceiptReadLedger {
  private readonly inflight = new Map<string, number>();
  pending(tenantId: string): number { return this.inflight.get(tenantId) ?? 0; }
  reserve(tenantId: string): void { this.inflight.set(tenantId, this.pending(tenantId) + 1); }
  release(tenantId: string): void {
    const n = this.pending(tenantId) - 1;
    if (n <= 0) this.inflight.delete(tenantId);
    else this.inflight.set(tenantId, n);
  }
}

@Injectable()
export class ReceiptReadLimitGuard implements CanActivate {
  constructor(private prisma: PrismaService, private ledger: ReceiptReadLedger) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;
    const tenantId = user?.tenantId;
    // No tenant means JwtAuthGuard already said no, or will; nothing to count.
    if (!tenantId) return true;

    const reads = await receiptReadsToday(this.prisma, tenantId);
    const used = reads.usedToday + this.ledger.pending(tenantId);
    if (used >= reads.limit) {
      throw new HttpException(
        {
          code:      'RECEIPT_READS_EXHAUSTED',
          limit:     reads.limit,
          usedToday: used,
          resetsAt:  reads.resetsAt,
          message:   reads.limit === 0
            ? 'Receipt reading is switched off for this account. Type the lines in instead.'
            : `Today's ${reads.limit} receipt reads are used up. Type the lines in, or read again after midnight.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Held until the response goes out; ReleaseReceiptReadInterceptor lets go.
    this.ledger.reserve(tenantId);
    (req as { receiptReads?: ReceiptReads }).receiptReads = { ...reads, usedToday: used };
    return true;
  }
}

/**
 * Lets the reservation go when the request ends -- however it ends.
 *
 * An interceptor rather than a `finally` in the handler, because a body that
 * fails validation never reaches the handler: the pipe throws inside the
 * observable this wraps, so `finalize` still runs and the slot is not leaked.
 */
@Injectable()
export class ReleaseReceiptReadInterceptor implements NestInterceptor {
  constructor(private ledger: ReceiptReadLedger) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const tenantId = (req.user as JwtPayload | undefined)?.tenantId;
    if (!tenantId || !(req as { receiptReads?: unknown }).receiptReads) return next.handle();
    return next.handle().pipe(finalize(() => this.ledger.release(tenantId)));
  }
}
