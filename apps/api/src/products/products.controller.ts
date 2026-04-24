import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ProductsService, CreateProductDto, UpdateProductDto } from './products.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.productsService.findAll(user.tenantId!, includeInactive === 'true');
  }

  @Get('pos')
  findForPos(@CurrentUser() user: JwtPayload, @Query('branchId') branchId: string) {
    return this.productsService.findForPos(user.tenantId!, branchId ?? user.branchId ?? '');
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.productsService.findOne(user.tenantId!, id);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateProductDto) {
    return this.productsService.create(user.tenantId!, dto);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER')
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(user.tenantId!, id, dto);
  }

  @Roles('BUSINESS_OWNER')
  @Delete(':id')
  deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.productsService.deactivate(user.tenantId!, id);
  }
}
