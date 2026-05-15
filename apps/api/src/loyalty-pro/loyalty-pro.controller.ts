/**
 * Sprint 25 Phase 2C — Loyalty Pro controller.
 *
 * All routes gated on the `loyaltyPro` plan feature (Pro-tier).
 */
import {
  Body, Controller, Get, Param, Post, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlanFeatureGuard } from '../auth/guards/plan-feature.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { LoyaltyProService } from './loyalty-pro.service';

@ApiTags('Loyalty Pro')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@RequirePlanFeature('loyaltyPro')
@Controller('loyalty-pro')
export class LoyaltyProController {
  constructor(private readonly svc: LoyaltyProService) {}

  // ── Programs ──────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List stamp programs' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER')
  @Get('programs')
  listPrograms(@CurrentUser() user: JwtPayload) {
    return this.svc.listPrograms(user.tenantId!);
  }

  @ApiOperation({ summary: 'Create a stamp program' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post('programs')
  @HttpCode(HttpStatus.CREATED)
  createProgram(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      name:            string;
      stampsRequired:  number;
      rewardProductId?: string | null;
      isActive?:       boolean;
    },
  ) {
    return this.svc.createProgram(user.tenantId!, body);
  }

  // ── Stamps grant / redeem / balance ───────────────────────────────────────

  @ApiOperation({ summary: 'Grant stamps to a customer (cashier flow)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER')
  @Post('stamps/grant')
  @HttpCode(HttpStatus.OK)
  grant(
    @CurrentUser() user: JwtPayload,
    @Body() body: { customerId: string; programId: string; count: number },
  ) {
    return this.svc.grantStamps(user.tenantId!, body);
  }

  @ApiOperation({ summary: 'Redeem stamps — atomically zeros earned and returns the reward productId' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER')
  @Post('stamps/redeem')
  @HttpCode(HttpStatus.OK)
  redeem(
    @CurrentUser() user: JwtPayload,
    @Body() body: { customerId: string; programId: string },
  ) {
    return this.svc.redeem(user.tenantId!, body);
  }

  @ApiOperation({ summary: 'Customer stamp balance across all programs' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER')
  @Get('stamps/:customerId')
  balance(
    @CurrentUser() user: JwtPayload,
    @Param('customerId') customerId: string,
  ) {
    return this.svc.getBalance(user.tenantId!, customerId);
  }
}
