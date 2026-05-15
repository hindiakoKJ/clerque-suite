import {
  Controller,
  Get,
  Post,
  Patch,
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
import { PlanFeatureGuard } from '../auth/guards/plan-feature.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { VoidApprovalStatus } from '@prisma/client';
import { VoidApprovalsService } from './void-approvals.service';

interface InitiateBody {
  orderId:     string;
  orderItemId?: string | null;
  amountCents: number;
  reason:      string;
}

interface RejectBody {
  rejectionReason: string;
}

@ApiTags('VoidApprovals')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@RequirePlanFeature('makerCheckerVoids')
@Controller('void-approvals')
export class VoidApprovalsController {
  constructor(private readonly svc: VoidApprovalsService) {}

  /**
   * Cashier (or any operational role) opens a maker-checker request.
   * No money moves yet — the void itself is processed only after a
   * supervisor approves and the cashier retries the void.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  initiate(@CurrentUser() user: JwtPayload, @Body() body: InitiateBody) {
    return this.svc.initiate(
      user.tenantId!,
      user.sub,
      body.orderId,
      body.orderItemId ?? null,
      body.amountCents,
      body.reason,
    );
  }

  /** Supervisor approves a pending request. SOD enforced in service. */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'SUPER_ADMIN')
  @Patch(':id/approve')
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.approve(user.tenantId!, user.sub, id);
  }

  /** Supervisor rejects a pending request with a reason. */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'SUPER_ADMIN')
  @Patch(':id/reject')
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: RejectBody,
  ) {
    return this.svc.reject(user.tenantId!, user.sub, id, body.rejectionReason);
  }

  /** List for the management UI. Optional ?status=PENDING|APPROVED|REJECTED. */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD', 'SUPER_ADMIN', 'EXTERNAL_AUDITOR')
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
  ) {
    let statusFilter: VoidApprovalStatus | undefined;
    if (status && (Object.values(VoidApprovalStatus) as string[]).includes(status)) {
      statusFilter = status as VoidApprovalStatus;
    }
    return this.svc.list(user.tenantId!, statusFilter);
  }
}
