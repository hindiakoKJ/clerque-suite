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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';

@ApiTags('Promotions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('promotions')
export class PromotionsController {
  constructor(private promotionsService: PromotionsService) {}

  /**
   * List all promotions for the tenant — management view.
   * Managers, MDM, and sales leads can see the full promo catalog.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'MDM', 'SALES_LEAD')
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.promotionsService.findAll(user.tenantId!, {
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      search,
    });
  }

  /**
   * Return promotions that are active RIGHT NOW for a given set of product IDs.
   * Used by the POS terminal at checkout to compute applicable discounts.
   * All cashier-side roles are permitted.
   */
  @Roles(
    'CASHIER',
    'SALES_LEAD',
    'BUSINESS_OWNER',
    'SUPER_ADMIN',
    'BRANCH_MANAGER',
    'MDM',
  )
  @Get('active')
  findActive(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId: string,
    @Query('productIds') productIds?: string,
  ) {
    const ids = productIds ? productIds.split(',').filter(Boolean) : [];
    return this.promotionsService.findActive(
      user.tenantId!,
      branchId ?? user.branchId ?? '',
      ids,
    );
  }

  /**
   * Create a new promotion.
   * Restricted to owners, super admins, and MDM role.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'MDM')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePromotionDto) {
    return this.promotionsService.create(user.tenantId!, dto);
  }

  /**
   * Update an existing promotion (including its product list).
   * Restricted to owners, super admins, and MDM role.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'MDM')
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.promotionsService.update(id, user.tenantId!, dto);
  }

  /**
   * Deactivate (soft-delete) a promotion.
   * Restricted to owners and super admins.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.promotionsService.remove(id, user.tenantId!);
  }
}
