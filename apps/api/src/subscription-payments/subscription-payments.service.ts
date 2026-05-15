/**
 * Sprint 24 — Manual subscription payment collection.
 *
 * Pre-PayMongo flow. Customer pays via owner's personal Maya / BDO /
 * Maribank account, submits proof (transaction ID + screenshot), owner
 * verifies in /admin/payments-pending and issues a paper BIR Official
 * Receipt from the accredited booklet.
 *
 * Lifecycle:
 *   AWAITING_PROOF → PROOF_SUBMITTED → CONFIRMED (with OR issued)
 *                                    → REJECTED  (with reason)
 *                  → EXPIRED (after 30 days of no proof)
 *
 * Migrates to PayMongo seamlessly later: the same `PendingPayment` shape
 * will be created by the PayMongo webhook, just with `submittedMethod:
 * 'PAYMONGO_GCASH'` etc. and auto-confirmation.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PLAN_CAPS, type PlanCode } from '@repo/shared-types';

const REFERENCE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I to avoid confusion
const REFERENCE_CODE_LENGTH = 5;
const PROOF_TTL_DAYS = 30;

export type CreatePendingPaymentInput = {
  tenantId:  string;
  planCode:  PlanCode;
  reason:    'NEW_SIGNUP' | 'MONTHLY_RENEWAL' | 'PLAN_UPGRADE';
  /** Period this payment covers — typically a 1-month window. */
  periodStart: Date;
  periodEnd:   Date;
};

export type SubmitProofInput = {
  referenceCode: string;
  /** Transaction ID / Maya ref / InstaPay reference number. */
  submittedRefId: string;
  /** Free-text notes from customer. */
  submittedNotes?: string;
  /** Which method the customer claims they paid with. */
  submittedMethod: 'MAYA' | 'BDO' | 'MARIBANK' | 'GCASH';
  /** R2 URL of the receipt screenshot (uploaded separately via storage service). */
  submittedProofUrl?: string;
};

export type ConfirmPaymentInput = {
  pendingPaymentId: string;
  /** Owner-entered OR number from the paper booklet. Must be gap-free. */
  orNumber: string;
  /** R2 URL of the scanned paper OR (optional but recommended). */
  scannedCopyUrl?: string;
  /** User performing the confirmation. */
  confirmedById: string;
};

