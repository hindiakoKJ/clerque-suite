import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const READ_ROLES  = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR'] as const;
const WRITE_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT'] as const;

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ar/customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Roles(...READ_ROLES)
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('search')   search?:   string,
    @Query('isActive') isActive?: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    const active =
      isActive === 'true'  ? true  :
      isActive === 'false' ? false :
      undefined;
    return this.svc.findAll(user.tenantId, { search, isActive: active });
  }

  @Roles(...READ_ROLES)
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.findOne(id, user.tenantId);
  }

  @Roles(...WRITE_ROLES)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCustomerDto) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.create(user.tenantId, dto);
  }

  @Roles(...WRITE_ROLES)
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.update(id, user.tenantId, dto);
  }

  @Roles(...WRITE_ROLES)
  @Delete(':id')
  deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.deactivate(id, user.tenantId);
  }
}
