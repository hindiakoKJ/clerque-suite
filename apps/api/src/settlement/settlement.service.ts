import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, PaymentMethod, SettlementStatus } from '@prisma/client';
import { CreateSettlementBatchDto } from './dto/create-settlement.dto';
import { ConfirmSettlementDto } from './dto/confirm-settlement.dto';
import { AddItemsToSettlementDto } from './dto/add-items-settlement.dto';
export { CreateSettlementBatchDto, ConfirmSettlementDto, AddItemsToSettlementDto };

@Injectable()
export class SettlementService {
  constructor(private prisma: PrismaService) {}

  // ─── List batches for a tenant ───────────────────────────────────────────────

  async list(
    tenantId: string,
    branchId?: string,
    status?: SettlementStatus,
    page = 1,
    limit = 20,
  ) {
    const where: Prisma.SettlementBatchWhereInput = {
      tenantId,
      ...(branchId ? { branchId } : {}),
      ...(status ? { status } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.settlementBatch.findMany({
        where,
        include: {
          _count: { select: { items: true } },
        },
        orderBy: { periodEnd: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.settlementBatch.count({ where }),
    ]);

    return { data, total, page, pages: Math.ceil(total / limit) };
  }

  // ─── Get one batch with all items ────────────────────────────────────────────

  async findOne(tenantId: string, batchId: string) {
    const batch = await this.prisma.settlementBatch.findFirst({
      where: { id: batchId, tenantId },
      include: {
        items: {
          include: {
            orderPayment: {
              include: {
                order: {
                  select: {
                    orderNumber: true,
                    completedAt: true,
                    totalAmount: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!batch) throw new NotFoundException('Settlement batch not found');
    return batch;
  }

  // ─── Create a new batch ───────────────────────────────────────────────────────

  async create(tenantId: string, createdById: string, dto: CreateSettlementBatchDto) {
    // Validate digital payment method — cash doesn't settle via gateway
    const digitalMethods: PaymentMethod[] = [
      'GCASH_PERSONAL', 'GCASH_BUSINESS', 'MAYA_PERSONAL', 'MAYA_BUSINESS', 'QR_PH',
    ];
    if (!digitalMethods.includes(dto.method)) {
      throw new BadRequestException('Only digital payment methods can be settled in batches');
    }

    return this.prisma.settlementBatch.create({
      data: {
        tenantId,
        branchId: dto.branchId,
        method: dto.method,
        referenceNumber: dto.referenceNumber,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        notes: dto.notes,
        // expectedAmount will be computed when items are added
        expectedAmount: new Prisma.Decimal(0),
        status: 'PENDING',
      },
    });
  }

  // ─── Add order payments to a batch ───────────────────────────────────────────
  // This is the "cash application" step — linking individual POS transactions
  // to the settlement batch they belong to.

  async addItems(tenantId: string, batchId: string, dto: AddItemsToSettlementDto) {
    const batch = await this.findOne(tenantId, batchId);

    if (batch.status !== 'PENDING') {
      throw new BadRequestException('Can only add items to a PENDING batch');
    }

    // Validate all payments belong to this tenant and use the right method
    const payments = await this.prisma.orderPayment.findMany({
      where: {
        id: { in: dto.orderPaymentIds },
        method: batch.method,
        order: { tenantId },
        settlementItem: null,  // not already in another batch
      },
    });

    if (payments.length !== dto.orderPaymentIds.length) {
      throw new BadRequestException(
        'Some payments were not found, use a different payment method, or are already in another batch',
      );
    }

    // Create settlement items and update expected total
    const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);

    await this.prisma.$transaction([
      this.prisma.settlementItem.createMany({
        data: payments.map((p) => ({
          settlementBatchId: batchId,
          orderPaymentId: p.id,
          amount: p.amount,
        })),
        skipDuplicates: true,
      }),
      this.prisma.settlementBatch.update({
        where: { id: batchId },
        data: {
          expectedAmount: {
            increment: new Prisma.Decimal(total),
          },
        },
      }),
    ]);

    return this.findOne(tenantId, batchId);
  }

  // ─── Confirm bank receipt ─────────────────────────────────────────────────────
  // The Owner/Manager checks their bank statement, sees the credit arrive,
  // and confirms it here. This is the "bank reconciliation" step.

  async confirmSettlement(
    tenantId: string,
    batchId: string,
    reconciledById: string,
    dto: ConfirmSettlementDto,
  ) {
    const batch = await this.findOne(tenantId, batchId);

    if (batch.status !== 'PENDING' && batch.status !== 'DISPUTED') {
      throw new BadRequestException('Batch is already settled or reconciled');
    }

    const actual = new Prisma.Decimal(dto.actualAmount);
    const variance = actual.minus(batch.expectedAmount);
    const status: SettlementStatus =
      variance.abs().greaterThan(0.01) ? 'DISPUTED' : 'SETTLED';

    return this.prisma.settlementBatch.update({
      where: { id: batchId },
      data: {
        actualAmount: actual,
        variance,
        settledAt: new Date(dto.settledAt),
        bankReference: dto.bankReference,
        notes: dto.notes ?? batch.notes,
        status,
        reconciledById,
      },
    });
  }

  // ─── Mark as reconciled (after dispute is resolved) ──────────────────────────

  async markReconciled(tenantId: string, batchId: string, reconciledById: string) {
    const batch = await this.findOne(tenantId, batchId);
    if (batch.status !== 'SETTLED' && batch.status !== 'DISPUTED') {
      throw new BadRequestException('Only SETTLED or DISPUTED batches can be reconciled');
    }
    return this.prisma.settlementBatch.update({
      where: { id: batchId },
      data: { status: 'RECONCILED', reconciledById },
    });
  }

  // ─── Get unmatched digital payments (not yet in any batch) ───────────────────
  // This is what the Ledger screen shows: "these GCash payments have no batch yet"

  async getUnmatchedPayments(
    tenantId: string,
    branchId: string,
    method: PaymentMethod,
    from?: string,
    to?: string,
  ) {
    return this.prisma.orderPayment.findMany({
      where: {
        method,
        settlementItem: null,
        order: {
          tenantId,
          branchId,
          status: 'COMPLETED',
          ...(from || to
            ? {
                completedAt: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              }
            : {}),
        },
      },
      include: {
        order: {
          select: {
            orderNumber: true,
            completedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Summary: amounts pending settlement per method ───────────────────────────

  async getPendingSummary(tenantId: string, branchId?: string) {
    const digitalMethods: PaymentMethod[] = [
      'GCASH_PERSONAL', 'GCASH_BUSINESS', 'MAYA_PERSONAL', 'MAYA_BUSINESS', 'QR_PH',
    ];

    const results = await Promise.all(
      digitalMethods.map(async (method) => {
        const payments = await this.prisma.orderPayment.aggregate({
          where: {
            method,
            settlementItem: null,
            order: {
              tenantId,
              ...(branchId ? { branchId } : {}),
              status: 'COMPLETED',
            },
          },
          _sum: { amount: true },
          _count: true,
        });
        return {
          method,
          pendingCount: payments._count,
          pendingAmount: Number(payments._sum.amount ?? 0),
        };
      }),
    );

    return results.filter((r) => r.pendingCount > 0);
  }
}
