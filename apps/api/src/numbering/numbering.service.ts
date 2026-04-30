/**
 * NumberingService — generates sequential document numbers per tenant per type.
 *
 * Used by AR (invoices, payments) and AP (bills, payments). Designed to be
 * called inside an existing Prisma transaction so the counter increment and
 * the document insert happen atomically — same pattern as Order.orderNumber
 * but generalised across document types.
 *
 * Format strings:
 *   - "{YYYY}" → 2026
 *   - "{YY}"   → 26
 *   - "{MM}"   → 04
 *   - "{####}" → zero-padded counter (digits = padding column)
 *
 * Examples:
 *   prefix=""    format="INV-{YYYY}-{####}" padding=4 → "INV-2026-0001"
 *   prefix="OR"  format=null                padding=6 → "OR000042"
 *
 * Reset policies decide when the counter resets to 1:
 *   NEVER   — never (tenant-wide perpetual sequence)
 *   YEARLY  — first call in a new calendar year (UTC)
 *   MONTHLY — first call in a new calendar month (UTC)
 *
 * BIR-friendly defaults (set by ensureSequence on first use):
 *   AR_INVOICE: prefix "INV", format "INV-{YYYY}-{####}", padding 4, NEVER
 *   AR_PAYMENT: prefix "OR" (Official Receipt), format "OR-{YYYY}-{####}", NEVER
 *   AP_BILL:    prefix "BILL", format "BILL-{YYYY}-{####}", NEVER
 *   AP_PAYMENT: prefix "VP" (Vendor Payment), format "VP-{YYYY}-{####}", NEVER
 *
 * Owners can edit prefix / format / padding / reset policy via a future
 * admin endpoint (not built yet). Defaults work for most PH MSMEs out of the
 * box.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, SequenceType, SequenceResetPolicy } from '@prisma/client';

interface SequenceDefaults {
  prefix:      string;
  format:      string;
  padding:     number;
  resetPolicy: SequenceResetPolicy;
}

/** Defaults applied on first use of each type per tenant. */
const DEFAULTS: Record<SequenceType, SequenceDefaults> = {
  AR_INVOICE: { prefix: 'INV',  format: 'INV-{YYYY}-{####}',  padding: 4, resetPolicy: 'NEVER' },
  AR_PAYMENT: { prefix: 'OR',   format: 'OR-{YYYY}-{####}',   padding: 4, resetPolicy: 'NEVER' },
  AP_BILL:    { prefix: 'BILL', format: 'BILL-{YYYY}-{####}', padding: 4, resetPolicy: 'NEVER' },
  AP_PAYMENT: { prefix: 'VP',   format: 'VP-{YYYY}-{####}',   padding: 4, resetPolicy: 'NEVER' },
};

