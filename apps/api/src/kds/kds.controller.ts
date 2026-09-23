import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { KdsService, KdsActor } from './kds.service';
import { SubRecipesService } from '../sub-recipes/sub-recipes.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * KDS endpoints — used by the station-screen route /pos/station/[id].
 *
 * Authentication: any authenticated tenant user can read/bump (kitchen staff
 * are typically GENERAL_EMPLOYEE who clock in via /payroll/clock; they don't
 * need POS app-access). Tenant ownership is enforced inside the service.
 */
/** Who tapped: a person, or a paired screen (whose sub is the person who paired it). */
function actorOf(user: JwtPayload & { isDevice?: boolean; deviceRole?: string; stationId?: string | null }): KdsActor {
  return { userId: user.sub ?? null, isDevice: !!user.isDevice, deviceRole: user.deviceRole ?? null, stationId: user.stationId ?? null };
}

@UseGuards(JwtOrDeviceTokenAuthGuard, RolesGuard)
@Controller('kds')
export class KdsController {
  constructor(
    private kds: KdsService,
    private subRecipes: SubRecipesService,
    private prisma: PrismaService,
  ) {}

  /**
   * Every pre-made item at this station: levels, what to do, use-by dates.
   * The station screen's "Prep levels" view polls it about once a minute.
   * Read-only. A tablet paired to another station is refused, so the bar's
   * screen cannot be pointed at the kitchen's numbers by editing the URL.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER',
         'SUPER_ADMIN', 'GENERAL_EMPLOYEE', 'MDM', 'WAREHOUSE_STAFF',
         'KIOSK_DISPLAY')
  @Get('stations/:id/prep')
  async prep(
    @CurrentUser() user: JwtPayload & { isDevice?: boolean; deviceRole?: string; stationId?: string | null },
    @Param('id') stationId: string,
  ) {
    let branchId = user.branchId ?? null;
    if (user.isDevice) {
      // The customer-facing screen is paired too; back-of-house stock is not for it.
      if (!String(user.deviceRole ?? '').startsWith('KDS_')) {
        throw new ForbiddenException('Only a kitchen or bar display can show prep levels.');
      }
      if (user.stationId && user.stationId !== stationId) {
        throw new ForbiddenException('This screen is paired to another station.');
      }
      // A tablet has no branch of its own: it belongs to the branch of whoever paired it.
      branchId = (await this.prisma.user.findFirst({ where: { id: user.sub, tenantId: user.tenantId! }, select: { branchId: true } }))?.branchId ?? null;
    }
    return this.subRecipes.stationPrep(user.tenantId!, stationId, branchId);
  }

  /** Pending + recently-bumped items for one station. KDS polls every ~3s. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER',
         'SUPER_ADMIN', 'GENERAL_EMPLOYEE', 'MDM', 'WAREHOUSE_STAFF',
         'KIOSK_DISPLAY')
  @Get('stations/:id/queue')
  listQueue(
    @CurrentUser() user: JwtPayload & { isDevice?: boolean; stationId?: string | null },
    @Param('id') stationId: string,
  ) {
    // A paired tablet reads its own station's queue, not another's (the prep route already checks this).
    if (user.isDevice && user.stationId && user.stationId !== stationId) {
      throw new ForbiddenException('This screen is paired to another station.');
    }
    return this.kds.listStationQueue(user.tenantId!, stationId);
  }

  /** Bump an item to READY. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER',
         'SUPER_ADMIN', 'GENERAL_EMPLOYEE', 'MDM', 'WAREHOUSE_STAFF',
         'KIOSK_DISPLAY')
  @Post('items/:id/bump')
  @HttpCode(HttpStatus.OK)
  bump(@CurrentUser() user: JwtPayload & { isDevice?: boolean; deviceRole?: string; stationId?: string | null }, @Param('id') orderItemId: string) {
    return this.kds.bumpReady(user.tenantId!, orderItemId, actorOf(user));
  }

  /** Mark an item served. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER',
         'SUPER_ADMIN', 'GENERAL_EMPLOYEE', 'KIOSK_DISPLAY')
  @Post('items/:id/serve')
  @HttpCode(HttpStatus.OK)
  serve(@CurrentUser() user: JwtPayload & { isDevice?: boolean; deviceRole?: string; stationId?: string | null }, @Param('id') orderItemId: string) {
    return this.kds.markServed(user.tenantId!, orderItemId, actorOf(user));
  }

  /** Undo a bump (mistake recovery). */
  @Roles('SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN')
  @Post('items/:id/unbump')
  @HttpCode(HttpStatus.OK)
  unbump(@CurrentUser() user: JwtPayload, @Param('id') orderItemId: string) {
    return this.kds.unbump(user.tenantId!, orderItemId);
  }
}
