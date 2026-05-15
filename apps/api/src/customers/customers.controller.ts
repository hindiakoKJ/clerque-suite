/**
 * /customers — POS-scope customer CRUD (no Ledger module required).
 *
 * Mounted at the root `/customers` so it's accessible to any logged-in
 * tenant regardless of plan. The deeper AR endpoints (invoices, payments,
 * credit terms) live at /ar/customers and DO require Ledger.
 */
import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard }   from '../auth/guards/roles.guard';
import { Roles }        from '../auth/decorators/roles.decorator';
import { CurrentUser }  from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { CustomersService } from './customers.service';

class CreateCustomerLiteDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(40)
  contactPhone?: string;

  @IsOptional() @IsString() @MaxLength(120)
  contactEmail?: string;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @IsString() @MaxLength(500)
  defaultAddress?: string;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

const READ_ROLES = [
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER',
  'SALES_LEAD', 'GENERAL_EMPLOYEE',
  // Ledger-side roles still allowed to read on this route as well.
  'ACCOUNTANT', 'AR_ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR',
] as const;

const WRITE_ROLES = [
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER',
  'SALES_LEAD',
  // AR roles can also create from POS context if they're on a register.
  'ACCOUNTANT', 'AR_ACCOUNTANT',
] as const;

@ApiTags('Customers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Roles(...READ_ROLES)
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('search') search?: string) {
    return this.svc.list(user.tenantId!, { search });
  }

  /**
   * Sprint 25 Phase 2A — phone-number autocomplete for the till. The
   * frontend gates the UI behind `planFeatures.customerPhoneLookup`; this
   * endpoint stays open to all READ_ROLES so degraded plans don't 403 if a
   * stale client calls in.
   */
  @Roles(...READ_ROLES)
  @Get('lookup')
  lookup(@CurrentUser() user: JwtPayload, @Query('phone') phone?: string) {
    return this.svc.lookupByPhone(user.tenantId!, phone ?? '');
  }

  @Roles(...READ_ROLES)
  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getOne(user.tenantId!, id);
  }

  @Roles(...WRITE_ROLES)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCustomerLiteDto) {
    return this.svc.create(user.tenantId!, dto);
  }
}
