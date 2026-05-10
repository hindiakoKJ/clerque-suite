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
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
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
@Controller('payroll/kiosk')
export class KioskAdminController {
  constructor(private readonly svc: KioskService) {}

  // Self-clock policy (sub-route on the same controller so all kiosk
  // admin endpoints sit under /payroll/kiosk/*).

  @ApiOperation({ summary: 'Get whether self-service clock-in is enabled' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Get('policy')
  getPolicy(@CurrentUser() user: JwtPayload) {
    return this.svc.getSelfClockPolicy(user.tenantId!);
  }

  @ApiOperation({ summary: 'Toggle self-service clock-in (kiosk-only when off)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('policy')
  setPolicy(
    @CurrentUser() user: JwtPayload,
    @Body() body: { allowSelfClockIn: boolean },
  ) {
    return this.svc.setSelfClockPolicy(user.tenantId!, !!body.allowSelfClockIn);
  }

  @ApiOperation({ summary: 'List enrolled kiosk terminals' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Get('terminals')
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.list(user.tenantId!);
  }

  @ApiOperation({ summary: 'Enroll a new kiosk terminal (returns apiKey ONCE)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Post('terminals')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name: string; branchId?: string | null },
  ) {
    return this.svc.create(user.tenantId!, body);
  }

  @ApiOperation({ summary: 'Update kiosk (rename, scope, pause)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Patch('terminals/:id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Partial<{ name: string; isActive: boolean; branchId: string | null }>,
  ) {
    return this.svc.update(user.tenantId!, id, body);
  }

  @ApiOperation({ summary: 'Revoke (deactivate + rotate apiKey) a kiosk' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Delete('terminals/:id')
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

  /**
   * Sprint 19 — Live "currently clocked in" roster for the kiosk display.
   * UNAUTHENTICATED — the kiosk's apiKey authenticates the request. Names
   * + roles only; no payroll figures, no PII beyond what the same person
   * sees on a printed kitchen schedule.
   */
  @ApiOperation({ summary: 'Get currently clocked-in staff visible from this kiosk' })
  @Get('roster')
  roster(@Query('apiKey') apiKey: string) {
    return this.svc.getRosterByApiKey(apiKey);
  }
}
