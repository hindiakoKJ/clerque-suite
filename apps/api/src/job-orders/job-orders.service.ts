import {
  Injectable, BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, JobOrderStatus, JobOrderLineKind } from '@prisma/client';

/**
 * Service-Engine — Job Orders.
 *
 * Generic enough for auto repair shops, appliance service, IT repair,
 * upholstery, watchmakers — any service vertical that takes in a customer's
 * item, diagnoses it, quotes labor + parts, and returns it.
 *
 * Lifecycle:
 *   DRAFT → DIAGNOSING → AWAITING_APPROVAL → AWAITING_PARTS →
 *   IN_PROGRESS → QC → READY_FOR_PICKUP → CLAIMED
 * (Or CANCELLED at any pre-CLAIMED step.)
 *
 * Lines split into LABOR / PART / CONSUMABLE / SUBLET — labor lines feed
 * technician utilization reports; PART/CONSUMABLE lines link to Product
 * (so inventory is decremented via the universal accounting kernel when
 * the job order is claimed and converted to an Order).
 */
@Injectable()
export class JobOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Job orders ───────────────────────────────────────────────────────────

  async createJobOrder(tenantId: string, dto: CreateJobOrderDto) {
    if (!dto.branchId) throw new BadRequestException('branchId is required.');
    if (!dto.itemDescription?.trim()) {
      throw new BadRequestException('itemDescription is required.');
    }

    const [branch, customer, technician] = await Promise.all([
      this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId }, select: { id: true } }),
      dto.customerId
        ? this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId }, select: { id: true } })
        : Promise.resolve(null),
      dto.assignedToId
        ? this.prisma.user.findFirst({ where: { id: dto.assignedToId, tenantId, isActive: true }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    if (!branch) throw new NotFoundException('Branch not found.');
    if (dto.customerId && !customer)     throw new NotFoundException('Customer not found.');
    if (dto.assignedToId && !technician) throw new NotFoundException('Technician not found or inactive.');

    // Job number generation: JO-{YYYY}-{6-digit-seq per tenant per year}.
    const year   = new Date().getFullYear();
    const prefix = `JO-${year}-`;
    const last   = await this.prisma.jobOrder.findFirst({
      where:   { tenantId, jobNumber: { startsWith: prefix } },
      orderBy: { jobNumber: 'desc' },
      select:  { jobNumber: true },
    });
    const lastSeq   = last ? Number(last.jobNumber.slice(prefix.length)) || 0 : 0;
    const jobNumber = `${prefix}${String(lastSeq + 1).padStart(6, '0')}`;

    return this.prisma.jobOrder.create({
      data: {
        tenantId,
        branchId:          dto.branchId,
        jobNumber,
        status:            'DRAFT',
        customerId:        dto.customerId ?? null,
        itemDescription:   dto.itemDescription.trim(),
        customerComplaint: dto.customerComplaint ?? null,
        diagnosis:         dto.diagnosis ?? null,
        assignedToId:      dto.assignedToId ?? null,
        estimateAmount:    (dto.estimateAmount ?? null) as any,
        promisedAt:        dto.promisedAt ? new Date(dto.promisedAt) : null,
        notes:             dto.notes ?? null,
      },
    });
  }

  async getJobOrder(tenantId: string, id: string) {
    const jo = await this.prisma.jobOrder.findFirst({
      where: { id, tenantId },
      include: {
        branch:     { select: { id: true, name: true } },
        customer:   { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        order:      { select: { id: true, orderNumber: true, status: true } },
        lines: {
          orderBy: [{ kind: 'asc' }, { description: 'asc' }],
          include: {
            product:    { select: { id: true, name: true, sku: true } },
            technician: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!jo) throw new NotFoundException('Job order not found.');
    return jo;
  }

  listJobOrders(tenantId: string, q: ListJobOrdersQuery = {}) {
    const where: Prisma.JobOrderWhereInput = { tenantId };
    if (q.status)       where.status       = q.status;
    if (q.branchId)     where.branchId     = q.branchId;
    if (q.assignedToId) where.assignedToId = q.assignedToId;
    if (q.customerId)   where.customerId   = q.customerId;
    if (q.search) {
      where.OR = [
        { jobNumber:       { contains: q.search, mode: 'insensitive' } },
        { itemDescription: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.jobOrder.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: q.take ? Math.min(q.take, 200) : 50,
      skip: q.skip ?? 0,
      include: {
        customer:   { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Status-machine. Linear flow with CANCELLED escape from any pre-CLAIMED
   * state. Stamps timestamps on transition (startedAt, completedAt, claimedAt).
   * estimateApprovedAt is stamped specifically on AWAITING_APPROVAL → AWAITING_PARTS
   * (or AWAITING_APPROVAL → IN_PROGRESS if no parts needed).
   */
  async setStatus(tenantId: string, id: string, target: JobOrderStatus) {
    const jo = await this.prisma.jobOrder.findFirst({ where: { id, tenantId } });
    if (!jo) throw new NotFoundException('Job order not found.');

    const allowed: Record<JobOrderStatus, JobOrderStatus[]> = {
      DRAFT:             ['DIAGNOSING', 'CANCELLED'],
      DIAGNOSING:        ['AWAITING_APPROVAL', 'CANCELLED'],
      AWAITING_APPROVAL: ['AWAITING_PARTS', 'IN_PROGRESS', 'CANCELLED'],
      AWAITING_PARTS:    ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS:       ['QC', 'CANCELLED'],
      QC:                ['READY_FOR_PICKUP', 'IN_PROGRESS'],
      READY_FOR_PICKUP:  ['CLAIMED'],
      CLAIMED:           [],
      CANCELLED:         [],
    };

    if (!allowed[jo.status].includes(target)) {
      throw new BadRequestException(`Cannot move job order from ${jo.status} to ${target}.`);
    }

    const now  = new Date();
    const data: Prisma.JobOrderUpdateInput = { status: target };

    // estimate-approved: any forward step out of AWAITING_APPROVAL.
    if (jo.status === 'AWAITING_APPROVAL'
        && (target === 'AWAITING_PARTS' || target === 'IN_PROGRESS')
        && !jo.estimateApprovedAt) {
      data.estimateApprovedAt = now;
    }
    if (target === 'IN_PROGRESS'      && !jo.startedAt)   data.startedAt   = now;
    if (target === 'READY_FOR_PICKUP' && !jo.completedAt) data.completedAt = now;
    if (target === 'CLAIMED'          && !jo.claimedAt)   data.claimedAt   = now;

    // TOCTOU + tenant-scoped: only flip if status hasn't moved since the
    // findFirst above. updateMany returns count; throw on mismatch.
    const result = await this.prisma.jobOrder.updateMany({
      where: { id, tenantId, status: jo.status },
      data:  data as Prisma.JobOrderUncheckedUpdateInput,
    });
    if (result.count !== 1) {
      throw new ConflictException('Job order status changed concurrently — please retry.');
    }
    return this.getJobOrder(tenantId, id);
  }

  async linkOrder(tenantId: string, jobOrderId: string, orderId: string) {
    const [jo, order] = await Promise.all([
      this.prisma.jobOrder.findFirst({ where: { id: jobOrderId, tenantId }, select: { id: true } }),
      this.prisma.order.findFirst({    where: { id: orderId,    tenantId }, select: { id: true } }),
    ]);
    if (!jo)    throw new NotFoundException('Job order not found.');
    if (!order) throw new NotFoundException('Order not found.');

    // TOCTOU + tenant-scoped: only link if currently unlinked.
    const result = await this.prisma.jobOrder.updateMany({
      where: { id: jobOrderId, tenantId, orderId: null },
      data:  { orderId },
    });
    if (result.count !== 1) {
      throw new ConflictException('Job order is already linked to an Order.');
    }
    return this.getJobOrder(tenantId, jobOrderId);
  }

  // ─── Job order lines ──────────────────────────────────────────────────────

  async addLine(tenantId: string, jobOrderId: string, dto: AddJobOrderLineDto) {
    const jo = await this.prisma.jobOrder.findFirst({
      where:  { id: jobOrderId, tenantId },
      select: { id: true, status: true },
    });
    if (!jo) throw new NotFoundException('Job order not found.');
    if (jo.status === 'CLAIMED' || jo.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot add lines to a ${jo.status} job order.`);
    }

    const qty   = Number(dto.quantity);
    const price = Number(dto.unitPrice);
    if (!(qty > 0))   throw new BadRequestException('quantity must be > 0.');
    if (price < 0)    throw new BadRequestException('unitPrice cannot be negative.');
    if (!dto.description?.trim()) throw new BadRequestException('description is required.');

    if (dto.kind === 'PART' || dto.kind === 'CONSUMABLE') {
      if (!dto.productId) {
        throw new BadRequestException(`${dto.kind} lines require productId.`);
      }
      const product = await this.prisma.product.findFirst({
        where: { id: dto.productId, tenantId }, select: { id: true },
      });
      if (!product) throw new NotFoundException('Product not found.');
    }
    if (dto.kind === 'LABOR' && dto.technicianId) {
      const tech = await this.prisma.user.findFirst({
        where: { id: dto.technicianId, tenantId, isActive: true }, select: { id: true },
      });
      if (!tech) throw new NotFoundException('Technician not found or inactive.');
    }

    const lineTotal = +(qty * price).toFixed(2);

    return this.prisma.$transaction(async (tx) => {
      const line = await tx.jobOrderLine.create({
        data: {
          jobOrderId,
          kind:        dto.kind,
          productId:   dto.productId ?? null,
          description: dto.description.trim(),
          quantity:    qty as any,
          unitPrice:   price as any,
          lineTotal:   lineTotal as any,
          technicianId: dto.technicianId ?? null,
          notes:       dto.notes ?? null,
        },
      });
      const upd = await tx.jobOrder.updateMany({
        where: { id: jobOrderId, tenantId },
        data:  { totalAmount: { increment: lineTotal as any } },
      });
      if (upd.count !== 1) {
        throw new ConflictException('Job order not found or tenant mismatch.');
      }
      return line;
    });
  }

  async deleteLine(tenantId: string, jobOrderId: string, lineId: string) {
    // Atomic delete with tenant-scope guard via parent jobOrder.
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.jobOrderLine.findFirst({
        where: { id: lineId, jobOrder: { id: jobOrderId, tenantId } },
        select: { lineTotal: true, jobOrder: { select: { status: true } } },
      });
      if (!line) throw new NotFoundException('Line not found.');
      if (line.jobOrder.status === 'CLAIMED' || line.jobOrder.status === 'CANCELLED') {
        throw new BadRequestException(`Cannot remove lines from a ${line.jobOrder.status} job order.`);
      }
      // Atomic delete + parent decrement, both tenant-scoped.
      const del = await tx.jobOrderLine.deleteMany({
        where: { id: lineId, jobOrder: { id: jobOrderId, tenantId } },
      });
      if (del.count !== 1) {
        throw new ConflictException('Line was modified concurrently.');
      }
      const upd = await tx.jobOrder.updateMany({
        where: { id: jobOrderId, tenantId },
        data:  { totalAmount: { decrement: Number(line.lineTotal) as any } },
      });
      if (upd.count !== 1) {
        throw new ConflictException('Job order not found or tenant mismatch.');
      }
      return { ok: true };
    });
  }
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateJobOrderDto {
  branchId:           string;
  customerId?:        string;
  itemDescription:    string;
  customerComplaint?: string;
  diagnosis?:         string;
  assignedToId?:      string;
  estimateAmount?:    number | string;
  promisedAt?:        string;
  notes?:             string;
}

export interface ListJobOrdersQuery {
  status?:       JobOrderStatus;
  branchId?:     string;
  assignedToId?: string;
  customerId?:   string;
  search?:       string;
  take?:         number;
  skip?:         number;
}

export interface AddJobOrderLineDto {
  kind:          JobOrderLineKind;
  productId?:    string;
  description:   string;
  quantity:      number | string;
  unitPrice:     number | string;
  technicianId?: string;
  notes?:        string;
}
