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
import { MailService } from '../mail/mail.service';
import { PLAN_CAPS, planLabel, type PlanCode } from '@repo/shared-types';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail:   MailService,
  ) {}

  private fmtPhp(cents: number): string {
    const peso = cents / 100;
    return `₱${peso.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private fmtDate(d: Date): string {
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  private fmtMonthYear(d: Date): string {
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });
  }

  private buildPayUrl(referenceCode: string): string {
    const base = process.env.WEB_PUBLIC_URL || 'https://clerque.cc';
    return `${base}/pay/${referenceCode}`;
  }

  /** Public-facing version returning the payment methods (called by the controller). */
  async getPublicPaymentMethods(): Promise<Array<{ label: string; accountDisplay: string; instructions?: string; qrImageUrl?: string }>> {
    return this.getPaymentMethods();
  }

  /** Read the configured payment methods JSON from PlatformConfig. */
  private async getPaymentMethods(): Promise<Array<{ label: string; accountDisplay: string; instructions?: string; qrImageUrl?: string }>> {
    const platform = await this.prisma.platformConfig.findUnique({
      where:  { id: 'platform' },
      select: { paymentMethodsJson: true },
    });
    const raw = platform?.paymentMethodsJson;
    if (!Array.isArray(raw)) return [];
    return raw as Array<{ label: string; accountDisplay: string; instructions?: string }>;
  }

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

    const created = await this.prisma.pendingPayment.create({
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

    // Fire-and-forget the payment-instructions email (failed sends shouldn't
    // block tenant creation — the customer can also find the link on screen).
    void this.sendInstructionsEmail(created.id).catch((err) =>
      this.logger.warn(`[subscription-payments] failed to send instructions email: ${(err as Error).message}`),
    );

    return created;
  }

  /** Re-send the payment-instructions email (e.g., owner triggers from admin). */
  async sendInstructionsEmail(pendingPaymentId: string): Promise<void> {
    const payment = await this.prisma.pendingPayment.findUnique({
      where:   { id: pendingPaymentId },
      include: { tenant: { select: { name: true, contactEmail: true } } },
    });
    if (!payment) return;
    if (!payment.tenant.contactEmail) {
      this.logger.warn(`[subscription-payments] tenant ${payment.tenantId} has no contactEmail — instructions not sent`);
      return;
    }

    const methods = await this.getPaymentMethods();
    if (methods.length === 0) {
      this.logger.warn('[subscription-payments] No payment methods configured — email will list zero options.');
    }

    await this.mail.sendSubscriptionPaymentInstructions({
      to:             payment.tenant.contactEmail,
      tenantName:     payment.tenant.name,
      planLabel:      planLabel(payment.planCode as PlanCode),
      amountPhp:      this.fmtPhp(payment.amountPhpCents),
      referenceCode:  payment.referenceCode,
      paymentMethods: methods,
      payUrl:         this.buildPayUrl(payment.referenceCode),
      expiresAt:      this.fmtDate(payment.expiresAt),
      reason:         payment.reason,
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
    }).then(async (result) => {
      // Fire-and-forget confirmation email
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: payment.tenantId },
        select: { name: true, contactEmail: true },
      });
      if (tenant?.contactEmail) {
        void this.mail.sendSubscriptionPaymentConfirmed({
          to:          tenant.contactEmail,
          tenantName:  tenant.name,
          planLabel:   planLabel(payment.planCode as PlanCode),
          amountPhp:   this.fmtPhp(payment.amountPhpCents),
          orNumber:    result.officialReceipt.orNumber,
          periodLabel: this.fmtMonthYear(payment.periodStart),
        }).catch((err) =>
          this.logger.warn(`[subscription-payments] confirmation email failed: ${(err as Error).message}`),
        );
      }
      return result;
    });
  }

  /** Owner rejects a payment (wrong amount, can't find deposit, etc.). */
  async rejectPayment(pendingPaymentId: string, rejectedById: string, reason: string) {
    const payment = await this.prisma.pendingPayment.findUnique({
      where:   { id: pendingPaymentId },
      include: { tenant: { select: { name: true, contactEmail: true } } },
    });
    if (!payment) throw new NotFoundException('Pending payment not found.');
    if (payment.status === 'CONFIRMED') {
      throw new ConflictException('Cannot reject an already-confirmed payment.');
    }

    const updated = await this.prisma.pendingPayment.update({
      where: { id: payment.id },
      data: {
        status:           'REJECTED',
        rejectedAt:       new Date(),
        rejectedById,
        rejectionReason:  reason,
      },
    });

    // Fire-and-forget rejection email so customer can re-submit
    if (payment.tenant.contactEmail) {
      void this.mail.sendSubscriptionPaymentRejected({
        to:              payment.tenant.contactEmail,
        tenantName:      payment.tenant.name,
        planLabel:       planLabel(payment.planCode as PlanCode),
        amountPhp:       this.fmtPhp(payment.amountPhpCents),
        referenceCode:   payment.referenceCode,
        rejectionReason: reason,
        payUrl:          this.buildPayUrl(payment.referenceCode),
      }).catch((err) =>
        this.logger.warn(`[subscription-payments] rejection email failed: ${(err as Error).message}`),
      );
    }

    return updated;
  }

  // ─── Background — renewal generation + expiration ──────────────────────

  /**
   * Daily — for every ACTIVE tenant on a Solo plan, check if a renewal
   * PendingPayment needs to be created for the next billing cycle.
   *
   * Trigger window: tenant's last CONFIRMED payment's periodEnd is between
   * NOW and NOW+5 days, AND no AWAITING/SUBMITTED renewal already exists
   * for the upcoming period.
   *
   * Sends the renewal-due email when the new PendingPayment is created.
   */
  @Cron('0 4 * * *')
  async generateMonthlyRenewals(): Promise<{ created: number; skipped: number }> {
    const now = new Date();
    const horizon = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    let created = 0;
    let skipped = 0;

    // Find ACTIVE tenants on a Solo plan whose most-recent CONFIRMED
    // payment's periodEnd is within 5 days. These need renewals queued.
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status:   'ACTIVE',
        planCode: { startsWith: 'SOLO_' },
      },
      select: {
        id: true,
        name: true,
        contactEmail: true,
        planCode: true,
        pendingPayments: {
          where:   { status: 'CONFIRMED' },
          orderBy: { periodEnd: 'desc' },
          take:    1,
          select:  { periodEnd: true, planCode: true },
        },
      },
    });

    for (const t of tenants) {
      const lastConfirmed = t.pendingPayments[0];
      if (!lastConfirmed) {
        skipped++;
        continue;
      }
      if (lastConfirmed.periodEnd > horizon) {
        skipped++;
        continue;
      }

      // Check there's no in-flight renewal already
      const periodStart = lastConfirmed.periodEnd;
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const existingRenewal = await this.prisma.pendingPayment.findFirst({
        where: {
          tenantId:    t.id,
          periodStart,
          reason:      'MONTHLY_RENEWAL',
          status:      { in: ['AWAITING_PROOF', 'PROOF_SUBMITTED'] },
        },
      });
      if (existingRenewal) {
        skipped++;
        continue;
      }

      try {
        const newPending = await this.createPendingPayment({
          tenantId:    t.id,
          planCode:    t.planCode as PlanCode,
          reason:      'MONTHLY_RENEWAL',
          periodStart,
          periodEnd,
        });

        // Send dedicated "renewal due in 5 days" reminder (different copy
        // than the generic instructions email auto-sent by createPendingPayment).
        if (t.contactEmail) {
          void this.mail.sendSubscriptionRenewalDue({
            to:            t.contactEmail,
            tenantName:    t.name,
            planLabel:     planLabel(t.planCode as PlanCode),
            amountPhp:     this.fmtPhp(newPending.amountPhpCents),
            referenceCode: newPending.referenceCode,
            dueDate:       this.fmtDate(lastConfirmed.periodEnd),
            payUrl:        this.buildPayUrl(newPending.referenceCode),
          }).catch((err) =>
            this.logger.warn(`[subscription-payments] renewal email failed for ${t.id}: ${(err as Error).message}`),
          );
        }

        created++;
      } catch (err) {
        this.logger.warn(
          `[subscription-payments] failed to create renewal for tenant ${t.id}: ${(err as Error).message}`,
        );
        skipped++;
      }
    }

    if (created > 0) {
      this.logger.log(`[subscription-payments] daily renewal pass: created=${created} skipped=${skipped}`);
    }
    return { created, skipped };
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
