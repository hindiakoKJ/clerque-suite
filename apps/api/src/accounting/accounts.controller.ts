import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { AccountsService, CreateAccountDto, UpdateAccountDto } from './accounts.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accounting/accounts')
export class AccountsController {
  constructor(private readonly svc: AccountsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.svc.findAll(user.tenantId!);
  }

  @Get('trial-balance')
  trialBalance(@CurrentUser() user: JwtPayload, @Query('asOf') asOf?: string) {
    return this.svc.getTrialBalance(user.tenantId!, asOf);
  }

  @Get('pl-summary')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  plSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const now = new Date().toISOString().split('T')[0];
    return this.svc.getPLSummary(user.tenantId!, from ?? now, to ?? now);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  @Post()
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAccountDto) {
    return this.svc.create(user.tenantId!, dto);
  }

  @Patch(':id')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.svc.update(user.tenantId!, id, dto);
  }

  @Delete(':id')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.delete(user.tenantId!, id);
  }
}
