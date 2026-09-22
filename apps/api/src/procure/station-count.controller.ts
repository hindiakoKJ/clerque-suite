import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@repo/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { STATION_ROLES, stationContext, type StationCaller } from '../kds/station-access';
import { ReviewScope, StationCountService } from './station-count.service';

/**
 * "Weekly count" on a kitchen or bar screen.
 *
 * A paired tablet or a logged-in person counts what is on the shelf for the
 * items on this station's sheet, and sends it to the owner. Blind: nothing
 * here returns what Clerque expects, a difference, the book or a cost --
 * the answers are built field by field in StationCountService. A send
 * records the count; stock and the books do not move.
 */
@UseGuards(JwtOrDeviceTokenAuthGuard, RolesGuard)
@Controller('kds')
export class StationCountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counts: StationCountService,
  ) {}

  /** The panel: the station's items, what is counted so far, and whether a count is due. Writes nothing. */
  @Roles(...STATION_ROLES)
  @Get('stations/:id/count')
  async panel(@CurrentUser() user: StationCaller, @Param('id') stationId: string) {
    const ctx = await stationContext(this.prisma, user, stationId, { write: false });
    return this.counts.view(ctx, new Date());
  }

  /** Save one item's count: { rawMaterialId, qty, by? }. `by` is required from a paired tablet. */
  @Roles(...STATION_ROLES)
  @Post('stations/:id/count/lines')
  @HttpCode(HttpStatus.OK)
  async save(
    @CurrentUser() user: StationCaller,
    @Param('id') stationId: string,
    @Body() body: { rawMaterialId?: unknown; qty?: unknown; by?: unknown } | undefined,
  ) {
    const ctx = await stationContext(this.prisma, user, stationId, { write: true });
    return this.counts.save(ctx, body, new Date());
  }

  /** Send the count to the owner: { by? }. It becomes a record; nothing moves. */
  @Roles(...STATION_ROLES)
  @Post('stations/:id/count/send')
  @HttpCode(HttpStatus.OK)
  async send(@CurrentUser() user: StationCaller, @Param('id') stationId: string, @Body() body: { by?: unknown } | undefined) {
    const ctx = await stationContext(this.prisma, user, stationId, { write: true });
    return this.counts.send(ctx, body, new Date());
  }
}

/** Who reviews a weekly count and adjusts the books from it: the people who post counts, less the warehouse role. */
export const WEEKLY_REVIEW_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM'] as const;

/**
 * The owner's side of the weekly count: the reconciliation (counted against
 * the book at the moment of counting), "Ask for a recount" and "Adjust the
 * books to match". A manager tied to one branch sees only that branch's counts.
 */
@ApiTags('Procure')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('procure/weekly-counts')
export class WeeklyCountReviewController {
  constructor(private readonly counts: StationCountService) {}

  @Roles(...WEEKLY_REVIEW_ROLES)
  @Get()
  @ApiOperation({ summary: 'Weekly counts from the kitchen and bar screens, newest first' })
  list(@CurrentUser() user: JwtPayload, @Query('branchId') branchId?: string, @Query('status') status?: string) {
    return this.counts.list(scopeOf(user), { branchId, status });
  }

  @Roles(...WEEKLY_REVIEW_ROLES)
  @Get(':id')
  @ApiOperation({ summary: 'One weekly count: counted, book and difference per item' })
  review(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.counts.review(scopeOf(user), id, new Date());
  }

  @Roles(...WEEKLY_REVIEW_ROLES)
  @Post(':id/recount')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the station to count some items again' })
  recount(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: { rawMaterialIds?: unknown; note?: unknown } | undefined) {
    return this.counts.recount(scopeOf(user), id, user.sub, body, new Date());
  }

  @Roles(...WEEKLY_REVIEW_ROLES)
  @Post(':id/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust the books to match the count, leaving out items counted again later' })
  adjust(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: { isOpeningBalance?: unknown } | undefined) {
    return this.counts.adjust(scopeOf(user), id, user.sub, body, new Date());
  }
}

/** A manager tied to one branch is kept to it (station-sheet.controller.ts does the same for the daily sheet). */
export function scopeOf(user: JwtPayload): ReviewScope {
  const ownBranchOnly = user.role === 'BRANCH_MANAGER' && !!user.branchId && !user.isSuperAdmin;
  return { tenantId: user.tenantId!, ownBranchId: ownBranchOnly ? user.branchId : null };
}
