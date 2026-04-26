/**
 * EventsController — delegates all DB access to EventsService (MEDIUM-2 fix).
 *
 * Previously this controller injected PrismaService directly, which bypassed the
 * service-layer abstraction and made tenant-scope enforcement harder to audit.
 * All queries now go through EventsService, consistent with every other controller.
 */
import {
  Controller, Get, Post, Param, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { JournalService } from './journal.service';
import { EventsService } from './events.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accounting/events')
export class EventsController {
  constructor(
    private readonly journal: JournalService,
    private readonly events:  EventsService,
  ) {}

  /** List accounting events — Accountant and above; External Auditor read-only. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('page')   page?:   string,
  ) {
    return this.events.findAll(user.tenantId!, {
      page:   Number(page) || 1,
      status,
    });
  }

  /** Event queue stats — same read-access set. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get('stats')
  stats(@CurrentUser() user: JwtPayload) {
    return this.events.stats(user.tenantId!);
  }

  @Post('process-all')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  processAll(@CurrentUser() user: JwtPayload) {
    return this.journal.processAllPending(user.tenantId!);
  }

  @Post(':id/process')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  processOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.journal.processEvent(user.tenantId!, id);
  }
}
