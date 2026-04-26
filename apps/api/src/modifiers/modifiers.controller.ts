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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import {
  ModifiersService,
  CreateModifierGroupDto,
  UpdateModifierGroupDto,
  CreateModifierOptionDto,
  UpdateModifierOptionDto,
} from './modifiers.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('modifiers')
export class ModifiersController {
  constructor(private modifiersService: ModifiersService) {}

  // ─── Groups ──────────────────────────────────────────────────────────────────

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('groups')
  listGroups(@CurrentUser() user: JwtPayload) {
    return this.modifiersService.listGroups(user.tenantId!);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('groups')
  createGroup(@CurrentUser() user: JwtPayload, @Body() body: CreateModifierGroupDto) {
    return this.modifiersService.createGroup(user.tenantId!, body);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Patch('groups/:id')
  updateGroup(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdateModifierGroupDto,
  ) {
    return this.modifiersService.updateGroup(user.tenantId!, id, body);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Delete('groups/:id')
  @HttpCode(HttpStatus.OK)
  deleteGroup(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.modifiersService.deleteGroup(user.tenantId!, id);
  }

  // ─── Options ─────────────────────────────────────────────────────────────────

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('groups/:groupId/options')
  createOption(
    @CurrentUser() user: JwtPayload,
    @Param('groupId') groupId: string,
    @Body() body: CreateModifierOptionDto,
  ) {
    return this.modifiersService.createOption(user.tenantId!, groupId, body);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Patch('groups/:groupId/options/:optionId')
  updateOption(
    @CurrentUser() user: JwtPayload,
    @Param('groupId') groupId: string,
    @Param('optionId') optionId: string,
    @Body() body: UpdateModifierOptionDto,
  ) {
    return this.modifiersService.updateOption(user.tenantId!, groupId, optionId, body);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Delete('groups/:groupId/options/:optionId')
  @HttpCode(HttpStatus.OK)
  deleteOption(
    @CurrentUser() user: JwtPayload,
    @Param('groupId') groupId: string,
    @Param('optionId') optionId: string,
  ) {
    return this.modifiersService.deleteOption(user.tenantId!, groupId, optionId);
  }

  // ─── Product ↔ Group ─────────────────────────────────────────────────────────

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get('products/:productId/groups')
  getProductGroups(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
  ) {
    return this.modifiersService.getProductGroups(user.tenantId!, productId);
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('products/:productId/groups/:groupId')
  @HttpCode(HttpStatus.OK)
  attachGroup(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
    @Param('groupId') groupId: string,
    @Body('sortOrder') sortOrder?: number,
  ) {
    return this.modifiersService.attachGroupToProduct(
      user.tenantId!,
      productId,
      groupId,
      sortOrder,
    );
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Delete('products/:productId/groups/:groupId')
  @HttpCode(HttpStatus.OK)
  detachGroup(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.modifiersService.detachGroupFromProduct(user.tenantId!, productId, groupId);
  }
}
