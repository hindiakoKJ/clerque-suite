import {
  Controller, Get, Post, Param, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { JournalService } from './journal.service';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accounting/events')
export class EventsController {
  constructor(
    private readonly journal: JournalService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    const take = 50;
    const skip = ((Number(page) || 1) - 1) * take;

    const where = {
      tenantId: user.tenantId!,
      ...(status ? { status: status as 'PENDING' | 'SYNCED' | 'FAILED' } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.accountingEvent.count({ where }),
      this.prisma.accountingEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          order: { select: { orderNumber: true } },
          journalEntry: { select: { entryNumber: true, id: true } },
        },
      }),
    ]);

    return { data, total, page: Number(page) || 1, pages: Math.ceil(total / take) };
  }

  @Get('stats')
  async stats(@CurrentUser() user: JwtPayload) {
    const tenantId = user.tenantId!;
    const [pending, synced, failed] = await Promise.all([
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'SYNCED'  } }),
      this.prisma.accountingEvent.count({ where: { tenantId, status: 'FAILED'  } }),
    ]);
    return { pending, synced, failed };
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
