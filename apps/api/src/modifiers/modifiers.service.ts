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
}

export interface UpdateModifierGroupDto {
  name?: string;
  required?: boolean;
  multiSelect?: boolean;
  minSelect?: number;
  maxSelect?: number | null;
  sortOrder?: number;
  isActive?: boolean;
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

  async listGroups(tenantId: string) {
    return this.prisma.modifierGroup.findMany({
      where: { tenantId, isActive: true },
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
    return this.prisma.modifierGroup.create({
      data: {
        tenantId,
        name: dto.name,
        required: dto.required ?? false,
        multiSelect: dto.multiSelect ?? false,
        minSelect: dto.minSelect ?? 0,
        maxSelect: dto.maxSelect ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: { options: true },
    });
  }

  async updateGroup(tenantId: string, groupId: string, dto: UpdateModifierGroupDto) {
    await this.findGroup(tenantId, groupId);
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

  async getProductGroups(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.productModifierGroup.findMany({
      where: { productId },
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
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async findGroup(tenantId: string, groupId: string) {
    const group = await this.prisma.modifierGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) throw new NotFoundException('Modifier group not found');
    return group;
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