@Injectable()
export class NumberingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Reserve and return the next document number for a given tenant + type.
   * Atomic — call inside a transaction so the increment and the consuming
   * insert succeed together.
   *
   * @param tenantId  Caller's tenant.
   * @param type      Sequence to draw from.
   * @param branchId  null for tenant-wide (default); pass a branch id only
   *                  when the tenant has explicitly opted into per-branch
   *                  numbering by creating a per-branch sequence row.
   * @param tx        Optional transaction client. Defaults to global prisma.
   *                  Pass when calling from inside `prisma.$transaction`.
   */
  async next(
    tenantId: string,
    type:     SequenceType,
    branchId: string | null = null,
    tx:       Prisma.TransactionClient | null = null,
  ): Promise<string> {
    const client = tx ?? this.prisma;

    // Find or create the sequence row for this (tenant, type, branchId).
    // findFirst (not findUnique) because Postgres treats NULL as distinct in
    // compound unique constraints — branchId IS NULL won't match other NULL
    // rows. Service-level uniqueness via the existence check + serialized
    // counter increment below is sufficient for the volume this sees.
    let seq = await client.documentNumberSequence.findFirst({
      where: { tenantId, type, branchId },
    });

    if (!seq) {
      const d = DEFAULTS[type];
      seq = await client.documentNumberSequence.create({
        data: {
          tenantId,
          type,
          branchId,
          prefix:      d.prefix,
          format:      d.format,
          padding:     d.padding,
          counter:     0,
          resetPolicy: d.resetPolicy,
        },
      });
    }

    // Reset policy: if YEARLY/MONTHLY and we're past the boundary, reset to 0.
    const now = new Date();
    const shouldReset = this.shouldResetCounter(seq.resetPolicy, seq.lastResetAt, now);

    // Atomic increment (or reset-and-increment).
    // Postgres UPDATE returns the row; using `update` with `data: { counter: { increment: 1 } }`
    // is one statement, so concurrent calls serialize on the row lock.
    const updated = shouldReset
      ? await client.documentNumberSequence.update({
          where: { id: seq.id },
          data:  { counter: 1, lastResetAt: now },
        })
      : await client.documentNumberSequence.update({
          where: { id: seq.id },
          data:  { counter: { increment: 1 } },
        });

    return this.formatNumber(updated.counter, updated, now);
  }

  /**
   * Format the counter into a user-visible string per the sequence's format
   * field. If format is null, fall back to prefix + zero-padded counter.
   */
  private formatNumber(
    counter:  number,
    seq:      { prefix: string; format: string | null; padding: number },
    now:      Date,
  ): string {
    const pad = (n: number, len: number) => String(n).padStart(len, '0');

    if (!seq.format) {
      return `${seq.prefix}${pad(counter, seq.padding)}`;
    }

    return seq.format
      .replace(/\{YYYY\}/g, String(now.getUTCFullYear()))
      .replace(/\{YY\}/g,   String(now.getUTCFullYear()).slice(-2))
      .replace(/\{MM\}/g,   pad(now.getUTCMonth() + 1, 2))
      .replace(/\{#+\}/g,   (m) => pad(counter, m.length - 2)); // {####} → 4 digits
  }

  /** Has the calendar boundary crossed since the last reset? */
  private shouldResetCounter(
    policy: SequenceResetPolicy,
    last:   Date | null,
    now:    Date,
  ): boolean {
    if (policy === 'NEVER') return false;
    if (!last) return true; // never reset → first call after policy change

    if (policy === 'YEARLY') {
      return last.getUTCFullYear() !== now.getUTCFullYear();
    }
    if (policy === 'MONTHLY') {
      return (
        last.getUTCFullYear() !== now.getUTCFullYear() ||
        last.getUTCMonth()    !== now.getUTCMonth()
      );
    }
    return false;
  }

  /**
   * Inspect a tenant's current sequence settings — for an admin page.
   * Returns one row per type per branch (null branch = tenant-wide).
   */
  async list(tenantId: string) {
    return this.prisma.documentNumberSequence.findMany({
      where:   { tenantId },
      orderBy: [{ type: 'asc' }, { branchId: 'asc' }],
    });
  }

  /**
   * Update a sequence's configuration. Counter cannot be DECREASED via this
   * endpoint — that would risk duplicate document numbers — but it can be
   * incremented (e.g. to skip ahead after a manual data correction).
   */
  async update(
    tenantId: string,
    sequenceId: string,
    patch: {
      prefix?:      string;
      format?:      string | null;
      padding?:     number;
      resetPolicy?: SequenceResetPolicy;
      counter?:     number;       // monotonic — must be >= current
    },
  ) {
    const seq = await this.prisma.documentNumberSequence.findFirst({
      where: { id: sequenceId, tenantId },
    });
    if (!seq) throw new BadRequestException('Sequence not found.');

    if (patch.counter !== undefined && patch.counter < seq.counter) {
      throw new BadRequestException(
        `counter cannot decrease (current: ${seq.counter}, requested: ${patch.counter}).`,
      );
    }
    if (patch.padding !== undefined && (patch.padding < 1 || patch.padding > 12)) {
      throw new BadRequestException('padding must be between 1 and 12.');
    }

    return this.prisma.documentNumberSequence.update({
      where: { id: sequenceId },
      data:  patch,
    });
  }
}
