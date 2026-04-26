import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';

// PH timezone offset: UTC+8
const PH_OFFSET_HOURS = 8;

/** Return current PH local time as { dayOfWeek (0=Sun..6=Sat), timeMinutes (minutes since midnight) } */
function getPhNow(): { date: Date; dayOfWeek: number; timeMinutes: number } {
  const now = new Date();
  const phMs = now.getTime() + PH_OFFSET_HOURS * 60 * 60 * 1000;
  const phDate = new Date(phMs);
  const dayOfWeek = phDate.getUTCDay(); // 0=Sun..6=Sat in UTC (which is PH-shifted date)
  const timeMinutes = phDate.getUTCHours() * 60 + phDate.getUTCMinutes();
  return { date: now, dayOfWeek, timeMinutes };
}

/** Parse "HH:MM" string to minutes since midnight */
function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Serialize a Promotion row into a safe plain object (Decimal → number) */
function serializePromotion(
  promo: {
    id: string;
    tenantId: string;
    name: string;
    discountPercent: { toNumber(): number } | null;
    fixedPrice: { toNumber(): number } | null;
    appliesToAll: boolean;
    isStackable: boolean;
    startDate: Date | null;
    endDate: Date | null;
    activeDays: number[];
    activeHoursStart: string | null;
    activeHoursEnd: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    products?: { productId: string }[];
    _count?: { products: number };
  },
) {
  return {
    id: promo.id,
    tenantId: promo.tenantId,
    name: promo.name,
    discountPercent: promo.discountPercent ? promo.discountPercent.toNumber() : null,
    fixedPrice: promo.fixedPrice ? promo.fixedPrice.toNumber() : null,
    appliesToAll: promo.appliesToAll,
    isStackable: promo.isStackable,
    startDate: promo.startDate,
    endDate: promo.endDate,
    activeDays: promo.activeDays,
    activeHoursStart: promo.activeHoursStart,
    activeHoursEnd: promo.activeHoursEnd,
    isActive: promo.isActive,
    createdAt: promo.createdAt,
    updatedAt: promo.updatedAt,
    productIds: promo.products ? promo.products.map((p) => p.productId) : undefined,
    productCount: promo._count ? promo._count.products : undefined,
  };
}

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  // ─── List all promotions (management view) ────────────────────────────────

  async findAll(
    tenantId: string,
    filters?: { isActive?: boolean; search?: string },
  ) {
    const where = {
      tenantId,
      ...(filters?.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters?.search
        ? { name: { contains: filters.search, mode: 'insensitive' as const } }
        : {}),
    };

    const promos = await this.prisma.promotion.findMany({
      where,
      include: { _count: { select: { products: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return promos.map((p) => serializePromotion(p));
  }

  // ─── Find promotions active RIGHT NOW for POS checkout ───────────────────

  async findActive(
    tenantId: string,
    _branchId: string,
    productIds: string[],
  ) {
    const { date: now, dayOfWeek, timeMinutes } = getPhNow();

    // Fetch all isActive promos for this tenant where the date range includes today
    // (or has no date restriction). We do broad DB fetch then narrow in JS for
    // the activeDays and activeHours checks (those aren't easily indexable).
    const candidates = await this.prisma.promotion.findMany({
      where: {
        tenantId,
        isActive: true,
        AND: [
          {
            OR: [
              { startDate: null },
              { startDate: { lte: now } },
            ],
          },
          {
            OR: [
              { endDate: null },
              { endDate: { gte: now } },
            ],
          },
        ],
      },
      include: { products: { select: { productId: true } } },
    });

    // Narrow by activeDays and activeHours in application logic
    const active = candidates.filter((promo) => {
      // 3. activeDays check
      if (promo.activeDays.length > 0 && !promo.activeDays.includes(dayOfWeek)) {
        return false;
      }

      // 4. activeHours check
      if (promo.activeHoursStart && promo.activeHoursEnd) {
        const start = parseHHMM(promo.activeHoursStart);
        const end = parseHHMM(promo.activeHoursEnd);
        if (timeMinutes < start || timeMinutes > end) {
          return false;
        }
      }

      // 5. Product applicability — only include if appliesToAll OR
      // at least one of the requested productIds is in this promo's products
      if (!promo.appliesToAll && productIds.length > 0) {
        const promoProductIds = new Set(promo.products.map((p) => p.productId));
        const hasMatch = productIds.some((id) => promoProductIds.has(id));
        if (!hasMatch) return false;
      }

      return true;
    });

    return active.map((p) => serializePromotion(p));
  }

  // ─── Create promotion ────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreatePromotionDto) {
    const { productIds, ...rest } = dto;

    const promo = await this.prisma.promotion.create({
      data: {
        tenantId,
        name: rest.name,
        discountPercent: rest.discountPercent !== undefined ? rest.discountPercent : null,
        fixedPrice: rest.fixedPrice !== undefined ? rest.fixedPrice : null,
        appliesToAll: rest.appliesToAll ?? false,
        isStackable: rest.isStackable ?? false,
        startDate: rest.startDate ? new Date(rest.startDate) : null,
        endDate: rest.endDate ? new Date(rest.endDate) : null,
        activeDays: rest.activeDays ?? [],
        activeHoursStart: rest.activeHoursStart ?? null,
        activeHoursEnd: rest.activeHoursEnd ?? null,
        isActive: rest.isActive ?? true,
        ...(productIds && productIds.length > 0
          ? {
              products: {
                create: productIds.map((productId) => ({ productId })),
              },
            }
          : {}),
      },
      include: { products: { select: { productId: true } }, _count: { select: { products: true } } },
    });

    return serializePromotion(promo);
  }

  // ─── Update promotion ─────────────────────────────────────────────────────

  async update(id: string, tenantId: string, dto: UpdatePromotionDto) {
    const existing = await this.prisma.promotion.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Promotion not found');

    const { productIds, ...rest } = dto;

    const promo = await this.prisma.promotion.update({
      where: { id },
      data: {
        ...(rest.name !== undefined ? { name: rest.name } : {}),
        ...(rest.discountPercent !== undefined ? { discountPercent: rest.discountPercent } : {}),
        ...(rest.fixedPrice !== undefined ? { fixedPrice: rest.fixedPrice } : {}),
        ...(rest.appliesToAll !== undefined ? { appliesToAll: rest.appliesToAll } : {}),
        ...(rest.isStackable !== undefined ? { isStackable: rest.isStackable } : {}),
        ...(rest.startDate !== undefined ? { startDate: rest.startDate ? new Date(rest.startDate) : null } : {}),
        ...(rest.endDate !== undefined ? { endDate: rest.endDate ? new Date(rest.endDate) : null } : {}),
        ...(rest.activeDays !== undefined ? { activeDays: rest.activeDays } : {}),
        ...(rest.activeHoursStart !== undefined ? { activeHoursStart: rest.activeHoursStart ?? null } : {}),
        ...(rest.activeHoursEnd !== undefined ? { activeHoursEnd: rest.activeHoursEnd ?? null } : {}),
        ...(rest.isActive !== undefined ? { isActive: rest.isActive } : {}),
        // Replace productIds if provided
        ...(productIds !== undefined
          ? {
              products: {
                deleteMany: {},
                create: productIds.map((productId) => ({ productId })),
              },
            }
          : {}),
      },
      include: { products: { select: { productId: true } }, _count: { select: { products: true } } },
    });

    return serializePromotion(promo);
  }

  // ─── Soft-delete (deactivate) promotion ───────────────────────────────────

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.promotion.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Promotion not found');

    const promo = await this.prisma.promotion.update({
      where: { id },
      data: { isActive: false },
      include: { products: { select: { productId: true } }, _count: { select: { products: true } } },
    });

    return serializePromotion(promo);
  }
}
