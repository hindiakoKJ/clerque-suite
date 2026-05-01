import {
  Controller, Get, Patch, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private svc: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('limit')      limit?:      string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.svc.list(user.tenantId!, user.sub, {
      limit:      limit ? Number(limit) : undefined,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('count')
  countUnread(@CurrentUser() user: JwtPayload) {
    return this.svc.countUnread(user.tenantId!, user.sub).then((c) => ({ count: c }));
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.markRead(user.tenantId!, user.sub, id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.svc.markAllRead(user.tenantId!, user.sub);
  }
}
