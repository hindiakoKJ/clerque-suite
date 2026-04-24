import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCategoryDto {
  name: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateCategoryDto {
  name?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
}

@Injectable()
export class CategoriesService {
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
}
