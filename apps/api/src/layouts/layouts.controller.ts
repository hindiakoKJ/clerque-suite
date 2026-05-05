import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { LayoutsService } from './layouts.service';
import {
  ApplyTierDto,
  RenameStationDto,
  SetCategoryStationDto,
  SetCustomerDisplayDto,
} from './dto';

/**
 * Floor-layout endpoints — Coffee Shop tier setup, station naming,
 * category routing, customer-display toggle.
 *
 * Tier-application is sales-controlled: we expose it under owner role here
 * but the production wiring routes it through SUPER_ADMIN / Console only
 * (per the locked decision that owners cannot self-upgrade).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('layouts')
export class LayoutsController {
  constructor(private readonly layouts: LayoutsService) {}

  /** Read the current layout (for setup wizard + Settings → Floor Layout) */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Get()
  getLayout(@CurrentUser() user: JwtPayload) {
    return this.layouts.getLayout(user.tenantId!);
  }

  /**
   * Apply a Coffee Shop tier (CS_1..CS_5).
   * Today: still allowed for BUSINESS_OWNER (initial setup needs to work
   * end-to-end before sales-controlled flow ships). The Console-only path
   * lands in 3D when we add sales-controlled upgrade UI.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Post('coffee-shop-tier')
  @HttpCode(HttpStatus.OK)
  applyTier(@CurrentUser() user: JwtPayload, @Body() dto: ApplyTierDto) {
    return this.layouts.applyCoffeeShopTier(user.tenantId!, dto.tier, {
      customerDisplayOverride: dto.customerDisplayOverride,
    });
  }

  /** Rename a station — owner-renameable, structure stays locked */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Patch('stations/:id')
  @HttpCode(HttpStatus.OK)
  renameStation(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RenameStationDto,
  ) {
    return this.layouts.renameStation(user.tenantId!, id, dto.name);
  }

  /** Route (or un-route) a category to a station */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Patch('categories/:id/station')
  @HttpCode(HttpStatus.OK)
  setCategoryStation(
    @CurrentUser() user: JwtPayload,
    @Param('id') categoryId: string,
    @Body() dto: SetCategoryStationDto,
  ) {
    return this.layouts.setCategoryStation(user.tenantId!, categoryId, dto.stationId);
  }

  /**
   * Consolidate Hot Bar + Cold Bar into a single Bar.
   *
   * For tenants that were provisioned on the old CS_5 template (Hot/Cold
   * split). Reassigns category routing and deactivates the obsolete
   * stations. Idempotent.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Post('consolidate-bars')
  @HttpCode(HttpStatus.OK)
  consolidateBars(@CurrentUser() user: JwtPayload) {
    return this.layouts.consolidateBars(user.tenantId!);
  }

  /** CS_1 only — toggle the optional customer-facing display */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('customer-display')
  @HttpCode(HttpStatus.OK)
  setCustomerDisplay(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetCustomerDisplayDto,
  ) {
    return this.layouts.setCustomerDisplay(user.tenantId!, dto.enabled);
  }
}
