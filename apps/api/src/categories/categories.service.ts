import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { COFFEE_SHOP_CATEGORIES } from '../admin/coffee-shop-categories';

export { CreateCategoryDto, UpdateCategoryDto };

@Injectable()
export class CategoriesService {
  private logger = new Logger(CategoriesService.name);
  constructor(private prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.category.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const category = await this.prisma.category.findFirst({ where: { id, tenantId } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  create(tenantId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: { tenantId, ...dto },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCategoryDto) {
    await this.findOne(tenantId, id);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    // Soft delete by deactivating
    return this.prisma.category.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * One-click "Set up coffee shop categories" for the current tenant.
   *
   * Creates 15 standard menu categories (Hot Coffee, Cold Coffee, Pastries,
   * Sandwiches, Mains, etc.) and links each to the right station based on
   * the tenant's existing floor layout — Bar gets drinks, Kitchen gets hot
   * food, Pastry Pass gets pre-made bakery, Counter handles retail.
   *
   * Idempotent — categories that already exist by name are skipped, but if
   * they have no station assigned they get one (so re-running fixes any
   * unrouted categories without disturbing user-added customisations).
   */
  async seedCoffeeShopDefaults(tenantId: string) {
    const stations = await this.prisma.station.findMany({
      where:  { tenantId },
      select: { id: true, kind: true, name: true },
    });
    const firstByKind = (k: string) => stations.find((s) => s.kind === k)?.id ?? null;
    const stationIdFor = (preferredKind: string): string | null => {
      if (preferredKind === 'BAR')         return firstByKind('BAR') ?? firstByKind('HOT_BAR') ?? firstByKind('COLD_BAR');
      if (preferredKind === 'KITCHEN')     return firstByKind('KITCHEN');
      if (preferredKind === 'PASTRY_PASS') return firstByKind('PASTRY_PASS') ?? firstByKind('BAR');
      if (preferredKind === 'COUNTER')     return firstByKind('COUNTER');
      return null;
    };

    const existing = await this.prisma.category.findMany({
      where:  { tenantId },
      select: { id: true, name: true, stationId: true },
    });
    const byName = new Map<string, { id: string; stationId: string | null }>(
      existing.map((c) => [c.name.toLowerCase(), { id: c.id, stationId: c.stationId }]),
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const seed of COFFEE_SHOP_CATEGORIES) {
      const target = stationIdFor(seed.preferredKind);
      const found = byName.get(seed.name.toLowerCase());
      if (found) {
        if (!found.stationId && target) {
          await this.prisma.category.update({
            where: { id: found.id },
            data:  { stationId: target },
          });
          updated++;
        } else {
          skipped++;
        }
        continue;
      }
      try {
        await this.prisma.category.create({
          data: {
            tenantId,
            name:        seed.name,
            description: seed.description,
            sortOrder:   seed.sortOrder,
            stationId:   target,
            isActive:    true,
          },
        });
        created++;
      } catch (err) {
        this.logger.warn(`Skipping category ${seed.name} due to error: ${err}`);
        skipped++;
      }
    }

    return {
      created,
      updated,
      skipped,
      total:    COFFEE_SHOP_CATEGORIES.length,
      stations: stations.map((s) => ({ id: s.id, kind: s.kind, name: s.name })),
    };
  }
}
