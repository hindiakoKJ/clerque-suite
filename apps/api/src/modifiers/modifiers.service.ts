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
    return this.prisma.modifierGroup.update({
      where: { id: groupId },
      data: dto,
      include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
  }

  async deleteGroup(tenantId: string, groupId: string) {
    const group = await this.findGroup(tenantId, groupId);
    const inUse = await this.prisma.productModifierGroup.count({
      where: { modifierGroupId: groupId },
    });
    if (inUse > 0) {
      // Soft-delete instead of hard delete when products reference the group
      return this.prisma.modifierGroup.update({
        where: { id: groupId },
        data: { isActive: false },
      });
    }
    return this.prisma.modifierGroup.delete({ where: { id: groupId } });
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
    return this.prisma.modifierOption.update({
      where: { id: optionId },
      data: dto,
    });
  }

  async deleteOption(tenantId: string, groupId: string, optionId: string) {
    await this.findOption(tenantId, groupId, optionId);
    return this.prisma.modifierOption.delete({ where: { id: optionId } });
  }

  // ─── Product ↔ Group wiring ───────────────────────────────────────────────

  async attachGroupToProduct(tenantId: string, productId: string, groupId: string, sortOrder = 0) {
    await this.findGroup(tenantId, groupId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    try {
      return await this.prisma.productModifierGroup.create({
        data: { productId, modifierGroupId: groupId, sortOrder },
      });
    } catch {
      throw new ConflictException('Modifier group already attached to this product');
    }
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
