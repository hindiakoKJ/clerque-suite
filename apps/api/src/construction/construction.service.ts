import {
  Injectable, BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, ProgressBillingStatus } from '@prisma/client';

/**
 * Project-Engine — Construction.
 *
 * Extends the existing Project model (already used by Manufacturing for
 * material issuance / WIP) with two construction-specific surfaces:
 *
 *  1. **ProgressBilling** — stage billing with retention. Each billing has:
 *       grossAmount   = stage value at percentComplete
 *       retentionAmount = grossAmount * retentionPercent / 100
 *       netAmount     = grossAmount - retentionAmount   (← what gets invoiced now)
 *     The retention is held back until project completion.
 *  2. **RetentionRelease** — release of withheld retention back to the client.
 *
 * No GL impact in this service — the AccountingEvent → JE path handles posting
 * of progress billings (Dr AR / Cr Service Revenue with retention parked in a
 * Retention-Held liability account) via PROGRESS_BILLING and RETENTION_RELEASE
 * event types.
 */
@Injectable()
export class ConstructionService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Progress billings ────────────────────────────────────────────────────

  async createProgressBilling(tenantId: string, dto: CreateProgressBillingDto) {
    if (!dto.projectId)        throw new BadRequestException('projectId is required.');
    if (!dto.stageDescription?.trim()) {
      throw new BadRequestException('stageDescription is required.');
    }
    const pct  = Number(dto.percentComplete);
    const gross = Number(dto.grossAmount);
    const retentionPct = dto.retentionPercent != null ? Number(dto.retentionPercent) : 10;

    if (!(pct > 0 && pct <= 100)) {
      throw new BadRequestException('percentComplete must be in (0, 100].');
    }
    if (!(gross > 0)) {
      throw new BadRequestException('grossAmount must be > 0.');
    }
    if (retentionPct < 0 || retentionPct > 100) {
      throw new BadRequestException('retentionPercent must be in [0, 100].');
    }

    // Tenant-scope guard.
    const project = await this.prisma.project.findFirst({
      where:  { id: dto.projectId, tenantId },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException('Project not found.');
    if (project.status === 'CANCELLED') {
      throw new BadRequestException('Cannot bill against a cancelled project.');
    }

    const retentionAmount = +(gross * retentionPct / 100).toFixed(2);
    const netAmount       = +(gross - retentionAmount).toFixed(2);

    // Billing number generation: PB-YYYY-{6-digit-seq per tenant per year}.
    const year   = new Date().getFullYear();
    const prefix = `PB-${year}-`;
    const last   = await this.prisma.progressBilling.findFirst({
      where:   { tenantId, billingNumber: { startsWith: prefix } },
      orderBy: { billingNumber: 'desc' },
      select:  { billingNumber: true },
    });
    const lastSeq      = last ? Number(last.billingNumber.slice(prefix.length)) || 0 : 0;
    const billingNumber = `${prefix}${String(lastSeq + 1).padStart(6, '0')}`;

    return this.prisma.progressBilling.create({
      data: {
        tenantId,
        projectId:        dto.projectId,
        billingNumber,
        stageDescription: dto.stageDescription.trim(),
        percentComplete:  pct as any,
        grossAmount:      gross as any,
        retentionPercent: retentionPct as any,
        retentionAmount:  retentionAmount as any,
        netAmount:        netAmount as any,
        status:           'DRAFT',
        notes:            dto.notes ?? null,
      },
    });
  }

  /**
   * Mark DRAFT billing as ISSUED. Atomic — only flips if status is currently
   * DRAFT (TOCTOU-safe). Frontend should issue an Order against this billing
   * via the existing AR flow; orderId is then linked back via linkOrder().
   *
   * Emits PROGRESS_BILLING accounting event with the gross/retention/net
   * breakdown so the kernel JE handler (Step B) can post:
   *   DR 1030 AR (gross)
   *   CR 4010 Revenue (gross net of VAT)
   *   CR 2020 Output VAT
   *   CR 2078 Retention Withheld (the held-back portion)
   * Until the handler ships, the event is no-op'd by the cron.
   */
  async issueProgressBilling(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.progressBilling.updateMany({
        where: { id, tenantId, status: 'DRAFT' },
        data:  { status: 'ISSUED', issuedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ConflictException('Billing is not in DRAFT or does not exist.');
      }
      const billing = await tx.progressBilling.findFirstOrThrow({
        where:  { id, tenantId },
        select: {
          id: true, billingNumber: true, projectId: true,
          grossAmount: true, retentionAmount: true, netAmount: true,
          stageDescription: true, percentComplete: true,
        },
      });
      await tx.accountingEvent.create({
        data: {
          tenantId,
          type:    'PROGRESS_BILLING',
          status:  'PENDING',
          payload: {
            billingId:        billing.id,
            billingNumber:    billing.billingNumber,
            projectId:        billing.projectId,
            grossAmount:      Number(billing.grossAmount),
            retentionAmount:  Number(billing.retentionAmount),
            netAmount:        Number(billing.netAmount),
            stageDescription: billing.stageDescription,
            percentComplete:  Number(billing.percentComplete),
            issuedAt:         new Date().toISOString(),
          },
        },
      });
      return this.getProgressBillingViaTx(tx, tenantId, id);
    });
  }

  /** Tx-scoped helper used by issueProgressBilling to avoid a second connection. */
  private async getProgressBillingViaTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ) {
    const billing = await tx.progressBilling.findFirst({
      where: { id, tenantId },
      include: {
        project:          { select: { id: true, name: true, projectCode: true, status: true } },
        retentionRelease: true,
        order:            { select: { id: true, orderNumber: true, status: true } },
      },
    });
    if (!billing) throw new NotFoundException('Progress billing not found.');
    return billing;
  }

  async linkOrderToBilling(tenantId: string, billingId: string, orderId: string) {
    // Validate both belong to the tenant.
    const [billing, order] = await Promise.all([
      this.prisma.progressBilling.findFirst({ where: { id: billingId, tenantId }, select: { id: true, status: true, orderId: true } }),
      this.prisma.order.findFirst({           where: { id: orderId,   tenantId }, select: { id: true } }),
    ]);
    if (!billing) throw new NotFoundException('Progress billing not found.');
    if (!order)   throw new NotFoundException('Order not found.');
    if (billing.orderId) {
      throw new ConflictException('This billing is already linked to an order.');
    }
    await this.prisma.progressBilling.update({
      where: { id: billingId },
      data:  { orderId },
    });
    return this.getProgressBilling(tenantId, billingId);
  }

  async markProgressBillingPaid(tenantId: string, id: string) {
    const result = await this.prisma.progressBilling.updateMany({
      where: { id, tenantId, status: 'ISSUED' },
      data:  { status: 'PAID', paidAt: new Date() },
    });
    if (result.count === 0) {
      throw new ConflictException('Only ISSUED billings can be marked paid.');
    }
    return this.getProgressBilling(tenantId, id);
  }

  async getProgressBilling(tenantId: string, id: string) {
    const billing = await this.prisma.progressBilling.findFirst({
      where: { id, tenantId },
      include: {
        project:          { select: { id: true, name: true, projectCode: true, status: true } },
        retentionRelease: true,
        order:            { select: { id: true, orderNumber: true, status: true } },
      },
    });
    if (!billing) throw new NotFoundException('Progress billing not found.');
    return billing;
  }

  listProgressBillings(tenantId: string, q: ListProgressBillingsQuery = {}) {
    const where: Prisma.ProgressBillingWhereInput = { tenantId };
    if (q.projectId) where.projectId = q.projectId;
    if (q.status)    where.status    = q.status;

    return this.prisma.progressBilling.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.take ? Math.min(q.take, 200) : 50,
      skip: q.skip ?? 0,
      include: { project: { select: { id: true, name: true, projectCode: true } } },
    });
  }

  // ─── Retention release ────────────────────────────────────────────────────

  async releaseRetention(tenantId: string, dto: ReleaseRetentionDto) {
    const billing = await this.prisma.progressBilling.findFirst({
      where: { id: dto.progressBillingId, tenantId },
      include: { retentionRelease: true },
    });
    if (!billing) throw new NotFoundException('Progress billing not found.');
    if (billing.status !== 'PAID') {
      throw new BadRequestException('Retention can only be released after the underlying billing is PAID.');
    }
    if (billing.retentionRelease) {
      throw new ConflictException('Retention has already been released for this billing.');
    }

    const releasedAmount = dto.releasedAmount != null
      ? Number(dto.releasedAmount)
      : Number(billing.retentionAmount);

    if (!(releasedAmount > 0)) {
      throw new BadRequestException('releasedAmount must be > 0.');
    }
    if (releasedAmount > Number(billing.retentionAmount)) {
      throw new BadRequestException('releasedAmount exceeds the retention held on this billing.');
    }

    // Atomic: create the release row + queue the RETENTION_RELEASE accounting
    // event for the JE handler (Step B): DR 2078 / CR 1030 AR (or CR 1010
    // Cash if released as a direct customer payment — handler will branch on
    // payload.releaseMethod when implemented).
    return this.prisma.$transaction(async (tx) => {
      const release = await tx.retentionRelease.create({
        data: {
          tenantId,
          progressBillingId: billing.id,
          releasedAmount:    releasedAmount as any,
          notes:             dto.notes ?? null,
        },
      });
      await tx.accountingEvent.create({
        data: {
          tenantId,
          type:    'RETENTION_RELEASE',
          status:  'PENDING',
          payload: {
            releaseId:         release.id,
            progressBillingId: billing.id,
            billingNumber:     billing.billingNumber,
            projectId:         billing.projectId,
            releasedAmount:    releasedAmount,
            // Default release method: AR_CREDIT (offset against an open AR
            // invoice). Frontend can pass releaseMethod='CASH' in dto.notes
            // payload later when we add the field; for now Step B handler
            // assumes AR_CREDIT.
            releaseMethod:     'AR_CREDIT',
            releasedAt:        new Date().toISOString(),
          },
        },
      });
      return release;
    });
  }

  listRetentionReleases(tenantId: string, q: { take?: number; skip?: number } = {}) {
    return this.prisma.retentionRelease.findMany({
      where:   { tenantId },
      orderBy: { releasedAt: 'desc' },
      take:    q.take ? Math.min(q.take, 200) : 50,
      skip:    q.skip ?? 0,
      include: {
        progressBilling: {
          select: {
            billingNumber: true,
            project:       { select: { id: true, name: true, projectCode: true } },
          },
        },
      },
    });
  }

  // ─── Project P&L (read-only — used by both Construction + Manufacturing) ──

  /**
   * Per-project profitability summary. Pulls:
   *   - Revenue: sum of paid OrderItem totals on orders whose progressBilling
   *     references this project (Construction), plus direct order linkage if any.
   *   - Material cost: sum of MaterialIssuance line totals (rawMaterial.costPrice
   *     * quantity) — already used by Manufacturing.
   *   - WIP balance: project budget minus revenue billed — coarse proxy.
   *
   * Console must NOT call this endpoint — controller's role guard restricts
   * to tenant operators only. (Tenant-scope is enforced by `where: tenantId`.)
   */
  async projectPnl(tenantId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where:   { id: projectId, tenantId },
      include: {
        issuances: {
          include: {
            lines: {
              include: { rawMaterial: { select: { costPrice: true } } },
            },
          },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found.');

    // Revenue from progress billings (issued + paid).
    const billings = await this.prisma.progressBilling.findMany({
      where:  { tenantId, projectId },
      select: { netAmount: true, retentionAmount: true, status: true },
    });

    let revenueBilled = 0;
    let revenuePaid   = 0;
    let retentionHeld = 0;
    for (const b of billings) {
      const net = Number(b.netAmount);
      const ret = Number(b.retentionAmount);
      if (b.status === 'ISSUED' || b.status === 'PAID') {
        revenueBilled += net + ret; // gross-of-retention = recognized revenue
        retentionHeld += ret;
      }
      if (b.status === 'PAID') {
        revenuePaid += net;
      }
    }

    // Material cost from MaterialIssuance.
    let materialCost = 0;
    for (const iss of project.issuances) {
      for (const line of iss.lines) {
        const cost = Number(line.rawMaterial.costPrice ?? 0);
        materialCost += cost * Number(line.quantity);
      }
    }

    const budget   = Number(project.budgetAmount ?? 0);
    const grossPnL = revenueBilled - materialCost;

    return {
      projectId,
      projectCode: project.projectCode,
      name:        project.name,
      status:      project.status,
      budget,
      revenueBilled: +revenueBilled.toFixed(2),
      revenuePaid:   +revenuePaid.toFixed(2),
      retentionHeld: +retentionHeld.toFixed(2),
      materialCost:  +materialCost.toFixed(2),
      grossPnL:      +grossPnL.toFixed(2),
      // Coarse WIP proxy — refined when JE handlers post Project-WIP balances.
      wipBalance:    +Math.max(materialCost - revenueBilled, 0).toFixed(2),
    };
  }
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateProgressBillingDto {
  projectId:         string;
  stageDescription:  string;
  percentComplete:   number | string;
  grossAmount:       number | string;
  retentionPercent?: number | string;
  notes?:            string;
}

export interface ListProgressBillingsQuery {
  projectId?: string;
  status?:    ProgressBillingStatus;
  take?:      number;
  skip?:      number;
}

export interface ReleaseRetentionDto {
  progressBillingId: string;
  /** Defaults to the full retention amount on the billing. */
  releasedAmount?:   number | string;
  notes?:            string;
}
