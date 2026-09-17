import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { canPrepAtStation } from '@repo/shared-types';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { STATION_ROLES, stationContext, type StationCaller } from '../kds/station-access';
import { SubRecipesService } from './sub-recipes.service';

/** The tablet's tap key: a UUID, or the fallback a browser without crypto.randomUUID makes. */
const TAP_KEY = /^[A-Za-z0-9-]{8,64}$/;

/**
 * "Made" on a station screen's prep chain card: one batch of one stage,
 * recorded from the kitchen or bar tablet where it was made.
 *
 * The station screen used to be read-only, so a cook who had just refilled
 * the line had to find a phone, log in and open the prep board to say so --
 * and mostly did not, so the sauce never moved on the books and the next
 * alert said to do work that was already done.
 *
 * One batch at the recipe's own yield, nothing to type. The tablet sends a key
 * per tap, and makeBatch records a key once, so a double-tap or a retry after
 * the signal dropped cannot make the sauce twice. A separate controller on the
 * `kds` prefix (Nest allows several) so kds.controller.ts stays untouched.
 */
@UseGuards(JwtOrDeviceTokenAuthGuard, RolesGuard)
@Controller('kds')
export class StationPrepMadeController {
  constructor(
    private readonly subRecipes: SubRecipesService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles(...STATION_ROLES)
  @Post('stations/:id/prep/:rawMaterialId/made')
  @HttpCode(200)
  async made(
    @CurrentUser() user: StationCaller,
    @Param('id') stationId: string,
    @Param('rawMaterialId') rawMaterialId: string,
    @Body() body: { key?: unknown } | undefined,
  ) {
    const key = typeof body?.key === 'string' ? body.key : '';
    if (!TAP_KEY.test(key)) throw new BadRequestException('Missing tap key.');

    // A write: a tablet paired by someone who has since left is refused here.
    const ctx = await stationContext(this.prisma, user, stationId, { write: true });

    // The same board the screen drew, so what it offered and what is allowed cannot disagree.
    const row = (await this.subRecipes.list(ctx.tenantId, ctx.branch.id, null)).find((r) => r.id === rawMaterialId);
    if (!row) throw new NotFoundException('That pre-made item was not found.');
    if (row.station && row.station.id !== ctx.station.id) {
      throw new ForbiddenException(`${row.name} is a ${row.station.name} item. Record it on the ${row.station.name} screen.`);
    }

    /*
      A logged-in barista standing at the kitchen screen is refused here as
      well, with the same rule makeBatch applies (a persona's stations, judged
      against the stations this shop actually has). makeBatch would refuse it
      too, but as a 400 that reads like a mistake in the tap rather than
      "this is not yours to record". A paired tablet has no persona: the
      station it is paired to is its scope, checked above.
    */
    if (!user.isDevice) {
      const shopStations = await this.prisma.station.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, select: { kind: true } });
      const shopKinds = [...new Set(shopStations.map((s) => String(s.kind)))];
      if (!canPrepAtStation(user.personaKey, row.station ? String(row.station.kind) : null, shopKinds)) {
        throw new ForbiddenException(`${row.name} is a ${row.station?.name ?? 'different station'} item. Ask the ${row.station?.name ?? 'other station'} to record it.`);
      }
    }

    // makeBatch's own refusals ("Not enough ...", "has no batch yield") pass through as they are.
    const r = await this.subRecipes.makeBatch(
      ctx.tenantId,
      rawMaterialId,
      { branchId: ctx.branch.id, batches: 1, stationId: ctx.station.id, referenceNumber: `STN-${key}` },
      ctx.actorId,
      user.isDevice ? null : user.personaKey,
    );

    // Only what the screen needs: makeBatch also returns costs, and kitchen and bar screens never see costs.
    const produced = Number(r.produced);
    if ('duplicate' in r && r.duplicate) {
      return { rawMaterialId, name: row.name, produced, unit: row.unit, duplicate: true, message: 'Already recorded. Nothing was made again.' };
    }
    return {
      rawMaterialId,
      name:      row.name,
      produced,
      unit:      row.unit,
      duplicate: false,
      message:   `Recorded: 1 batch of ${row.name}, ${produced.toLocaleString('en-PH', { maximumFractionDigits: 2 })} ${row.unit}.`,
    };
  }
}
