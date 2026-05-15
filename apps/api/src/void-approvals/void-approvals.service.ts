/**
 * Sprint 25 — Maker-checker void/refund approvals (Solo Pro feature
 * `makerCheckerVoids`). When tenant.voidApprovalThresholdCents > 0 AND
 * the void/refund amount is at or above the threshold, the cashier-
 * initiated void creates a VoidApproval row in PENDING state. A Sales
 * Lead / Branch Manager / Business Owner must then approve before the
 * void is allowed to land.
 *
 * Separation of duties: the approver MUST NOT be the same user who
 * initiated the void. Enforced at the service layer.
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VoidApprovalStatus } from '@prisma/client';

@Injectable()
export class VoidApprovalsService {
  constructor(private prisma: PrismaService) {}

  /** Cashier initiates a void approval request. */
  async initiate(
    tenantId:    string,
    userId:      string,
    orderId:     string,
    orderItemId: string | null | undefined,
    amountCents: number,
    reason:      string,
  ) {
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new BadRequestException('amountCents must be a positive integer (peso-cents).');
    }
    if (!reason || reason.trim().length < 3) {
      throw new BadRequestException('A reason is required (min 3 chars).');
    }
    // Tenant-scoped order check — prevent cross-tenant request injection.
    const order = await this.prisma.order.findFirst({
      where:  { id: orderId, tenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found in this tenant.');

    return this.prisma.voidApproval.create({
      data: {
        tenantId,
        orderId,
        orderItemId:   orderItemId ?? null,
        amountCents:   Math.round(amountCents),
        reason:        reason.trim(),
        initiatedById: userId,
        status:        VoidApprovalStatus.PENDING,
      },
    });
  }

  /**
   * Supervisor approves a pending request.
   * SOD: approver !== initiator.
   */
  async approve(tenantId: string, approverId: string, id: string) {
    const row = await this.prisma.voidApproval.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Void approval request not found.');
    if (row.status !== VoidApprovalStatus.PENDING) {
      throw new BadRequestException(
        `Cannot approve — request is already ${row.status}.`,
      );
    }
    if (row.initiatedById === approverId) {
      throw new ForbiddenException(
        'Separation of duties: the user who initiated this void cannot approve it.',
      );
    }
    return this.prisma.voidApproval.update({
      where: { id },
      data: {
        status:       VoidApprovalStatus.APPROVED,
        approvedById: approverId,
        approvedAt:   new Date(),
      },
    });
  }

  /** Supervisor rejects a pending request with a reason. */
  async reject(
    tenantId:        string,
    approverId:      string,
    id:              string,
    rejectionReason: string,
  ) {
    if (!rejectionReason || rejectionReason.trim().length < 3) {
      throw new BadRequestException('A rejection reason is required (min 3 chars).');
    }
    const row = await this.prisma.voidApproval.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Void approval request not found.');
    if (row.status !== VoidApprovalStatus.PENDING) {
      throw new BadRequestException(
        `Cannot reject — request is already ${row.status}.`,
      );
    }
    if (row.initiatedById === approverId) {
      throw new ForbiddenException(
        'Separation of duties: the user who initiated this void cannot reject it.',
      );
    }
    return this.prisma.voidApproval.update({
      where: { id },
      data: {
        status:          VoidApprovalStatus.REJECTED,
        approvedById:    approverId,
        approvedAt:      new Date(),
        rejectionReason: rejectionReason.trim(),
      },
    });
  }

  async list(tenantId: string, statusFilter?: VoidApprovalStatus) {
    return this.prisma.voidApproval.findMany({
      where: {
        tenantId,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: { initiatedAt: 'desc' },
      take:    200,
    });
  }

  /**
   * Helper used by OrdersService when processing a void. Returns true when
   * an APPROVED approval exists for the given (orderId, orderItemId) pair
   * AND was approved within the last 24h (replay window). Otherwise false.
   */
  async hasApprovedFor(
    tenantId:    string,
    orderId:     string,
    orderItemId: string | null,
  ): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const row = await this.prisma.voidApproval.findFirst({
      where: {
        tenantId,
        orderId,
        orderItemId: orderItemId ?? null,
        status:      VoidApprovalStatus.APPROVED,
        approvedAt:  { gte: since },
      },
      select: { id: true },
    });
    return !!row;
  }
}
