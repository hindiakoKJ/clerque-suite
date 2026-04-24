import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { CategoriesService, CreateCategoryDto, UpdateCategoryDto } from './categories.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.categoriesService.findAll(user.tenantId!);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.categoriesService.findOne(user.tenantId!, id);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(user.tenantId!, dto);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER')
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(user.tenantId!, id, dto);
  }

  @Roles('BUSINESS_OWNER')
  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.categoriesService.remove(user.tenantId!, id);
  }
}
