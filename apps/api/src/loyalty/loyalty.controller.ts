import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import type { StampAccrualBasis } from '@prisma/client';
import { LoyaltyService } from './loyalty.service';

@ApiTags('Loyalty')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly svc: LoyaltyService) {}

  // ── Templates (owner / manager) ─────────────────────────────────────────

  @ApiOperation({ summary: 'List stamp card templates' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER')
  @Get('templates')
  listTemplates(@CurrentUser() user: JwtPayload) {
    return this.svc.listTemplates(user.tenantId!);
  }

  @ApiOperation({ summary: 'Create a stamp card template' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  createTemplate(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      name: string;
      rewardLabel: string;
      requiredStamps: number;
      accrualBasis?: StampAccrualBasis;
      accrualThreshold?: number | null;
      minOrderTotal?: number | null;
      expiryDays?: number | null;
    },
  ) {
    return this.svc.createTemplate(user.tenantId!, body);
  }

  @ApiOperation({ summary: 'Update a stamp card template' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Patch('templates/:id')
  @HttpCode(HttpStatus.OK)
  updateTemplate(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Partial<{
      name: string;
      rewardLabel: string;
      requiredStamps: number;
      accrualBasis: StampAccrualBasis;
      accrualThreshold: number | null;
      minOrderTotal: number | null;
      expiryDays: number | null;
      isActive: boolean;
    }>,
  ) {
    return this.svc.updateTemplate(user.tenantId!, id, body);
  }

  @ApiOperation({ summary: 'Soft-delete (deactivate) a template' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Delete('templates/:id')
  @HttpCode(HttpStatus.OK)
  deleteTemplate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.deleteTemplate(user.tenantId!, id);
  }

  // ── Customer cards ─────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List a customer\'s stamp cards (lazy-creates one per active template)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER')
  @Get('customers/:id/cards')
  listCustomerCards(
    @CurrentUser() user: JwtPayload,
    @Param('id') customerId: string,
  ) {
    return this.svc.listCustomerCards(user.tenantId!, customerId);
  }

  @ApiOperation({ summary: 'Redeem a card (reward claimed; stamps reset)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER')
  @Post('cards/:id/redeem')
  @HttpCode(HttpStatus.OK)
  redeem(
    @CurrentUser() user: JwtPayload,
    @Param('id') cardId: string,
    @Body() body: { note?: string },
  ) {
    return this.svc.redeemCard(user.tenantId!, cardId, user.sub, body.note);
  }

  @ApiOperation({ summary: 'Manual stamp adjustment (owner only)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post('cards/:id/adjust')
  @HttpCode(HttpStatus.OK)
  adjust(
    @CurrentUser() user: JwtPayload,
    @Param('id') cardId: string,
    @Body() body: { delta: number; note: string },
  ) {
    return this.svc.adjustCard(user.tenantId!, cardId, body.delta, body.note, user.sub);
  }
}
