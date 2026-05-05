import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { KdsService } from './kds.service';

/**
 * KDS endpoints — used by the station-screen route /pos/station/[id].
 *
 * Authentication: any authenticated tenant user can read/bump (kitchen staff
 * are typically GENERAL_EMPLOYEE who clock in via /payroll/clock; they don't
 * need POS app-access). Tenant ownership is enforced inside the service.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kds')
export class KdsController {
  constructor(private kds: KdsService) {}

  /** Pending + recently-bumped items for one station. KDS polls every ~3s. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER',
         'SUPER_ADMIN', 'GENERAL_EMPLOYEE', 'MDM', 'WAREHOUSE_STAFF',
         'KIOSK_DISPLAY')
  @Get('stations/:id/queue')
  listQueue(@CurrentUser() user: JwtPayload, @Param('id') stationId: string) {
    return this.kds.listStationQueue(user.tenantId!, stationId);
  }

  /** Bump an item to READY. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER',
         'SUPER_ADMIN', 'GENERAL_EMPLOYEE', 'MDM', 'WAREHOUSE_STAFF',
         'KIOSK_DISPLAY')
  @Post('items/:id/bump')
  @HttpCode(HttpStatus.OK)
  bump(@CurrentUser() user: JwtPayload, @Param('id') orderItemId: string) {
    return this.kds.bumpReady(user.tenantId!, orderItemId);
  }

  /** Mark an item served. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER',
         'SUPER_ADMIN', 'GENERAL_EMPLOYEE', 'KIOSK_DISPLAY')
  @Post('items/:id/serve')
  @HttpCode(HttpStatus.OK)
  serve(@CurrentUser() user: JwtPayload, @Param('id') orderItemId: string) {
    return this.kds.markServed(user.tenantId!, orderItemId);
  }

  /** Undo a bump (mistake recovery). */
  @Roles('SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN')
  @Post('items/:id/unbump')
  @HttpCode(HttpStatus.OK)
  unbump(@CurrentUser() user: JwtPayload, @Param('id') orderItemId: string) {
    return this.kds.unbump(user.tenantId!, orderItemId);
  }
}
