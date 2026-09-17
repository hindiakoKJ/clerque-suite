import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@repo/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { STATION_ROLES, StationCaller, stationContext } from '../kds/station-access';
import { isManilaDay } from './daily-usage';
import { buildSheet, DailySheet, stationSheet } from './stock-sheet';

/** A day from the query string: absent means the default sheet; anything else has to be a real date. */
function dayParam(day: string | undefined): string | null {
  if (day === undefined || day === '') return null;
  if (!isManilaDay(day)) throw new BadRequestException('The day has to be a real date (YYYY-MM-DD).');
  return day;
}

/**
 * "Today's inventory" on a kitchen or bar screen.
 *
 * A paired tablet reads only its own station, for the branch of whoever paired
 * it; a logged-in person reads with their own branch (station-access.ts).
 * Read-only, and quantities only -- no costs reach a station screen.
 */
@UseGuards(JwtOrDeviceTokenAuthGuard, RolesGuard)
@Controller('kds')
export class StationSheetController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles(...STATION_ROLES)
  @Get('stations/:id/daily-inventory')
  async dailyInventory(
    @CurrentUser() user: StationCaller,
    @Param('id') stationId: string,
    @Query('day') day?: string,
  ): Promise<DailySheet> {
    // Who may see it first: a refused screen learns nothing, not even that its day was malformed.
    const ctx = await stationContext(this.prisma, user, stationId, { write: false });
    return stationSheet(this.prisma, ctx, dayParam(day), new Date());
  }
}

/**
 * The owner's copy of the same sheet, under Inventory > Reports: any branch,
 * one station's rows or every item. Still no costs -- it is the sheet the
 * kitchen signs, so both copies read the same.
 *
 * A manager tied to one branch sees only that branch; the owner, MDM and a
 * manager of every branch may pick.
 */
@ApiTags('Ingredient Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class DailySheetController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SUPER_ADMIN')
  @Get('reports/ingredients/daily-sheet')
  async dailySheet(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('stationId') stationId?: string,
    @Query('day') day?: string,
  ) {
    const tenantId = user.tenantId!;
    const ownBranchOnly = user.role === 'BRANCH_MANAGER' && !!user.branchId && !user.isSuperAdmin;
    if (ownBranchOnly && branchId && branchId !== user.branchId) {
      throw new ForbiddenException('You can only see the sheet of your own branch.');
    }
    const wanted = branchId || user.branchId || null;
    const branch = wanted
      ? await this.prisma.branch.findFirst({ where: { id: wanted, tenantId }, select: { id: true, name: true } })
      : await this.prisma.branch.findFirst({ where: { tenantId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
    if (!branch) throw new NotFoundException(wanted ? 'Branch not found.' : 'This organization has no branch yet.');

    let station: { id: string; name: string; kind: string } | null = null;
    if (stationId) {
      const found = await this.prisma.station.findFirst({ where: { id: stationId, tenantId }, select: { id: true, name: true, kind: true } });
      if (!found) throw new NotFoundException('Station not found.');
      station = { id: found.id, name: found.name, kind: String(found.kind) };
    }

    const sheet = await buildSheet(this.prisma, { tenantId, branch, station }, dayParam(day), new Date());

    // What the pickers offer: the branches this person may open, and the stations that can have a sheet.
    const [branches, stations] = await Promise.all([
      ownBranchOnly
        ? Promise.resolve([branch])
        : this.prisma.branch.findMany({ where: { tenantId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
      /*
        Every station of the shop, whichever branch is picked. A shop's Kitchen
        and Bar are made once and carry the first branch's id (layouts.service),
        and the station screen already treats them as shop-wide: a Branch 2
        tablet opens the same Kitchen with Branch 2's stock. Filtering on the
        picked branch left Branch 2's owner with no Kitchen or Bar to choose.
      */
      this.prisma.station.findMany({
        where:   { tenantId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select:  { id: true, name: true, kind: true },
      }),
    ]);
    return { ...sheet, choices: { branches, stations: stations.map((s) => ({ id: s.id, name: s.name, kind: String(s.kind) })) } };
  }
}
