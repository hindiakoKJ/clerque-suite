import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, InventoryLogType } from '@prisma/client';

export interface AdjustStockDto {
  productId: string;
  branchId: string;
  quantity: number;       // positive = add, negative = remove
  type: 'INITIAL' | 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT';
  reason?: string;
  note?: string;
}

export interface SetThresholdDto {
  productId: string;
  branchId: string;
  lowStockAlert: number | null;
}

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // ─── List inventory for a branch ─────────────────────────────────────────

  async list(tenantId: string, branchId: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, branchId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            isVatable: true,
            isActive: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ product: { name: 'asc' } }],
    });
    return items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      isLowStock: item.lowStockAlert != null && Number(item.quantity) <= item.lowStockAlert,
    }));
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

  // ─── Adjust stock ─────────────────────────────────────────────────────────

  async adjust(tenantId: string, createdById: string, dto: AdjustStockDto) {
    const { productId, branchId, quantity, type, reason, note } = dto;

    // Verify product belongs to tenant
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.$transaction(async (tx) => {
      // Upsert inventory item
      const existing = await tx.inventoryItem.findUnique({
        where: { branchId_productId: { branchId, productId } },
      });

      const quantityBefore = existing ? Number(existing.quantity) : 0;
      const quantityAfter = quantityBefore + quantity;

      if (quantityAfter < 0) {
        throw new BadRequestException(
          `Stock would go negative (current: ${quantityBefore}, adjustment: ${quantity})`,
        );
      }

      const item = await tx.inventoryItem.upsert({
        where: { branchId_productId: { branchId, productId } },
        create: {
          tenantId,
          branchId,
          productId,
          quantity: new Prisma.Decimal(quantityAfter),
        },
        update: {
          quantity: new Prisma.Decimal(quantityAfter),
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
}
