import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { BillStatus } from '@prisma/client';
import { APBillsService } from './ap-bills.service';
import { CreateAPBillDto } from './dto/ap-bill.dto';

@ApiTags('AP Bills')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ap/bills')
export class APBillsController {
  constructor(private svc: APBillsService) {}

  /** List with filters: status, vendorId, date range, onlyOpen, onlyOverdue */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page')        page?:        string,
    @Query('pageSize')    pageSize?:    string,
    @Query('vendorId')    vendorId?:    string,
    @Query('status')      status?:      string,
    @Query('from')        from?:        string,
    @Query('to')          to?:          string,
    @Query('onlyOpen')    onlyOpen?:    string,
    @Query('onlyOverdue') onlyOverdue?: string,
  ) {
    return this.svc.findAll(user.tenantId!, {
      page:        page     ? Number(page)     : undefined,
      pageSize:    pageSize ? Number(pageSize) : undefined,
      vendorId,
      status:      status as BillStatus | undefined,
      from, to,
      onlyOpen:    onlyOpen    === 'true',
      onlyOverdue: onlyOverdue === 'true',
    });
  }

  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'AP_ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  /** Create a DRAFT bill. */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAPBillDto) {
    return this.svc.create(user.tenantId!, user.sub, dto);
  }

  /** Post a DRAFT bill → OPEN, creating the GL JE. */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @Patch(':id/post')
  @HttpCode(HttpStatus.OK)
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.post(user.tenantId!, id, user.sub);
  }

  /** Void a posted bill — reverses the JE. */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.svc.void(user.tenantId!, id, user.sub, body.reason ?? '');
  }

  /** Cancel a DRAFT bill (no GL impact). */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'AP_ACCOUNTANT')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.svc.cancel(user.tenantId!, id, user.sub, body.reason ?? 'No reason given');
  }
}
