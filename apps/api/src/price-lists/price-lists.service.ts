/**
 * Clerque API — PriceListsService
 *
 * Wholesale / corporate / per-customer pricing overrides. A Customer can be
 * assigned a PriceList; when present, OrdersService should resolve every line's
 * unit price from PriceListItem before snapshotting.
 *
 * Service layer is intentionally small: list + CRUD + bulk-replace items.
 * Resolution happens in OrdersService for now (Counter client still sends
 * the resolved price as it does today; web-pricing-resolver pending).
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface UpsertPriceListItemDto {
  productId:   string;
  unitPrice:   number;  // pesos
  minQuantity?: number;
}

export interface CreatePriceListDto {
  name:  string;
  notes?: string;
  items?: UpsertPriceListItemDto[];
}

export interface UpdatePriceListDto {
  name?:     string;
  notes?:    string | null;
  isActive?: boolean;
}

@Injectable()
export class PriceListsService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.priceList.findMany({
      where: { tenantId, isActive: true },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, price: true } } },
          orderBy: { product: { name: 'asc' } },
        },
        _count: { select: { customers: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getOne(tenantId: string, id: string) {
    const row = await this.prisma.priceList.findFirst({
      where: { id, tenantId },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, price: true } } },
          orderBy: { product: { name: 'asc' } },
        },
        customers: { select: { id: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException('Price list not found');
    return row;
  }

  async create(tenantId: string, dto: CreatePriceListDto) {
    if (!dto.name?.trim()) throw new BadRequestException('Name is required.');
    if (dto.items?.length) await this.validateProducts(tenantId, dto.items.map(i => i.productId));

    return this.prisma.priceList.create({
      data: {
        tenantId,
        name:  dto.name.trim(),
        notes: dto.notes ?? null,
        items: dto.items?.length
          ? {
              create: dto.items.map(i => ({
                productId:   i.productId,
                unitPrice:   new Prisma.Decimal(i.unitPrice),
                minQuantity: i.minQuantity != null ? new Prisma.Decimal(i.minQuantity) : null,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });
  }

  async update(tenantId: string, id: string, dto: UpdatePriceListDto) {
    await this.getOne(tenantId, id);
    return this.prisma.priceList.update({
      where: { id },
      data: {
        name:     dto.name?.trim(),
        notes:    dto.notes === undefined ? undefined : dto.notes,
        isActive: dto.isActive,
      },
    });
  }

  /**
   * Replace the entire item list in one transaction. Simpler UX than per-row
   * CRUD for the price-list editor — owner sets every row, hits Save once.
   */
  async setItems(tenantId: string, id: string, items: UpsertPriceListItemDto[]) {
    await this.getOne(tenantId, id);
    if (items.length > 0) {
      const ids = items.map(i => i.productId);
      if (ids.length !== new Set(ids).size) {
        throw new BadRequestException('Each product can appear only once on a price list.');
      }
      await this.validateProducts(tenantId, ids);
      for (const i of items) {
        if (!Number.isFinite(i.unitPrice) || i.unitPrice <= 0) {
          throw new BadRequestException(`Unit price must be positive (got ${i.unitPrice}).`);
        }
      }
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.priceListItem.deleteMany({ where: { priceListId: id } });
      if (items.length > 0) {
        await tx.priceListItem.createMany({
          data: items.map(i => ({
            priceListId: id,
            productId:   i.productId,
            unitPrice:   new Prisma.Decimal(i.unitPrice),
            minQuantity: i.minQuantity != null ? new Prisma.Decimal(i.minQuantity) : null,
          })),
        });
      }
      return tx.priceList.findUnique({
        where: { id },
        include: {
          items: {
            include: { product: { select: { id: true, name: true, price: true } } },
            orderBy: { product: { name: 'asc' } },
          },
        },
      });
    });
  }

  /**
   * Resolve a customer's line price for a product. Returns the override
   * price (cents) when one exists + meets minQuantity; otherwise null so the
   * caller falls back to Product.price.
   */
  async resolvePrice(
    tenantId: string,
    customerId: string,
    productId: string,
    quantity: number,
  ): Promise<number | null> {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { priceListId: true },
    });
    if (!c?.priceListId) return null;
    const item = await this.prisma.priceListItem.findUnique({
      where: { priceListId_productId: { priceListId: c.priceListId, productId } },
    });
    if (!item) return null;
    if (item.minQuantity != null && quantity < Number(item.minQuantity)) {
      return null; // Doesn't meet minimum; fall back to default price.
    }
    return Math.round(Number(item.unitPrice) * 100);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async validateProducts(tenantId: string, productIds: string[]) {
    const found = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId },
      select: { id: true },
    });
    if (found.length !== productIds.length) {
      throw new BadRequestException('One or more products do not belong to this tenant.');
    }
  }
}
