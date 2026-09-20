import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { WriteOffReason } from '../inventory/dto/write-off-raw-material.dto';
import { STATION_ROLES, stationContext, type StationCaller } from '../kds/station-access';
import { usageQty } from '../telegram/messages';
import { stationItems, UNROUTED } from './station-items';

/** The tablet's tap key: a UUID, or the fallback a browser without crypto.randomUUID makes (as on Made). */
const TAP_KEY = /^[A-Za-z0-9-]{8,64}$/;

/**
 * The reasons a kitchen or bar picks from, and the write-off reason each one is
 * booked under. Spoiled, past its date and dropped are all waste (5070
 * Spoilage & Waste); Other is booked as Procure > Stock books Other.
 */
export const STATION_WASTE_REASONS: Record<'SPOILED' | 'EXPIRED' | 'DROPPED' | 'OTHER', { code: WriteOffReason; said: string }> = {
  SPOILED: { code: 'DAMAGE', said: 'spoiled' },
  EXPIRED: { code: 'EXPIRY', said: 'past its date' },
  DROPPED: { code: 'DAMAGE', said: 'dropped or spilled' },
  OTHER:   { code: 'OTHER',  said: 'other' },
};
export type StationWasteReason = keyof typeof STATION_WASTE_REASONS;

const NOTE_MAX = 200;

/**
 * "Thrown out" on a kitchen or bar screen's Today's inventory.
 *
 * Waste used to need Anne or a manager in Procure > Stock, one item at a time,
 * so the kitchen wrote it on paper -- and what never reached Procure left the
 * stock too high and the waste expense missing. This records it from the
 * tablet, through the SAME write-off Procure uses: the same marker lot (the
 * sheet's Waste column reads it), the same books entry, the same refusal to
 * take off more than the books hold.
 *
 * Only an item on this station's sheet; the branch and the person are the
 * ones the station screen resolves (station-access.ts), and a tablet paired by
 * someone who has left is refused. One tap key per entry, so a double-tap or a
 * retry after the signal dropped takes the milk off once. No costs in the
 * answer: kitchen and bar screens never see them.
 */
@UseGuards(JwtOrDeviceTokenAuthGuard, RolesGuard)
@Controller('kds')
export class StationWasteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  @Roles(...STATION_ROLES)
  @Post('stations/:id/waste')
  @HttpCode(200)
  async waste(
    @CurrentUser() user: StationCaller,
    @Param('id') stationId: string,
    @Body() body: { rawMaterialId?: unknown; qty?: unknown; reason?: unknown; note?: unknown; key?: unknown } | undefined,
  ) {
    const key = typeof body?.key === 'string' ? body.key : '';
    if (!TAP_KEY.test(key)) throw new BadRequestException('Missing tap key.');

    // A write: a screen paired to another station, or by someone who has since left, is refused here.
    const ctx = await stationContext(this.prisma, user, stationId, { write: true });

    const rawMaterialId = typeof body?.rawMaterialId === 'string' ? body.rawMaterialId : '';
    if (!rawMaterialId) throw new BadRequestException('Pick the item that was thrown out.');
    const qty = typeof body?.qty === 'number' && Number.isFinite(body.qty) ? Math.round(body.qty * 10_000) / 10_000 : 0;
    if (!(qty > 0)) throw new BadRequestException('Enter how much was thrown out.');
    // Own keys only: "toString" is in every object, and is not a reason.
    const reason = typeof body?.reason === 'string' && Object.prototype.hasOwnProperty.call(STATION_WASTE_REASONS, body.reason)
      ? body.reason as StationWasteReason : null;
    if (!reason) throw new BadRequestException('Pick why it was thrown out: spoiled, past its date, dropped or other.');
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : '';

    /*
      The rows this station's sheet shows (stock-sheet.ts buildSheet): items a
      product routed here uses, and items only unrouted products use. Anything
      else is another station's to record, or not stock the kitchen handles.
    */
    const item = (await stationItems(this.prisma, ctx.tenantId)).items.get(rawMaterialId);
    const onSheet = !!item && (item.on.has(ctx.station.id) || (item.on.size === 1 && item.on.has(UNROUTED)));
    if (!item || !onSheet) {
      throw new ForbiddenException(`That item is not on the ${ctx.station.name} sheet. Ask the manager to write it off in Procure > Stock.`);
    }

    const referenceNumber = `WASTE-${key}`;
    const said = STATION_WASTE_REASONS[reason].said;
    const already = { rawMaterialId, name: item.name, quantity: qty, unit: item.unit, reason, duplicate: true, warning: null, message: 'Already recorded. Nothing was taken off again.' };

    /*
      Said in the kitchen's words before the write-off is asked. Its own
      refusals are for a manager ("do a cycle count"), and a retry of an entry
      that went through must hear "already recorded", not "only 200 ml left".
      The write-off checks both again inside its transaction.
    */
    const seen = await this.prisma.rawMaterialLot.findFirst({
      where: { tenantId: ctx.tenantId, rawMaterialId, referenceNumber }, select: { id: true },
    });
    if (seen) return already;
    const stock = await this.prisma.rawMaterialInventory.findUnique({
      where:  { branchId_rawMaterialId: { branchId: ctx.branch.id, rawMaterialId } },
      select: { quantity: true },
    });
    const onHand = stock ? Number(stock.quantity) : 0;
    if (qty > onHand) {
      throw new BadRequestException(onHand > 0
        ? `The books show only ${usageQty(onHand, item.unit)} of ${item.name} here. Enter up to that, and tell the manager so the count can be fixed.`
        : `The books show no ${item.name} here. Tell the manager so the count can be fixed.`);
    }

    const r = await this.inventory.writeOffRawMaterial(ctx.tenantId, rawMaterialId, ctx.actorId, {
      branchId:   ctx.branch.id,
      quantity:   qty,
      reasonCode: STATION_WASTE_REASONS[reason].code,
      // Who and why, as the books and Procure's movement list will show it.
      note:       `${ctx.actorLabel}: thrown out, ${said}${note ? ` (${note})` : ''}`,
      referenceNumber,
    });
    if ('duplicate' in r && r.duplicate) return already;

    // Only quantities and words: the write-off also returns the unit cost and value.
    return {
      rawMaterialId,
      name:      item.name,
      quantity:  qty,
      unit:      item.unit,
      reason,
      duplicate: false,
      // Orders still waiting may now be short of it: quantities only, and the cook can check them.
      warning:   'heldWarning' in r ? r.heldWarning ?? null : null,
      message:   `Recorded: ${usageQty(qty, item.unit)} of ${item.name} thrown out (${said}).`,
    };
  }
}
