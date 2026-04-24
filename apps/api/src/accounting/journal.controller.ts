import {
  Controller, Get, Post, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { JournalService, CreateJournalDto } from './journal.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accounting/journal')
export class JournalController {
  constructor(private readonly svc: JournalService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.findAll(user.tenantId!, { page: page ? Number(page) : 1, from, to });
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  @Post()
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateJournalDto) {
    return this.svc.create(user.tenantId!, dto, user.sub);
  }
}
