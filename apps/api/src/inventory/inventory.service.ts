import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, InventoryLogType } from '@prisma/client';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { SetThresholdDto } from './dto/set-threshold.dto';

export { AdjustStockDto, SetThresholdDto };

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
    const { productId, branchId, quantity, type, reason, note } = dto;

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
}
