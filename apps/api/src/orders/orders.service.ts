import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, InventoryLogType } from '@prisma/client';
import { OfflineOrder } from '@repo/shared-types';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  // ─── Create order (online or from offline sync) ─────────────────────────

  async create(tenantId: string, cashierId: string, payload: OfflineOrder) {
    // Idempotency: if clientUuid already exists, return existing order
    if (payload.clientUuid) {
      const existing = await this.prisma.order.findUnique({
        where: { clientUuid: payload.clientUuid },
      });
      if (existing) return existing;
    }

    const orderNumber = await this.generateOrderNumber(tenantId);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          tenantId,
          branchId: payload.branchId,
          shiftId: payload.shiftId,
          orderNumber,
          status: 'COMPLETED',
          subtotal: new Prisma.Decimal(payload.subtotal),
          discountAmount: new Prisma.Decimal(payload.discountAmount),
          vatAmount: new Prisma.Decimal(payload.vatAmount),
          totalAmount: new Prisma.Decimal(payload.totalAmount),
          isPwdScDiscount: payload.isPwdScDiscount,
          pwdScIdRef: payload.pwdScIdRef,
          pwdScIdOwnerName: payload.pwdScIdOwnerName,
          clientUuid: payload.clientUuid,
          createdById: cashierId,
          completedAt: new Date(payload.createdAt),
          items: {
            create: payload.items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              productName: item.productName,
              unitPrice: new Prisma.Decimal(item.unitPrice),
              quantity: new Prisma.Decimal(item.quantity),
              discountAmount: new Prisma.Decimal(item.discountAmount),
              vatAmount: new Prisma.Decimal(item.vatAmount),
              lineTotal: new Prisma.Decimal(item.lineTotal),
              costPrice: item.costPrice != null ? new Prisma.Decimal(item.costPrice) : undefined,
              isVatable: item.isVatable,
            })),
          },
          payments: {
            create: payload.payments.map((p) => ({
              method: p.method,
              amount: new Prisma.Decimal(p.amount),
              reference: p.reference,
            })),
          },
          discounts: {
            create: payload.discounts.map((d) => ({
              discountType: d.discountType,
              discountConfigId: d.discountConfigId,
              discountPercent: d.discountPercent != null ? new Prisma.Decimal(d.discountPercent) : undefined,
              discountFixed: d.discountFixed != null ? new Prisma.Decimal(d.discountFixed) : undefined,
              discountAmount: new Prisma.Decimal(d.discountAmount),
              reason: d.reason,
              authorizedById: d.authorizedById,
            })),
          },
        },
        include: { items: true, payments: true, discounts: true },
      });

      // Update inventory per item (unit-based products) and log the deduction
      for (const item of payload.items) {
        const invItem = await tx.inventoryItem.findUnique({
          where: { branchId_productId: { branchId: payload.branchId, productId: item.productId } },
        });
        if (invItem) {
          const qtyBefore = Number(invItem.quantity);
          const qtyAfter = Math.max(0, qtyBefore - Number(item.quantity));
          await tx.inventoryItem.update({
            where: { branchId_productId: { branchId: payload.branchId, productId: item.productId } },
            data: { quantity: new Prisma.Decimal(qtyAfter) },
          });
          await tx.inventoryLog.create({
            data: {
              tenantId,
              branchId: payload.branchId,
              productId: item.productId,
              type: InventoryLogType.SALE_DEDUCTION,
              quantity: new Prisma.Decimal(-Number(item.quantity)),
              quantityBefore: new Prisma.Decimal(qtyBefore),
              quantityAfter: new Prisma.Decimal(qtyAfter),
              reason: `Sale — Order ${orderNumber}`,
              referenceId: order.id,
              createdById: cashierId,
            },
          });
        }
      }

      // Queue AccountingEvents
      await tx.accountingEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          type: 'SALE',
          status: 'PENDING',
          payload: {
            orderId: order.id,
            orderNumber,
            branchId: payload.branchId,
            completedAt: payload.createdAt,
            lines: payload.items,
            payments: payload.payments,
            vatAmount: payload.vatAmount,
            totalAmount: payload.totalAmount,
            discountAmount: payload.discountAmount,
            isPwdScDiscount: payload.isPwdScDiscount,
          } as unknown as Prisma.JsonObject,
        },
      });

      await tx.accountingEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          type: 'COGS',
          status: 'PENDING',
          payload: {
            orderId: order.id,
            branchId: payload.branchId,
            lines: payload.items
              .filter((i) => i.costPrice != null)
              .map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
                unitCost: i.costPrice,
                totalCost: Number(i.quantity) * Number(i.costPrice),
              })),
          } as unknown as Prisma.JsonObject,
        },
      });

      return order;
    });
  }

  // ─── Void order (same-day, requires manager auth) ────────────────────────

  async void(tenantId: string, orderId: string, managerId: string, reason: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'COMPLETED') {
      throw new BadRequestException('Only completed orders can be voided');
    }

    const today = new Date();
    const completedAt = order.completedAt ?? order.createdAt;
    if (
      completedAt.getFullYear() !== today.getFullYear() ||
      completedAt.getMonth() !== today.getMonth() ||
      completedAt.getDate() !== today.getDate()
    ) {
      throw new ForbiddenException('Voids are only allowed on the same day as the sale');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'VOIDED',
          voidedById: managerId,
          voidedAt: new Date(),
          voidReason: reason,
        },
      });

      // Reverse inventory and log the reversal
      const items = await tx.orderItem.findMany({ where: { orderId } });
      for (const item of items) {
        const invItem = await tx.inventoryItem.findUnique({
          where: { branchId_productId: { branchId: order.branchId!, productId: item.productId } },
        });
        if (invItem) {
          const qtyBefore = Number(invItem.quantity);
          const qtyAfter = qtyBefore + Number(item.quantity);
          await tx.inventoryItem.update({
            where: { branchId_productId: { branchId: order.branchId!, productId: item.productId } },
            data: { quantity: new Prisma.Decimal(qtyAfter) },
          });
          await tx.inventoryLog.create({
            data: {
              tenantId,
              branchId: order.branchId!,
              productId: item.productId,
              type: InventoryLogType.VOID_REVERSAL,
              quantity: new Prisma.Decimal(Number(item.quantity)),
              quantityBefore: new Prisma.Decimal(qtyBefore),
              quantityAfter: new Prisma.Decimal(qtyAfter),
              reason: `Void — Order ${order.orderNumber}: ${reason}`,
              referenceId: orderId,
              createdById: managerId,
            },
          });
        }
      }

      // Queue reversal accounting event
      await tx.accountingEvent.create({
        data: {
          tenantId,
          orderId,
          type: 'VOID',
          status: 'PENDING',
          payload: { orderId, reason } as unknown as Prisma.JsonObject,
        },
      });

      return updated;
    });
  }

  // ─── List orders ─────────────────────────────────────────────────────────

  findAll(tenantId: string, branchId?: string, shiftId?: string) {
    return this.prisma.order.findMany({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
        ...(shiftId ? { shiftId } : {}),
      },
      include: {
        items: true,
        payments: true,
        discounts: true,
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        items: true,
        payments: true,
        discounts: true,
        createdBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ─── Bulk sync from offline queue ────────────────────────────────────────

  async bulkSync(tenantId: string, cashierId: string, orders: OfflineOrder[]) {
    const results: { clientUuid: string; orderId?: string; error?: string }[] = [];
    for (const order of orders) {
      try {
        const created = await this.create(tenantId, cashierId, order);
        results.push({ clientUuid: order.clientUuid!, orderId: created.id });
      } catch (err: any) {
        results.push({ clientUuid: order.clientUuid!, error: err.message });
      }
    }
    return results;
  }

  private async generateOrderNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.order.count({ where: { tenantId } });
    const seq = String(count + 1).padStart(6, '0');
    return `ORD-${year}-${seq}`;
  }
}
