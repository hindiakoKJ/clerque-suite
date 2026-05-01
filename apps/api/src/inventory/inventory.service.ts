import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, InventoryLogType } from '@prisma/client';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { SetThresholdDto } from './dto/set-threshold.dto';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { ReceiveRawMaterialDto } from './dto/receive-raw-material.dto';

export { AdjustStockDto, SetThresholdDto, CreateRawMaterialDto, ReceiveRawMaterialDto };

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // ─── List inventory for a branch ─────────────────────────────────────────

  async list(
    tenantId: string,
    branchId: string,
    opts: { page?: number; search?: string; lowStockOnly?: boolean } = {},
  ) {
    const { page = 1, search, lowStockOnly } = opts;
    const take = 50;
    const skip = (page - 1) * take;

    const where: Prisma.InventoryItemWhereInput = {
      tenantId,
      branchId,
      ...(search ? {
        product: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku:  { contains: search, mode: 'insensitive' } },
          ],
        },
      } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.inventoryItem.count({ where }),
      this.prisma.inventoryItem.findMany({
        where,
        include: {
          product: {
            select: {
              id: true, name: true, sku: true,
              isVatable: true, isActive: true, costPrice: true,
              category: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ product: { name: 'asc' } }],
        skip,
        take,
      }),
    ]);

    const rows = items.map((item) => ({
      ...item,
      quantity:   Number(item.quantity),
      totalValue: item.product.costPrice
        ? Number(item.quantity) * Number(item.product.costPrice)
        : null,
      isLowStock: item.lowStockAlert != null && Number(item.quantity) <= item.lowStockAlert,
    }));

    return {
      data:  lowStockOnly ? rows.filter((r) => r.isLowStock) : rows,
      total,
      page,
      pages: Math.ceil(total / take),
    };
  }

  // ─── Low-stock items ──────────────────────────────────────────────────────

  async getLowStock(tenantId: string, branchId: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, branchId },
      include: {
        product: { select: { id: true, name: true, sku: true } },
      },
    });
    return items
      .filter((i) => i.lowStockAlert != null && Number(i.quantity) <= i.lowStockAlert)
      .map((i) => ({
        ...i,
        quantity: Number(i.quantity),
        isLowStock: true,
      }));
  }

  // ─── Branch ownership guard ───────────────────────────────────────────────

  /**
   * Guard: verify that `branchId` is owned by `tenantId`.
   * Prevents cross-tenant branch injection in client-supplied DTOs.
   */
  private async assertBranchBelongsToTenant(tenantId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { id: true },
    });
    if (!branch) {
      throw new ForbiddenException(
        'The provided branchId does not belong to your organization.',
      );
    }
  }

  // ─── Adjust stock ─────────────────────────────────────────────────────────

  async adjust(tenantId: string, createdById: string, dto: AdjustStockDto) {
    const { productId, branchId, quantity, type, reason, note, unitCost } = dto;

    // Verify product belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Verify branch belongs to tenant (CRITICAL-2 fix — prevents cross-tenant branch injection)
    await this.assertBranchBelongsToTenant(tenantId, branchId);

    return this.prisma.$transaction(async (tx) => {
      // Upsert inventory item
      const existing = await tx.inventoryItem.findUnique({
        where: { branchId_productId: { branchId, productId } },
      });

      const quantityBefore = existing ? Number(existing.quantity) : 0;
      const quantityAfter = quantityBefore + quantity;
      const oldAvgCost = existing?.avgCost ? Number(existing.avgCost) : null;

      if (quantityAfter < 0) {
        throw new BadRequestException(
          `Stock would go negative (current: ${quantityBefore}, adjustment: ${quantity})`,
        );
      }

      // ── Moving-Average Cost recompute ──────────────────────────────────
      // Only run on positive-qty receipts where the operator gave us a
      // unit cost (e.g. supplier delivery). Stockouts, write-offs and
      // adjustments don't change avgCost.
      let newAvgCost: number | null = oldAvgCost;
      if (quantity > 0 && unitCost != null && unitCost >= 0) {
        if (quantityBefore <= 0 || oldAvgCost == null) {
          // First-ever costed receipt or restocking from zero — avgCost = unitCost
          newAvgCost = unitCost;
        } else {
          // Weighted average: (oldQty × oldAvg + receivedQty × receivedCost) / total
          newAvgCost = (quantityBefore * oldAvgCost + quantity * unitCost) / quantityAfter;
        }
      }
      // If quantity drops to exactly 0, reset avgCost to null so the next
      // receipt can establish a fresh baseline (avoids carrying stale costs)
      if (quantityAfter === 0) newAvgCost = null;

      const item = await tx.inventoryItem.upsert({
        where: { branchId_productId: { branchId, productId } },
        create: {
          tenantId,
          branchId,
          productId,
          quantity: new Prisma.Decimal(quantityAfter),
          avgCost:  newAvgCost != null ? new Prisma.Decimal(newAvgCost) : null,
        },
        update: {
          quantity: new Prisma.Decimal(quantityAfter),
          avgCost:  newAvgCost != null ? new Prisma.Decimal(newAvgCost) : null,
        },
      });

      // Create movement log
      await tx.inventoryLog.create({
        data: {
          tenantId,
          branchId,
          productId,
          type: type as InventoryLogType,
          quantity: new Prisma.Decimal(quantity),
          quantityBefore: new Prisma.Decimal(quantityBefore),
          quantityAfter: new Prisma.Decimal(quantityAfter),
          reason,
          note,
          createdById,
        },
      });

      // ── Accounting event — always fired so the ledger stays in sync
      // regardless of whether the user has Ledger app access (tier gating
      // controls visibility only; accounting records are always created).
      // Journal processor uses cost value; if costPrice is null the event
      // will be marked SYNCED (skipped) without posting a zero-value JE.
      const costPrice = product.costPrice ? Number(product.costPrice) : 0;
      const totalValue = Math.abs(quantity) * costPrice;
      await tx.accountingEvent.create({
        data: {
          tenantId,
          type: 'INVENTORY_ADJUSTMENT',
          status: 'PENDING',
          payload: {
            productId,
            productName: product.name,
            branchId,
            adjustmentType: type,  // INITIAL | STOCK_IN | STOCK_OUT | ADJUSTMENT
            quantity,
            quantityBefore,
            quantityAfter,
            costPrice,
            totalValue,
            reason: reason ?? null,
          },
        },
      });

      return { ...item, quantity: Number(item.quantity) };
    });
  }

  // ─── Set low-stock threshold ──────────────────────────────────────────────

  async setThreshold(tenantId: string, dto: SetThresholdDto) {
    const { productId, branchId, lowStockAlert } = dto;

    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Verify branch belongs to tenant (CRITICAL-2 fix)
    await this.assertBranchBelongsToTenant(tenantId, branchId);

    const item = await this.prisma.inventoryItem.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: {
        tenantId,
        branchId,
        productId,
        quantity: new Prisma.Decimal(0),
        lowStockAlert,
      },
      update: { lowStockAlert },
    });

    return { ...item, quantity: Number(item.quantity) };
  }

  // ─── Movement log for one product ────────────────────────────────────────

  async getLogs(tenantId: string, productId: string, branchId: string, limit = 50) {
    const logs = await this.prisma.inventoryLog.findMany({
      where: { tenantId, productId, branchId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return logs.map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      quantityBefore: Number(l.quantityBefore),
      quantityAfter: Number(l.quantityAfter),
    }));
  }

  // ─── Raw Materials (F&B ingredient library) ───────────────────────────────

  async listRawMaterials(tenantId: string, includeInactive = false) {
    const items = await this.prisma.rawMaterial.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
    return items.map((m) => ({
      ...m,
      costPrice: m.costPrice != null ? Number(m.costPrice) : null,
    }));
  }

  async createRawMaterial(tenantId: string, dto: CreateRawMaterialDto) {
    const item = await this.prisma.rawMaterial.create({
      data: {
        tenantId,
        name: dto.name,
        unit: dto.unit,
        costPrice: dto.costPrice != null ? new Prisma.Decimal(dto.costPrice) : undefined,
      },
    });
    return { ...item, costPrice: item.costPrice != null ? Number(item.costPrice) : null };
  }

  async updateRawMaterial(tenantId: string, id: string, dto: Partial<CreateRawMaterialDto> & { isActive?: boolean }) {
    const item = await this.prisma.rawMaterial.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Raw material not found');

    const updated = await this.prisma.rawMaterial.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name } : {}),
        ...(dto.unit != null ? { unit: dto.unit } : {}),
        ...(dto.costPrice != null ? { costPrice: new Prisma.Decimal(dto.costPrice) } : {}),
        ...(dto.isActive != null ? { isActive: dto.isActive } : {}),
      },
    });
    return { ...updated, costPrice: updated.costPrice != null ? Number(updated.costPrice) : null };
  }

  /** Add incoming stock for a raw material (supplier delivery). Applies WAC cost update. */
  async receiveRawMaterial(tenantId: string, rawMaterialId: string, dto: ReceiveRawMaterialDto) {
    const material = await this.prisma.rawMaterial.findFirst({
      where: { id: rawMaterialId, tenantId },
    });
    if (!material) throw new NotFoundException('Raw material not found');

    // Verify branch belongs to tenant
    await this.assertBranchBelongsToTenant(tenantId, dto.branchId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.rawMaterialInventory.findUnique({
        where: { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId } },
      });

      const qtyBefore = existing ? Number(existing.quantity) : 0;
      const qtyAfter  = qtyBefore + dto.quantity;

      await tx.rawMaterialInventory.upsert({
        where: { branchId_rawMaterialId: { branchId: dto.branchId, rawMaterialId } },
        create: {
          tenantId,
          branchId: dto.branchId,
          rawMaterialId,
          quantity: new Prisma.Decimal(qtyAfter),
        },
        update: { quantity: new Prisma.Decimal(qtyAfter) },
      });

      // WAC cost update: if new cost price provided, update material cost
      if (dto.costPrice != null) {
        const oldCost    = material.costPrice ? Number(material.costPrice) : 0;
        const totalOldValue  = qtyBefore * oldCost;
        const totalNewValue  = dto.quantity * dto.costPrice;
        const newWac = qtyAfter > 0
          ? (totalOldValue + totalNewValue) / qtyAfter
          : dto.costPrice;

        await tx.rawMaterial.update({
          where: { id: rawMaterialId },
          data: { costPrice: new Prisma.Decimal(newWac) },
        });
      }

      return {
        rawMaterialId,
        branchId: dto.branchId,
        quantityBefore: qtyBefore,
        quantityAfter: qtyAfter,
        quantity: dto.quantity,
      };
    });
  }

  /** Get raw-material stock levels for a branch */
  async listRawMaterialStock(tenantId: string, branchId: string) {
    const stocks = await this.prisma.rawMaterialInventory.findMany({
      where: { tenantId, branchId },
      include: {
        rawMaterial: { select: { id: true, name: true, unit: true, costPrice: true, isActive: true } },
      },
      orderBy: { rawMaterial: { name: 'asc' } },
    });
    return stocks.map((s) => ({
      ...s,
      quantity: Number(s.quantity),
      costPrice: s.rawMaterial.costPrice != null ? Number(s.rawMaterial.costPrice) : null,
      totalValue: s.rawMaterial.costPrice != null
        ? Number(s.quantity) * Number(s.rawMaterial.costPrice)
        : null,
    }));
  }
}
