import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateModifierGroupDto {
  name: string;
  required?: boolean;
  multiSelect?: boolean;
  minSelect?: number;
  maxSelect?: number | null;
  sortOrder?: number;
  /// Optional — when provided, the group auto-applies to every product
  /// in the given category (which must belong to the same tenant).
  categoryId?: string | null;
}

export interface UpdateModifierGroupDto {
  name?: string;
  required?: boolean;
  multiSelect?: boolean;
  minSelect?: number;
  maxSelect?: number | null;
  sortOrder?: number;
  isActive?: boolean;
  /// Pass a string to bind to a category, or null to unbind.
  /// Tenant ownership is verified server-side.
  categoryId?: string | null;
}

export interface CreateModifierOptionDto {
  name: string;
  priceAdjustment?: number;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface UpdateModifierOptionDto {
  name?: string;
  priceAdjustment?: number;
  isDefault?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

@Injectable()
export class ModifiersService {
  constructor(private prisma: PrismaService) {}

  // ─── Groups ──────────────────────────────────────────────────────────────────

  async listGroups(tenantId: string, opts: { categoryId?: string | null } = {}) {
    // Filter semantics:
    //   - undefined  → no filter (return all tenant groups)
    //   - null       → only tenant-level groups (no category binding)
    //   - "<id>"     → only groups bound to that category
    const where: { tenantId: string; isActive: true; categoryId?: string | null } = {
      tenantId,
      isActive: true,
    };
    if (opts.categoryId !== undefined) where.categoryId = opts.categoryId;
    return this.prisma.modifierGroup.findMany({
      where,
      include: {
        options: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { products: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createGroup(tenantId: string, dto: CreateModifierGroupDto) {
    if (dto.categoryId) {
      await this.assertCategoryBelongsToTenant(tenantId, dto.categoryId);
    }
    return this.prisma.modifierGroup.create({
      data: {
        tenantId,
        name: dto.name,
        required: dto.required ?? false,
        multiSelect: dto.multiSelect ?? false,
        minSelect: dto.minSelect ?? 0,
        maxSelect: dto.maxSelect ?? null,
        sortOrder: dto.sortOrder ?? 0,
        categoryId: dto.categoryId ?? null,
      },
      include: { options: true },
    });
  }

  async updateGroup(tenantId: string, groupId: string, dto: UpdateModifierGroupDto) {
    await this.findGroup(tenantId, groupId);
    // Validate any category binding belongs to the same tenant before writing.
    // `categoryId: null` (explicit unbind) is allowed and skips the lookup.
    if (dto.categoryId) {
      await this.assertCategoryBelongsToTenant(tenantId, dto.categoryId);
    }
    // Atomic tenant-scoped update — closes TOCTOU between findGroup and update.
    const result = await this.prisma.modifierGroup.updateMany({
      where: { id: groupId, tenantId },
      data:  dto,
    });
    if (result.count === 0) throw new NotFoundException('Modifier group not found');
    return this.prisma.modifierGroup.findUnique({
      where: { id: groupId },
      include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
  }

  async deleteGroup(tenantId: string, groupId: string) {
    await this.findGroup(tenantId, groupId);
    const inUse = await this.prisma.productModifierGroup.count({
      // Scope through Product.tenantId so a cross-tenant attacker can't
      // probe groupId existence by inspecting the inUse count.
      where: { modifierGroupId: groupId, product: { tenantId } },
    });
    if (inUse > 0) {
      // Soft-delete (atomic) when products still reference the group.
      const soft = await this.prisma.modifierGroup.updateMany({
        where: { id: groupId, tenantId },
        data:  { isActive: false },
      });
      if (soft.count === 0) throw new NotFoundException('Modifier group not found');
      return this.prisma.modifierGroup.findUnique({ where: { id: groupId } });
    }
    const hard = await this.prisma.modifierGroup.deleteMany({ where: { id: groupId, tenantId } });
    if (hard.count === 0) throw new NotFoundException('Modifier group not found');
    return { id: groupId };
  }

  // ─── Options ─────────────────────────────────────────────────────────────────

  async createOption(tenantId: string, groupId: string, dto: CreateModifierOptionDto) {
    await this.findGroup(tenantId, groupId);
    return this.prisma.modifierOption.create({
      data: {
        modifierGroupId: groupId,
        name: dto.name,
        priceAdjustment: dto.priceAdjustment ?? 0,
        isDefault: dto.isDefault ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateOption(
    tenantId: string,
    groupId: string,
    optionId: string,
    dto: UpdateModifierOptionDto,
  ) {
    await this.findOption(tenantId, groupId, optionId);
    // ModifierOption has no own tenantId — scope through parent group.
    const result = await this.prisma.modifierOption.updateMany({
      where: { id: optionId, modifierGroupId: groupId, group: { tenantId } },
      data:  dto,
    });
    if (result.count === 0) throw new NotFoundException('Modifier option not found');
    return this.prisma.modifierOption.findUnique({ where: { id: optionId } });
  }

  async deleteOption(tenantId: string, groupId: string, optionId: string) {
    await this.findOption(tenantId, groupId, optionId);
    const result = await this.prisma.modifierOption.deleteMany({
      where: { id: optionId, modifierGroupId: groupId, group: { tenantId } },
    });
    if (result.count === 0) throw new NotFoundException('Modifier option not found');
    return { id: optionId };
  }

  // ─── Product ↔ Group wiring ───────────────────────────────────────────────

  async attachGroupToProduct(tenantId: string, productId: string, groupId: string, sortOrder = 0) {
    await this.findGroup(tenantId, groupId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Idempotent: the caller's intent is "this group should be attached
    // to this product." If it already is, that's the desired end state —
    // returning a 409 made the web modal's auto-attach-after-create flow
    // double-fire and surface a "Failed to attach" toast even though the
    // data was correctly persisted.
    return this.prisma.productModifierGroup.upsert({
      where:  { productId_modifierGroupId: { productId, modifierGroupId: groupId } },
      create: { productId, modifierGroupId: groupId, sortOrder },
      update: {},
    });
  }

  async detachGroupFromProduct(tenantId: string, productId: string, groupId: string) {
    await this.findGroup(tenantId, groupId);
    return this.prisma.productModifierGroup.delete({
      where: { productId_modifierGroupId: { productId, modifierGroupId: groupId } },
    });
  }

  /**
   * Returns the UNION of:
   *   1. Per-product attached groups (ProductModifierGroup rows)
   *   2. Category-level groups (ModifierGroup.categoryId === product.categoryId)
   *
   * Deduplicated by group id — per-product attachment wins when both exist
   * (its sortOrder is preserved). Each returned row carries a `source` field
   * so the till UI can distinguish category-managed groups (which can't be
   * detached at the product level) from per-product ones.
   *
   * The shape of pre-existing rows (productModifierGroup join rows with
   * `modifierGroup` nested) is preserved for backwards compatibility — the
   * Web ModifierPickerModal already reads `r.modifierGroup` / `r.sortOrder`.
   */
  async getProductGroups(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true, categoryId: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const [productLinks, categoryGroups] = await Promise.all([
      this.prisma.productModifierGroup.findMany({
        where: { productId, modifierGroup: { isActive: true } },
        include: {
          modifierGroup: {
            include: {
              options: {
                where: { isActive: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
      product.categoryId
        ? this.prisma.modifierGroup.findMany({
            where: { tenantId, categoryId: product.categoryId, isActive: true },
            include: {
              options: {
                where: { isActive: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
            orderBy: { sortOrder: 'asc' },
          })
        : Promise.resolve([] as Array<
            Awaited<ReturnType<typeof this.prisma.modifierGroup.findFirst>> & { options: unknown[] }
          >),
    ]);

    const seen = new Set<string>();
    const out: Array<{
      modifierGroupId: string;
      sortOrder: number;
      source: 'product' | 'category';
      // Mirror the existing wire shape: { modifierGroup: { ...group, options } }.
      // Keeping this stable means the web/native consumers don't need changes.
      modifierGroup: typeof productLinks[number]['modifierGroup'];
    }> = [];

    for (const link of productLinks) {
      seen.add(link.modifierGroup.id);
      out.push({
        modifierGroupId: link.modifierGroup.id,
        sortOrder: link.sortOrder,
        source: 'product',
        modifierGroup: link.modifierGroup,
      });
    }
    for (const g of categoryGroups) {
      if (!g || seen.has(g.id)) continue;
      out.push({
        modifierGroupId: g.id,
        sortOrder: g.sortOrder,
        source: 'category',
        modifierGroup: g as unknown as typeof productLinks[number]['modifierGroup'],
      });
    }
    return out;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async findGroup(tenantId: string, groupId: string) {
    const group = await this.prisma.modifierGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) throw new NotFoundException('Modifier group not found');
    return group;
  }

  /**
   * Ensure a categoryId references a Category in the same tenant.
   * Used by createGroup / updateGroup before binding a modifier group to
   * a category, so we don't leak cross-tenant categories via the FK.
   */
  private async assertCategoryBelongsToTenant(tenantId: string, categoryId: string) {
    const c = await this.prisma.category.findFirst({
      where: { id: categoryId, tenantId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Category not found');
  }

  private async findOption(tenantId: string, groupId: string, optionId: string) {
    await this.findGroup(tenantId, groupId);
    const option = await this.prisma.modifierOption.findFirst({
      where: { id: optionId, modifierGroupId: groupId },
    });
    if (!option) throw new NotFoundException('Modifier option not found');
    return option;
  }
}
