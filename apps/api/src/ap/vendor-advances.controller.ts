import {
  Controller, Get, Post, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp } from '../auth/decorators/require-app.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { RequireIdempotency } from '../common/decorators/require-idempotency.decorator';
import { VendorAdvancesService } from './vendor-advances.service';
import {
  CreateVendorAdvanceDto,
  ApplyVendorAdvanceDto,
  RefundVendorAdvanceDto,
  VoidVendorAdvanceDto,
} from './dto/vendor-advance.dto';

@ApiTags('AP Vendor Advances')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard)
@RequireApp('LEDGER', 'READ_ONLY')
@Controller('ap/vendor-advances')
export class VendorAdvancesController {
  constructor(private svc: VendorAdvancesService) {}

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page')     page?:     string,
    @Query('pageSize') pageSize?: string,
    @Query('vendorId') vendorId?: string,
    @Query('status')   status?:   string,
    @Query('from')     from?:     string,
    @Query('to')       to?:       string,
  ) {
    return this.svc.findAll(user.tenantId!, {
      page:     page     ? Number(page)     : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      vendorId, status, from, to,
    });
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  /** Create a DRAFT vendor advance. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateVendorAdvanceDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  /** Post a DRAFT advance — emits the asset/cash JE. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @RequireIdempotency()
  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.post(user.tenantId!, id, user.sub);
  }

  /** Apply the (unapplied portion of a) posted advance to a bill. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApplyVendorAdvanceDto,
  ) {
    return this.svc.apply(user.tenantId!, id, user.sub, dto);
  }

  /** Refund the unapplied balance from the vendor — terminal state. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @RequireIdempotency()
  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  refund(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RefundVendorAdvanceDto,
  ) {
    return this.svc.refund(user.tenantId!, id, user.sub, dto);
  }

  /** Void a posted advance — reverses the JE + rolls back applications. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT')
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  voidAdvance(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: VoidVendorAdvanceDto,
  ) {
    return this.svc.void(user.tenantId!, id, user.sub, dto.reason);
  }
}
