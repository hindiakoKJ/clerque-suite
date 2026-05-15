import {
  BadRequestException, Body, Controller, Get, Post, Query, Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { UseApiKey } from '../auth/decorators/use-api-key.decorator';
import type { ApiAccessLevel } from '@repo/shared-types';

interface ApiKeyPrincipal {
  isApiKey:    true;
  tenantId:    string;
  apiKeyId:    string;
  accessLevel: ApiAccessLevel;
}

function principal(req: Request): ApiKeyPrincipal {
  const p = (req as Request & { user?: ApiKeyPrincipal }).user;
  if (!p || !p.isApiKey) throw new BadRequestException('No API key context.');
  return p;
}

@ApiTags('Public API v1')
@UseApiKey('read')
@Controller('public-api/v1')
export class PublicApiController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /public-api/v1/products
   * List active products for the calling tenant.
   */
  @Get('products')
  async listProducts(@Req() req: Request) {
    const { tenantId } = principal(req);
    const rows = await this.prisma.product.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { name: 'asc' },
      take:    500,
      select: {
        id: true,
        sku: true,
        name: true,
        price: true,
        costPrice: true,
        categoryId: true,
        isActive: true,
        createdAt: true,
      },
    });
    return { data: rows, count: rows.length };
  }

  /**
   * GET /public-api/v1/orders?from=&to=&limit=&cursor=
   * Cursor pagination on createdAt DESC, then id.
   */
  @Get('orders')
  async listOrders(
    @Req() req:        Request,
    @Query('from')     from?:   string,
    @Query('to')       to?:     string,
    @Query('limit')    limit?:  string,
    @Query('cursor')   cursor?: string,
  ) {
    const { tenantId } = principal(req);
    const take = Math.min(parseInt(limit ?? '50', 10) || 50, 200);
    const fromD = from ? new Date(from) : undefined;
    const toD   = to   ? new Date(to)   : undefined;
    if (fromD && Number.isNaN(fromD.getTime())) throw new BadRequestException('from is invalid.');
    if (toD   && Number.isNaN(toD.getTime()))   throw new BadRequestException('to is invalid.');

    const rows = await this.prisma.order.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(fromD || toD ? { createdAt: { ...(fromD ? { gte: fromD } : {}), ...(toD ? { lte: toD } : {}) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take:    take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        orderNumber: true,
        status: true,
        branchId: true,
        subtotal: true,
        discountAmount: true,
        vatAmount: true,
        totalAmount: true,
        invoiceType: true,
        createdAt: true,
        paidAt: true,
        completedAt: true,
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > take) {
      const next = rows.pop()!;
      nextCursor = next.id;
    }
    return { data: rows, nextCursor };
  }

  /**
   * GET /public-api/v1/inventory
   * Snapshot of current product + raw-material stock for the tenant.
   */
  @Get('inventory')
  async snapshot(@Req() req: Request) {
    const { tenantId } = principal(req);
    const [products, materials] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where:   { tenantId },
        select: {
          branchId:  true,
          productId: true,
          quantity:  true,
          product:   { select: { name: true, sku: true } },
        },
        take: 2000,
      }),
      this.prisma.rawMaterialInventory.findMany({
        where:   { tenantId },
        select: {
          branchId:      true,
          rawMaterialId: true,
          quantity:      true,
          rawMaterial:   { select: { name: true, unit: true } },
        },
        take: 2000,
      }),
    ]);
    return {
      products:      products.map((p) => ({
        branchId:    p.branchId,
        productId:   p.productId,
        name:        p.product?.name ?? null,
        sku:         p.product?.sku  ?? null,
        quantity:    Number(p.quantity),
      })),
      rawMaterials: materials.map((m) => ({
        branchId:      m.branchId,
        rawMaterialId: m.rawMaterialId,
        name:          m.rawMaterial?.name ?? null,
        unit:          m.rawMaterial?.unit ?? null,
        quantity:      Number(m.quantity),
      })),
    };
  }

  /**
   * POST /public-api/v1/orders — stub. Requires readwrite scope.
   * TODO: Wire to OrdersService.create when SUITE_T3 GA lands.
   */
  @UseApiKey('readwrite')
  @Post('orders')
  createOrder(@Req() _req: Request, @Body() _body: unknown) {
    // Intentionally not implemented yet — keep the route shape so SDKs can
    // discover capability via OpenAPI even before the implementation lands.
    return { ok: false, status: 'NOT_IMPLEMENTED' };
  }
}