@Injectable()
export class SubscriptionPaymentsService {
  private readonly logger = new Logger(SubscriptionPaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Customer-facing ────────────────────────────────────────────────────

  /**
   * Create a pending payment for a new signup or renewal. Generates a
   * unique 5-char reference code the customer puts in their transfer remarks.
   * Idempotent on (tenantId, periodStart, reason) so re-running doesn't
   * create duplicates.
   */
  async createPendingPayment(input: CreatePendingPaymentInput) {
    const cap = PLAN_CAPS[input.planCode];
    if (!cap) {
      throw new BadRequestException(`Unknown plan code: ${input.planCode}`);
    }
    if (cap.pricePhpMonthlyCents <= 0) {
      throw new BadRequestException(
        `Plan ${input.planCode} has no monthly price (ENTERPRISE plans billed manually).`,
      );
    }

    // Idempotency: don't create a duplicate AWAITING/SUBMITTED record for
    // the same period + reason. If one exists, return it.
    const existing = await this.prisma.pendingPayment.findFirst({
      where: {
        tenantId:     input.tenantId,
        periodStart:  input.periodStart,
        reason:       input.reason,
        status:       { in: ['AWAITING_PROOF', 'PROOF_SUBMITTED'] },
      },
    });
    if (existing) return existing;

    const referenceCode = await this.generateUniqueReferenceCode(input.reason);
    const expiresAt = new Date(Date.now() + PROOF_TTL_DAYS * 24 * 60 * 60 * 1000);

    return this.prisma.pendingPayment.create({
      data: {
        tenantId:       input.tenantId,
        planCode:       input.planCode,
        amountPhpCents: cap.pricePhpMonthlyCents,
        periodStart:    input.periodStart,
        periodEnd:      input.periodEnd,
        reason:         input.reason,
        referenceCode,
        status:         'AWAITING_PROOF',
        expiresAt,
      },
    });
  }

  /** Look up a pending payment by reference code — for the /pay/<ref> page. */
  async getByReferenceCode(referenceCode: string) {
    const payment = await this.prisma.pendingPayment.findUnique({
      where: { referenceCode },
      include: { tenant: { select: { name: true, slug: true } } },
    });
    if (!payment) {
      throw new NotFoundException(`No pending payment for reference ${referenceCode}.`);
    }
    return payment;
  }

  /**
   * Customer submits proof of payment. Moves status to PROOF_SUBMITTED.
   * Owner now needs to verify in /admin/payments-pending.
   */
  async submitProof(input: SubmitProofInput) {
    const payment = await this.prisma.pendingPayment.findUnique({
      where: { referenceCode: input.referenceCode },
    });
    if (!payment) {
      throw new NotFoundException(`No pending payment for reference ${input.referenceCode}.`);
    }
    if (payment.status === 'CONFIRMED') {
      throw new ConflictException('This payment has already been confirmed.');
    }
    if (payment.status === 'REJECTED' || payment.status === 'EXPIRED') {
      throw new ConflictException(
        `This payment cannot accept proof — status is ${payment.status}. Contact support.`,
      );
    }

    return this.prisma.pendingPayment.update({
      where: { id: payment.id },
      data: {
        status:             'PROOF_SUBMITTED',
        submittedAt:        new Date(),
        submittedRefId:     input.submittedRefId,
        submittedNotes:     input.submittedNotes,
        submittedMethod:    input.submittedMethod,
        submittedProofUrl:  input.submittedProofUrl,
      },
    });
  }

  // ─── Owner-facing (admin) ───────────────────────────────────────────────

  /** List pending payments for the admin verification UI. */
  async listForAdmin(filter?: { status?: 'AWAITING_PROOF' | 'PROOF_SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED' }) {
    return this.prisma.pendingPayment.findMany({
      where:   filter?.status ? { status: filter.status } : undefined,
      include: {
        tenant: { select: { id: true, name: true, slug: true, contactEmail: true, tin: true } },
      },
      orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Owner confirms a payment. Issues a BIR Official Receipt from the paper
   * booklet, links it to the pending payment, advances the tenant to ACTIVE.
   * Idempotent on (pendingPaymentId).
   *
   * BIR gap-free OR rule: rejects if `orNumber` is lower than the platform's
   * `lastOrNumber` — owner cannot reuse numbers nor skip ahead arbitrarily.
   */
  async confirmPayment(input: ConfirmPaymentInput) {
    const payment = await this.prisma.pendingPayment.findUnique({
      where:   { id: input.pendingPaymentId },
      include: { tenant: { select: { id: true, name: true, tin: true, address: true } } },
    });
    if (!payment) throw new NotFoundException('Pending payment not found.');
    if (payment.status === 'CONFIRMED') {
      throw new ConflictException('Already confirmed.');
    }
    if (payment.status === 'REJECTED' || payment.status === 'EXPIRED') {
      throw new ConflictException(`Cannot confirm — status is ${payment.status}.`);
    }

    // OR# validation: must not duplicate, must be sequential (>= last + 1).
    const platform = await this.prisma.platformConfig.findUnique({ where: { id: 'platform' } });
    if (!platform) {
      throw new BadRequestException('Platform config missing — run bootstrap.');
    }
    const orNumber = input.orNumber.trim();
    if (!/^\d+$/.test(orNumber)) {
      throw new BadRequestException('OR number must be numeric.');
    }
    if (platform.lastOrNumber && parseInt(orNumber, 10) <= parseInt(platform.lastOrNumber, 10)) {
      throw new BadRequestException(
        `OR number ${orNumber} is not greater than the last-issued ${platform.lastOrNumber}. ` +
        `BIR requires gap-free sequential numbering — use the next number from your booklet.`,
      );
    }
    const existingOr = await this.prisma.officialReceipt.findUnique({ where: { orNumber } });
    if (existingOr) {
      throw new ConflictException(`OR number ${orNumber} already used.`);
    }

    // Compute Non-VAT vs VAT split based on platform tax status.
    const isVat = platform.taxStatus === 'VAT';
    const vatAmountPhpCents = isVat
      ? Math.round(payment.amountPhpCents - payment.amountPhpCents / 1.12)
      : 0;

    return this.prisma.$transaction(async (tx) => {
      // 1. Create OR record
      const or = await tx.officialReceipt.create({
        data: {
          orNumber,
          issuedAt:           new Date(),
          issuedById:         input.confirmedById,
          payerTenantId:      payment.tenantId,
          payerName:          payment.tenant.name,
          payerTin:           payment.tenant.tin,
          payerAddress:       payment.tenant.address,
          amountPhpCents:     payment.amountPhpCents,
          taxStatus:          isVat ? 'VAT_12' : 'NON_VAT',
          vatAmountPhpCents,
          description:        `Clerque ${payment.planCode} subscription, ${payment.periodStart.toISOString().slice(0, 7)}`,
          scannedCopyUrl:     input.scannedCopyUrl,
        },
      });

      // 2. Update pending payment
      const updated = await tx.pendingPayment.update({
        where: { id: payment.id },
        data: {
          status:            'CONFIRMED',
          confirmedAt:       new Date(),
          confirmedById:     input.confirmedById,
          officialReceiptId: or.id,
        },
      });

      // 3. Advance platform's lastOrNumber so the UI suggests next-in-sequence
      await tx.platformConfig.update({
        where: { id: 'platform' },
        data:  { lastOrNumber: orNumber },
      });

      // 4. Flip tenant to ACTIVE (from GRACE) — only on NEW_SIGNUP confirms.
      // For MONTHLY_RENEWAL, tenant was already ACTIVE; nothing to flip.
      if (payment.reason === 'NEW_SIGNUP') {
        await tx.tenant.update({
          where: { id: payment.tenantId },
          data:  { status: 'ACTIVE' },
        });
      }

      return { pendingPayment: updated, officialReceipt: or };
    });
  }

  /** Owner rejects a payment (wrong amount, can't find deposit, etc.). */
  async rejectPayment(pendingPaymentId: string, rejectedById: string, reason: string) {
    const payment = await this.prisma.pendingPayment.findUnique({
      where: { id: pendingPaymentId },
    });
    if (!payment) throw new NotFoundException('Pending payment not found.');
    if (payment.status === 'CONFIRMED') {
      throw new ConflictException('Cannot reject an already-confirmed payment.');
    }

    return this.prisma.pendingPayment.update({
      where: { id: payment.id },
      data: {
        status:           'REJECTED',
        rejectedAt:       new Date(),
        rejectedById,
        rejectionReason:  reason,
      },
    });
  }

  // ─── Background ─────────────────────────────────────────────────────────

  /**
   * Daily — expire AWAITING_PROOF rows that have passed their expiresAt.
   * Customer must re-submit (creating a new pending payment) if they
   * still want to subscribe.
   */
  @Cron('0 3 * * *')
  async expireStaleAwaiting() {
    const result = await this.prisma.pendingPayment.updateMany({
      where: {
        status:    'AWAITING_PROOF',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
    if (result.count > 0) {
      this.logger.log(`[subscription-payments] expired ${result.count} stale pending payments`);
    }
    return result;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Generates a 5-char human-readable reference code. Examples:
   *   SIGNUP-7Z2K1, RENEW-9XPQ3, UPGRADE-4M5N2
   * Retries on (very unlikely) collision.
   */
  private async generateUniqueReferenceCode(
    reason: 'NEW_SIGNUP' | 'MONTHLY_RENEWAL' | 'PLAN_UPGRADE',
  ): Promise<string> {
    const prefix =
      reason === 'NEW_SIGNUP' ? 'SIGNUP' :
      reason === 'MONTHLY_RENEWAL' ? 'RENEW' : 'UPGRADE';

    for (let attempt = 0; attempt < 10; attempt++) {
      const suffix = Array.from(
        { length: REFERENCE_CODE_LENGTH },
        () => REFERENCE_CODE_ALPHABET[Math.floor(Math.random() * REFERENCE_CODE_ALPHABET.length)],
      ).join('');
      const code = `${prefix}-${suffix}`;
      const existing = await this.prisma.pendingPayment.findUnique({
        where: { referenceCode: code },
      });
      if (!existing) return code;
    }
    throw new Error('Failed to generate unique reference code after 10 attempts — alphabet exhausted?');
  }
}
