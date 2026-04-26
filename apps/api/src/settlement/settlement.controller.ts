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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SettlementService } from './settlement.service';
import { CreateSettlementBatchDto } from './dto/create-settlement.dto';
import { ConfirmSettlementDto } from './dto/confirm-settlement.dto';
import { AddItemsToSettlementDto } from './dto/add-items-settlement.dto';
import { PaymentMethod, SettlementStatus } from '@prisma/client';

@ApiTags('Settlement')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('settlement')
export class SettlementController {
  constructor(private settlementService: SettlementService) {}

  /** Amounts still pending settlement per payment method — dashboard widget */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'ACCOUNTANT')
  @Get('pending-summary')
  getPendingSummary(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.settlementService.getPendingSummary(
      user.tenantId!,
      branchId ?? user.branchId ?? undefined,
    );
  }

  /** List all batches — paginated, filterable by status */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'ACCOUNTANT')
  @Get('batches')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('status') status?: SettlementStatus,
    @Query('page') page?: string,
  ) {
    return this.settlementService.list(
      user.tenantId!,
      branchId ?? user.branchId ?? undefined,
      status,
      page ? parseInt(page) : 1,
    );
  }

  /** Get one batch with all its line items */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'ACCOUNTANT')
  @Get('batches/:id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.settlementService.findOne(user.tenantId!, id);
  }

  /** Payments not yet assigned to any batch — shown in reconciliation screen */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'ACCOUNTANT')
  @Get('unmatched')
  getUnmatched(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId: string,
    @Query('method') method: PaymentMethod,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.settlementService.getUnmatchedPayments(
      user.tenantId!,
      branchId ?? user.branchId!,
      method,
      from,
      to,
    );
  }

  /** Create a new settlement batch */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('batches')
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateSettlementBatchDto) {
    return this.settlementService.create(user.tenantId!, user.sub, body);
  }

  /** Add order payments to a batch (cash application step) */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Post('batches/:id/items')
  @HttpCode(HttpStatus.OK)
  addItems(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: AddItemsToSettlementDto,
  ) {
    return this.settlementService.addItems(user.tenantId!, id, body);
  }

  /** Confirm bank receipt — Owner checks bank statement and confirms amount */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Patch('batches/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: ConfirmSettlementDto,
  ) {
    return this.settlementService.confirmSettlement(user.tenantId!, id, user.sub, body);
  }

  /** Mark a SETTLED or DISPUTED batch as fully reconciled */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  @Patch('batches/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  reconcile(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.settlementService.markReconciled(user.tenantId!, id, user.sub);
  }
}
