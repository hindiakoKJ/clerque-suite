import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JournalService, CreateJournalDto } from './journal.service';

@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accounting/journal')
export class JournalController {
  constructor(private readonly svc: JournalService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page')   page?:   string,
    @Query('from')   from?:   string,
    @Query('to')     to?:     string,
    @Query('status') status?: string,
  ) {
    return this.svc.findAll(user.tenantId!, {
      page: page ? Number(page) : 1, from, to, status,
    });
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  /** Create — can save as DRAFT or post immediately */
  @Post()
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateJournalDto) {
    return this.svc.create(user.tenantId!, dto, user.sub);
  }

  /** Approve & post a DRAFT entry */
  @Patch(':id/post')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  @HttpCode(HttpStatus.OK)
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.post(user.tenantId!, id, user.sub);
  }

  /** Reverse a POSTED entry — creates a mirror JE with flipped debits/credits */
  @Post(':id/reverse')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  reverse(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reverseDate?: string },
  ) {
    return this.svc.reverse(user.tenantId!, id, user.sub, body.reverseDate);
  }
}
