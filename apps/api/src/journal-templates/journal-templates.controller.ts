import {
  Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { JournalTemplatesService } from './journal-templates.service';
import type { JournalTemplateFrequency } from '@prisma/client';

interface TemplateLineInput {
  accountId:    string;
  description?: string;
  debit?:       number;
  credit?:      number;
}

const READ  = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD'] as const;
const WRITE = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD'] as const;

@ApiTags('Journal Templates')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('journal-templates')
export class JournalTemplatesController {
  constructor(private svc: JournalTemplatesService) {}

  @Roles(...READ)
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.list(user.tenantId!);
  }

  @Roles(...READ)
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  @Roles(...WRITE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() body: {
    name:        string;
    description?: string;
    lines:       TemplateLineInput[];
    frequency?:  JournalTemplateFrequency;
    nextRunAt?:  string;
  }) {
    return this.svc.create(user.tenantId!, user.sub, body);
  }

  @Roles(...WRITE)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Partial<{
      name:        string;
      description: string | null;
      lines:       TemplateLineInput[];
      frequency:   JournalTemplateFrequency;
      isActive:    boolean;
      nextRunAt:   string | null;
    }>,
  ) {
    return this.svc.update(user.tenantId!, id, body);
  }

  @Roles(...WRITE)
  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  runNow(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { date?: string },
  ) {
    return this.svc.runNow(user.tenantId!, id, user.sub, body);
  }

  @Roles(...WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  delete(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.delete(user.tenantId!, id);
  }
}
