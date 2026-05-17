import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { DisplayPairingService } from './display-pairing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '@repo/shared-types';
import type { DisplayDeviceRole } from '@prisma/client';

const ALL_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SALES_LEAD'] as const;

@Controller('display-pairing')
export class DisplayPairingController {
  constructor(private svc: DisplayPairingService) {}

  // ─── Cashier-side (authenticated) ────────────────────────────────────────

  /** Create / refresh a pairing code. Returns the 4-digit code. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ALL_ROLES)
  @Post('codes')
  @HttpCode(HttpStatus.OK)
  createCode(
    @CurrentUser() user: JwtPayload,
    @Body() body: { role: DisplayDeviceRole; stationId?: string; label?: string },
  ) {
    if (!body?.role) throw new BadRequestException('role is required');
    return this.svc.createCode(user.tenantId!, user.sub, body.role, {
      stationId: body.stationId,
      label:     body.label,
    });
  }

  /** List paired + pending displays for this tenant. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ALL_ROLES)
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.list(user.tenantId!);
  }

  /** Revoke a paired display (kicks the device on its next poll). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Delete(':id')
  revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.revoke(user.tenantId!, id);
  }

  // ─── Secondary-device side (no auth — the code IS the auth) ──────────────

  /**
   * Public: trade a 4-digit code + tenant slug for a long-lived device
   * token. The device stores the token in localStorage and uses it for
   * all subsequent display-stream polls.
   */
  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  redeem(@Body() body: { tenantSlug: string; code: string }) {
    if (!body?.tenantSlug || !body?.code) {
      throw new BadRequestException('tenantSlug and code are required');
    }
    return this.svc.redeem(body.tenantSlug, body.code);
  }

  /**
   * Public: device-token sanity check. Lets a paired display verify on
   * boot that its token is still good (e.g. after a TV power-cycle).
   * Returns the pairing metadata or 404 on revoked/missing.
   */
  @Get('whoami')
  async whoami(@Query('token') token: string) {
    const row = await this.svc.resolveToken(token);
    if (!row) throw new BadRequestException('Invalid or revoked token');
    return {
      tenantId:   row.tenantId,
      cashierId:  row.createdById,
      stationId:  row.stationId,
      role:       row.role,
      label:      row.label,
    };
  }
}
