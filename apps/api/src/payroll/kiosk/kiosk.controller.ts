/**
 * Sprint 19 — Sync kiosk-mode terminal controllers.
 *
 * Two controllers:
 *   • KioskAdminController — auth-protected, owner/manager only, manages
 *     the list of enrolled terminals.
 *   • KioskPublicController — UNAUTH; the punch endpoint authenticates
 *     with apiKey + PIN. Mounted under /payroll/kiosk so the URL the
 *     tablet visits matches the natural mental model.
 */
import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { KioskService } from './kiosk.service';

@ApiTags('Kiosk (Admin)')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payroll/kiosk/terminals')
export class KioskAdminController {
  constructor(private readonly svc: KioskService) {}

  @ApiOperation({ summary: 'List enrolled kiosk terminals' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.list(user.tenantId!);
  }

  @ApiOperation({ summary: 'Enroll a new kiosk terminal (returns apiKey ONCE)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; branchId?: string | null },
  ) {
    return this.svc.create(user.tenantId!, body);
  }

  @ApiOperation({ summary: 'Update kiosk (rename, scope, pause)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Partial<{ name: string; isActive: boolean; branchId: string | null }>,
  ) {
    return this.svc.update(user.tenantId!, id, body);
  }

  @ApiOperation({ summary: 'Revoke (deactivate + rotate apiKey) a kiosk' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Delete(':id')
  revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.revoke(user.tenantId!, id);
  }
}

@ApiTags('Kiosk (Public)')
@Controller('payroll/kiosk')
export class KioskPublicController {
  constructor(private readonly svc: KioskService) {}

  @ApiOperation({ summary: 'Punch clock-in or clock-out (auth via apiKey + PIN)' })
  @Post('punch')
  @HttpCode(HttpStatus.OK)
  punch(@Body() body: { apiKey: string; pin: string }) {
    return this.svc.punch(body.apiKey, body.pin);
  }
}
