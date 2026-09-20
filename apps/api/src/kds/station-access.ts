import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@repo/shared-types';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Who may use a station screen's tools, and for which branch.
 *
 * Copies the prep route's guard pattern (kds.controller.ts, stations/:id/prep)
 * and closes its two gaps:
 *   - a paired screen with no station passed `user.stationId && ...`, so an
 *     unpaired device could read any station;
 *   - a device token outlives the person who paired it (the token check never
 *     looks at isActive), so a write from a screen paired by someone who has
 *     since left is refused here.
 */

export type StationCaller = JwtPayload & { isDevice?: boolean; deviceRole?: string | null; stationId?: string | null };

export const STATION_ROLES = ['CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN',
  'GENERAL_EMPLOYEE', 'MDM', 'WAREHOUSE_STAFF', 'KIOSK_DISPLAY'] as const;

export interface StationContext {
  tenantId: string;
  station: { id: string; name: string; kind: string };
  branch: { id: string; name: string };
  /** The logged-in person, or the person who paired the tablet. Goes in createdById/madeById columns. */
  actorId: string;
  /** What messages say: the person's name, or "Kitchen screen". */
  actorLabel: string;
  isDevice: boolean;
}

export async function stationContext(
  prisma: Pick<PrismaService, 'station' | 'user' | 'branch'>,
  user: StationCaller, stationId: string, opts: { write: boolean },
): Promise<StationContext> {
  const tenantId = user.tenantId!;
  if (user.isDevice) {
    if (!String(user.deviceRole ?? '').startsWith('KDS_')) throw new ForbiddenException('Only a kitchen or bar display can use this.');
    if (user.stationId !== stationId) {
      throw new ForbiddenException(user.stationId
        ? 'This screen is paired to another station.'
        : 'This screen is not paired to a station. Pair it again from Settings > Displays.');
    }
  }
  const station = await prisma.station.findFirst({ where: { id: stationId, tenantId }, select: { id: true, name: true, kind: true, branchId: true } });
  if (!station) throw new NotFoundException('Station not found.');
  const person = await prisma.user.findFirst({ where: { id: user.sub, tenantId }, select: { id: true, name: true, branchId: true, isActive: true } });
  if (!person || (opts.write && !person.isActive)) {
    throw new ForbiddenException(user.isDevice
      ? 'The person who paired this screen no longer has an active account. Pair it again.'
      : 'Your account is not active.');
  }
  /*
    Which branch this screen's stock belongs to.

    A tablet on the wall is in ONE kitchen, and that kitchen is the station's
    branch. Reading it from whoever paired the tablet took the milk off the
    branch that person happens to be assigned to: in a two-branch shop, the
    owner (assigned to Branch A) pairs the tablet in Branch B, and the waste a
    cook records there came off Branch A's books while Branch B's stayed high.
    Station.branchId is nullable, so the pairer's branch still answers for a
    station that belongs to no branch in particular, and a one-branch shop --
    where neither is set -- still falls through to its only active branch.

    A logged-in person keeps their own branch: they carry it from screen to
    screen, and their session says where they are.
  */
  const wanted = (user.isDevice
    ? (station.branchId ?? person.branchId)
    : (user.branchId ?? person.branchId)) ?? station.branchId ?? null;
  const branch = wanted
    ? await prisma.branch.findFirst({ where: { id: wanted, tenantId }, select: { id: true, name: true } })
    : await prisma.branch.findFirst({ where: { tenantId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
  if (!branch) throw new BadRequestException('This organization has no branch yet.');
  return {
    tenantId, station: { id: station.id, name: station.name, kind: String(station.kind) }, branch,
    actorId: person.id, actorLabel: user.isDevice ? `${station.name} screen` : person.name, isDevice: !!user.isDevice,
  };
}
