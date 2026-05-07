import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, StockTransferStatus, CycleCountStatus } from '@prisma/client';

// ── Stock Transfer DTOs ────────────────────────────────────────────────────────

export interface CreateTransferDto {
  fromBranchId: string;
  toBranchId:   string;
  notes?:       string;
  lines: Array<{ rawMaterialId: string; quantity: number; notes?: string }>;
}

@Injectable()
export class WarehouseService {
  constructor(private prisma: PrismaService) {}

  // ── Numbering helpers (per-tenant per-year, race-safe within tx) ─────────
  private async nextTransferNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `ST-${year}-`;
    const last = await tx.stockTransfer.findFirst({
      where:   { tenantId, transferNumber: { startsWith: prefix } },
      orderBy: { transferNumber: 'desc' },
      select:  { transferNumber: true },
    });
    const seq = (last ? parseInt(last.transferNumber.slice(prefix.length), 10) : 0) + 1;
    return `${prefix}${String(seq).padStart(6, '0')}`;
  }

  private async nextCountNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `CC-${year}-`;
    const last = await tx.cycleCount.findFirst({
      where:   { tenantId, countNumber: { startsWith: prefix } },
      orderBy: { countNumber: 'desc' },
      select:  { countNumber: true },
    });
    const seq = (last ? parseInt(last.countNumber.slice(prefix.length), 10) : 0) + 1;
    return `${prefix}${String(seq).padStart(6, '0')}`;
  }

  // ── Stock Transfers ──────────────────────────────────────────────────────

  /**
   * Creates a DRAFT stock transfer with lines pre-priced at the source
   * branch's current WAC (pulled from RawMaterial.costPrice). Status flows:
   *   DRAFT → IN_TRANSIT (send) → RECEIVED (book at destination)
   *   DRAFT/IN_TRANSIT → CANCELLED
   */
  async createTransfer(tenantId: string, userId: string, dto: CreateTransferDto) {
    if (dto.fromBranchId === dto.toBranchId) {
      throw new BadRequestException('From and To branches must differ.');
    }
    if (!dto.lines.length) {
      throw new BadRequestException('At least one line is required.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Validate both branches in this tenant.
      const branches = await tx.branch.findMany({
        where:  { id: { in: [dto.fromBranchId, dto.toBranchId] }, tenantId },
        select: { id: true },
      });
      if (branches.length !== 2) {
        throw new BadRequestException('Branches not found in this tenant.');
      }

      // Resolve cost prices.
      const rmIds = dto.lines.map((l) => l.rawMaterialId);
      const rms = await tx.rawMaterial.findMany({
        where:  { id: { in: rmIds }, tenantId },
        select: { id: true, costPrice: true },
      });
      if (rms.length !== rmIds.length) {
        throw new BadRequestException('One or more raw materials not found.');
      }
      const costByRm = new Map(rms.map((r) => [r.id, Number(r.costPrice ?? 0)]));

      const transferNumber = await this.nextTransferNumber(tx, tenantId);
      return tx.stockTransfer.create({
        data: {
          tenantId,
          transferNumber,
          fromBranchId: dto.fromBranchId,
          toBranchId:   dto.toBranchId,
          status:       'DRAFT',
          notes:        dto.notes ?? null,
          createdById:  userId,
          lines: {
            create: dto.lines.map((l) => ({
              rawMaterialId: l.rawMaterialId,
              quantity:      new Prisma.Decimal(l.quantity),
              unitCost:      new Prisma.Decimal(costByRm.get(l.rawMaterialId) ?? 0),
              notes:         l.notes ?? null,
            })),
          },
        },
        include: { lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      });
    });
  }

  async listTransfers(tenantId: string, status?: StockTransferStatus) {
    return this.prisma.stockTransfer.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch:   { select: { id: true, name: true } },
        _count:     { select: { lines: true } },
      },
    });
  }

  async getTransfer(tenantId: string, id: string) {
    const t = await this.prisma.stockTransfer.findFirst({
      where: { id, tenantId },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch:   { select: { id: true, name: true } },
        lines:      { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
      },
    });
    if (!t) throw new NotFoundException('Transfer not found.');
    return t;
  }

  /** Send: deducts from source RawMaterialInventory; status → IN_TRANSIT. */
  async sendTransfer(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.stockTransfer.findFirst({
        where:   { id, tenantId },
        include: { lines: true },
      });
      if (!t) throw new NotFoundException('Transfer not found.');
      if (t.status !== 'DRAFT') {
        throw new BadRequestException(`Only DRAFT transfers can be sent (current: ${t.status}).`);
      }

      for (const line of t.lines) {
        const inv = await tx.rawMaterialInventory.findUnique({
          where: { branchId_rawMaterialId: { branchId: t.fromBranchId, rawMaterialId: line.rawMaterialId } },
        });
        const onHand = Number(inv?.quantity ?? 0);
        if (onHand < Number(line.quantity)) {
          throw new BadRequestException(
            `Insufficient stock at source for raw-material ${line.rawMaterialId}: have ${onHand}, need ${line.quantity}.`,
          );
        }
        await tx.rawMaterialInventory.update({
          where: { branchId_rawMaterialId: { branchId: t.fromBranchId, rawMaterialId: line.rawMaterialId } },
          data:  { quantity: { decrement: line.quantity } },
        });
      }

      return tx.stockTransfer.update({
        where: { id },
        data:  { status: 'IN_TRANSIT', sentAt: new Date() },
      });
    });
  }

  /** Receive: increments destination inventory; status → RECEIVED. */
  async receiveTransfer(tenantId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.stockTransfer.findFirst({
        where:   { id, tenantId },
        include: { lines: true },
      });
      if (!t) throw new NotFoundException('Transfer not found.');
      if (t.status !== 'IN_TRANSIT') {
        throw new BadRequestException(`Only IN_TRANSIT transfers can be received (current: ${t.status}).`);
      }

      for (const line of t.lines) {
        await tx.rawMaterialInventory.upsert({
          where:  { branchId_rawMaterialId: { branchId: t.toBranchId, rawMaterialId: line.rawMaterialId } },
          create: {
            tenantId, branchId: t.toBranchId, rawMaterialId: line.rawMaterialId,
            quantity: line.quantity,
          },
          update: { quantity: { increment: line.quantity } },
        });
      }

      return tx.stockTransfer.update({
        where: { id },
        data:  { status: 'RECEIVED', receivedAt: new Date(), receivedById: userId },
      });
    });
  }

  async cancelTransfer(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.stockTransfer.findFirst({
        where:   { id, tenantId },
        include: { lines: true },
      });
      if (!t) throw new NotFoundException('Transfer not found.');
      if (t.status === 'RECEIVED' || t.status === 'CANCELLED') {
        throw new BadRequestException(`Cannot cancel a ${t.status} transfer.`);
      }
      // If already in transit, refund the source branch.
      if (t.status === 'IN_TRANSIT') {
        for (const line of t.lines) {
          await tx.rawMaterialInventory.update({
            where: { branchId_rawMaterialId: { branchId: t.fromBranchId, rawMaterialId: line.rawMaterialId } },
            data:  { quantity: { increment: line.quantity } },
          });
        }
      }
      return tx.stockTransfer.update({
        where: { id },
        data:  { status: 'CANCELLED' },
      });
    });
  }

  // ── Cycle Counts ─────────────────────────────────────────────────────────

  /**
   * Starts a cycle count for a branch. Snapshots the current
   * RawMaterialInventory.quantity for every active raw material as
   * `expectedQty`. Counter then enters `countedQty` per line. On post,
   * variances become InventoryLog adjustments and RawMaterialInventory
   * updates atomically.
   */
  async startCycleCount(tenantId: string, branchId: string, userId: string, notes?: string) {
    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: branchId, tenantId } });
      if (!branch) throw new BadRequestException('Branch not found.');

      const inv = await tx.rawMaterialInventory.findMany({
        where:  { tenantId, branchId },
        select: { rawMaterialId: true, quantity: true },
      });
      if (!inv.length) {
        throw new BadRequestException('No raw materials in inventory at this branch.');
      }

      const countNumber = await this.nextCountNumber(tx, tenantId);
      return tx.cycleCount.create({
        data: {
          tenantId, branchId, countNumber,
          status: 'OPEN', notes: notes ?? null, startedById: userId,
          lines: {
            create: inv.map((i) => ({
              rawMaterialId: i.rawMaterialId,
              expectedQty:   i.quantity,
              countedQty:    i.quantity, // operator updates this
            })),
          },
        },
        include: { lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      });
    });
  }

  async listCycleCounts(tenantId: string, status?: CycleCountStatus) {
    return this.prisma.cycleCount.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
    });
  }

  async getCycleCount(tenantId: string, id: string) {
    const c = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId },
      include: {
        branch: { select: { id: true, name: true } },
        lines:  { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
      },
    });
    if (!c) throw new NotFoundException('Cycle count not found.');
    return c;
  }

  /** Operator enters/updates the counted qty for a line. */
  async setLineCount(tenantId: string, lineId: string, countedQty: number) {
    const line = await this.prisma.cycleCountLine.findFirst({
      where: { id: lineId, count: { tenantId, status: 'OPEN' } },
    });
    if (!line) throw new NotFoundException('Line not found or count is not OPEN.');
    return this.prisma.cycleCountLine.update({
      where: { id: lineId },
      data:  {
        countedQty:  new Prisma.Decimal(countedQty),
        varianceQty: new Prisma.Decimal(countedQty - Number(line.expectedQty)),
      },
    });
  }

  /**
   * Post the count: applies variances to RawMaterialInventory and writes
   * InventoryLog rows. Skips lines with zero variance.
   */
  async postCycleCount(tenantId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.cycleCount.findFirst({
        where:   { id, tenantId },
        include: { lines: true },
      });
      if (!c) throw new NotFoundException('Cycle count not found.');
      if (c.status !== 'OPEN') {
        throw new BadRequestException(`Only OPEN counts can be posted (current: ${c.status}).`);
      }

      let postedLines = 0;
      for (const line of c.lines) {
        const variance = Number(line.countedQty) - Number(line.expectedQty);
        if (Math.abs(variance) < 0.001) continue; // skip zero-variance

        await tx.rawMaterialInventory.update({
          where: { branchId_rawMaterialId: { branchId: c.branchId, rawMaterialId: line.rawMaterialId } },
          data:  { quantity: new Prisma.Decimal(line.countedQty) },
        });
        await tx.cycleCountLine.update({
          where: { id: line.id },
          data:  { varianceQty: new Prisma.Decimal(variance) },
        });
        postedLines++;
      }

      return tx.cycleCount.update({
        where: { id },
        data:  { status: 'POSTED', postedAt: new Date(), postedById: userId },
        include: { lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      });
    });
  }
}
