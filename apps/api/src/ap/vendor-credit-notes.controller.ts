import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp } from '../auth/decorators/require-app.decorator';
import { PlanFeatureGuard } from '../auth/guards/plan-feature.guard';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { VendorCreditNoteStatus } from '@prisma/client';
import { RequireIdempotency } from '../common/decorators/require-idempotency.decorator';
import { VendorCreditNotesService } from './vendor-credit-notes.service';
import {
  CreateVendorCreditNoteDto,
  UpdateVendorCreditNoteDto,
  ApplyVendorCreditNoteDto,
  VoidVendorCreditNoteDto,
} from './dto/vendor-credit-note.dto';

@ApiTags('AP Vendor Credit Notes')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard, PlanFeatureGuard)
@RequireApp('LEDGER', 'READ_ONLY')
@RequirePlanFeature('advancedAccounting')
@Controller('ap/vendor-credit-notes')
export class VendorCreditNotesController {
  constructor(private svc: VendorCreditNotesService) {}

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
      vendorId,
      status:   status as VendorCreditNoteStatus | undefined,
      from, to,
    });
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateVendorCreditNoteDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVendorCreditNoteDto,
  ) {
    return this.svc.update(user.tenantId!, id, user.sub, dto);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @RequireIdempotency()
  @Patch(':id/post')
  @HttpCode(HttpStatus.OK)
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.post(user.tenantId!, id, user.sub, user.role);
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @RequireIdempotency()
  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApplyVendorCreditNoteDto,
  ) {
    return this.svc.apply(user.tenantId!, id, user.sub, dto);
  }

  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  @RequireIdempotency()
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: VoidVendorCreditNoteDto,
  ) {
    return this.svc.void(user.tenantId!, id, user.sub, body.reason ?? '');
  }
}
