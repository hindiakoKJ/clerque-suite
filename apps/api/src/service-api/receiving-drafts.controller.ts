import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { effectiveBranchId } from '../common/branch-scope';
import { ReceivingDraftsService } from './receiving-drafts.service';

/**
 * Receiving drafts, for a person: the deliveries an API key read from invoice
 * photos, waiting to be confirmed. JWT only and no 'SERVICE' role, so no API
 * key reaches any of these routes -- a machine can make a draft and never
 * confirm or discard one.
 *
 * Owner and branch manager: confirming receives stock at a cost and files a
 * supplier bill, so it stays with the people who see purchase costs. A branch
 * manager sees and acts on their own branch's deliveries only.
 */
@ApiTags('Receiving drafts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('BUSINESS_OWNER', 'BRANCH_MANAGER')
@Controller('receiving-drafts')
export class ReceivingDraftsController {
  constructor(private readonly svc: ReceivingDraftsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.svc.list(user.tenantId!, status, effectiveBranchId(user));
  }

  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getNamed(user.tenantId!, id, effectiveBranchId(user));
  }

  /** One tap: receive every line and file the bill, through Clerque's own receiving. */
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body?: { acceptCostChange?: boolean },
  ) {
    return this.svc.confirm(user.tenantId!, id, user.sub, {
      acceptCostChange: body?.acceptCostChange === true,
      branchId:         effectiveBranchId(user),
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.cancel(user.tenantId!, id, effectiveBranchId(user));
  }
}
